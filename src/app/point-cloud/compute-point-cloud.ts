/// <reference types="@webgpu/types" />
import { lonLatToMercator } from 'mapgpu/core';
import type { MapView } from 'mapgpu/core';
import type { RenderEngine } from 'mapgpu/render';
import { WGSLLayer } from 'mapgpu/layers';
import {
  POINT_SIZE_FAR_PX,
  POINT_SIZE_NEAR_PX,
  WAVE_CALM_RADIUS_M,
  WAVE_FULL_RADIUS_M,
  WAVE_MIN_AMPLITUDE_SCALE,
  YAW_RAD_PER_SEC,
  isFigurineStabilized,
} from './figurine-cloud-anim';

/** One rest particle: rest.xyz + wavelength, phase + amplitude + heightT + pad. */
const FLOATS_PER_REST = 8;
/** Animated output: xyz + heightT (for gradient). */
const FLOATS_PER_OUT = 4;
const WORKGROUP_SIZE = 64;

// GPUBufferUsage flags (numeric — @webgpu/types not in this project)
const USAGE_COPY_DST = 0x0008;
const USAGE_STORAGE = 0x0080;
const USAGE_UNIFORM = 0x0040;
const USAGE_VERTEX = 0x0020;

export interface ComputePointCloudOptions {
  id?: string;
  /** Collectible figurine this cloud belongs to. Omitted for test clouds. */
  figurineId?: string;
  anchorLon: number;
  anchorLat: number;
  /** Blender units → metres. */
  scale?: number;
}

interface PainterJson {
  points: Array<{ x: number; y: number; z: number }>;
}

/**
 * GPU compute animates rest poses → live positions; WGSLLayer draws them as
 * instanced screen-space quads (`triangle-list`, 6 verts × N instances).
 *
 * Per frame:
 *   1. MapView renders (reads `outBuffer` as per-instance data)
 *   2. 'frame' event → compute dispatch updates `outBuffer` for next frame
 *
 * Animation: vertical sine wave + slow rotation around the anchor up-axis.
 * Wave amplitude falls off as the player approaches each point (almost static nearby);
 * point sprites grow as the wave calms. Once the player stabilizes the figurine,
 * the calm pose latches and player distance is ignored.
 */
export class ComputePointCloud {
  readonly figurineId: string | null;
  private readonly device: GPUDevice;
  private readonly mapView: MapView;
  private layer: WGSLLayer | null = null;
  private restBuffer: GPUBuffer | null = null;
  private outBuffer: GPUBuffer | null = null;
  private paramsBuffer: GPUBuffer | null = null;
  private computePipeline: GPUComputePipeline | null = null;
  private computeBindGroup: GPUBindGroup | null = null;
  /** time, count, originXY, playerXY, calmRadius, fullRadius, stable, pad×3 */
  private paramsData = new Float32Array(12);
  private originX = 0;
  private originY = 0;
  /** Player ground position in EPSG:3857 metres; far away until set. */
  private playerX = 1e12;
  private playerY = 1e12;
  /** Latched calm: distance no longer affects wave amplitude or point size. */
  private stable = false;
  private pointCount = 0;
  private frameHandler: ((e: { frameNumber: number; fps: number }) => void) | null = null;
  private startTime = performance.now() / 1000;
  private destroyed = false;

  private constructor(
    mapView: MapView,
    renderEngine: RenderEngine,
    options: ComputePointCloudOptions,
  ) {
    const device = renderEngine.device;
    if (!device) {
      throw new Error('ComputePointCloud: RenderEngine.device is null — await mapView.when() first');
    }
    this.device = device;
    this.mapView = mapView;
    this.figurineId = options.figurineId ?? null;
  }

  static async create(
    mapView: MapView,
    renderEngine: RenderEngine,
    jsonUrl: string,
    options: ComputePointCloudOptions,
  ): Promise<ComputePointCloud> {
    await mapView.when();
    const cloud = new ComputePointCloud(mapView, renderEngine, options);
    const data = (await fetch(jsonUrl).then((r) => r.json())) as PainterJson;
    cloud.build(data, options);
    return cloud;
  }

  private build(data: PainterJson, options: ComputePointCloudOptions): void {
    const scale = options.scale ?? 120;
    const flatHeightCompensation = 2 * Math.PI;
    const [originX, originY] = lonLatToMercator(options.anchorLon, options.anchorLat);
    this.originX = originX;
    this.originY = originY;

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of data.points) {
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const zSpan = Math.max(maxZ - minZ, 1e-6);
    this.pointCount = data.points.length;

    const rest = new Float32Array(this.pointCount * FLOATS_PER_REST);
    for (let i = 0; i < this.pointCount; i++) {
      const p = data.points[i];
      const o = i * FLOATS_PER_REST;
      const height = ((p.z - minZ) * scale) / flatHeightCompensation;
      const hash = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719));

      rest[o] = originX + p.x * scale;
      rest[o + 1] = originY + p.y * scale;
      rest[o + 2] = height;
      rest[o + 3] = 0.7 + hash * 2.8; // wavelength (seconds)
      rest[o + 4] = (p.x + p.y * 2.0 + p.z) * 8; // phase
      // Amplitude in stored height units (~3× previous 0.35–1.25 range).
      rest[o + 5] = 1.2 + hash * 2.8;
      rest[o + 6] = (p.z - minZ) / zSpan; // normalized height for gradient
      rest[o + 7] = 0;
    }

    this.restBuffer = this.device.createBuffer({
      label: 'point-cloud-rest',
      size: rest.byteLength,
      usage: USAGE_STORAGE | USAGE_COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.restBuffer.getMappedRange()).set(rest);
    this.restBuffer.unmap();

    // Seed out with rest xyz + heightT so first frame is valid before compute runs.
    const initialOut = new Float32Array(this.pointCount * FLOATS_PER_OUT);
    for (let i = 0; i < this.pointCount; i++) {
      const r = i * FLOATS_PER_REST;
      const o = i * FLOATS_PER_OUT;
      initialOut[o] = rest[r];
      initialOut[o + 1] = rest[r + 1];
      initialOut[o + 2] = rest[r + 2];
      initialOut[o + 3] = rest[r + 6];
    }
    this.outBuffer = this.device.createBuffer({
      label: 'point-cloud-out',
      size: initialOut.byteLength,
      usage: USAGE_STORAGE | USAGE_VERTEX | USAGE_COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.outBuffer.getMappedRange()).set(initialOut);
    this.outBuffer.unmap();

    this.paramsBuffer = this.device.createBuffer({
      label: 'point-cloud-sim-params',
      size: this.paramsData.byteLength, // 12 × f32, 16-byte aligned
      usage: USAGE_UNIFORM | USAGE_COPY_DST,
    });

    this.computePipeline = this.device.createComputePipeline({
      label: 'point-cloud-compute',
      layout: 'auto',
      compute: {
        module: this.device.createShaderModule({
          label: 'point-cloud-compute-module',
          code: COMPUTE_WGSL,
        }),
        entryPoint: 'main',
      },
    });

    this.computeBindGroup = this.device.createBindGroup({
      label: 'point-cloud-compute-bind',
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.restBuffer } },
        { binding: 1, resource: { buffer: this.outBuffer } },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
      ],
    });

    this.layer = this.createRenderLayer(options.id ?? 'painter-cloud-compute');
    this.mapView.map.add(this.layer);
    this.layer.setVertexBuffer(0, this.outBuffer);
    this.layer.setDrawParams({
      vertexCount: 6,
      instanceCount: this.pointCount,
    });
    // Must set before first draw so the custom-uniform pipeline layout is created.
    this.syncRenderProximityUniforms();

    // Prime once so first painted frame is already animated.
    this.dispatch(0);

    this.frameHandler = () => {
      if (this.destroyed) return;
      const t = performance.now() / 1000 - this.startTime;
      this.dispatch(t);
    };
    this.mapView.on('frame', this.frameHandler);
    this.layer.requestRender();
  }

  private createRenderLayer(id: string): WGSLLayer {
    return new WGSLLayer({
      id,
      animated: true,
      topology: 'triangle-list',
      vertexBufferLayouts: [
        {
          arrayStride: 16,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' }, // xyz + heightT
          ],
        },
      ],
      blendState: {
        color: {
          srcFactor: 'src-alpha',
          dstFactor: 'one-minus-src-alpha',
          operation: 'add',
        },
        alpha: {
          srcFactor: 'one',
          dstFactor: 'one-minus-src-alpha',
          operation: 'add',
        },
      },
      vertexShader: /* wgsl */ `
struct CustomUniforms {
  playerXY: vec2<f32>,
  calmRadius: f32,
  fullRadius: f32,
  stable: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

struct VertexInput {
  @location(0) data: vec4<f32>, // xyz = live position, w = heightT
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) heightT: f32,
  @location(1) uv: vec2<f32>,
};

const EARTH_RADIUS_M: f32 = 6378137.0;
const POINT_SIZE_FAR: f32 = ${POINT_SIZE_FAR_PX};
const POINT_SIZE_NEAR: f32 = ${POINT_SIZE_NEAR_PX};

fn projectPoint(pos: vec3<f32>) -> vec4<f32> {
  let merc01 = _epsg3857ToMerc01(pos.xy);
  let ang = _mercToAngular(merc01);
  let base = _angularToSphere(ang.x, ang.y);
  let altFrac = pos.z / EARTH_RADIUS_M;
  let spherePos = base * (1.0 + altFrac);

  let globeClip = camera.viewProjection * vec4<f32>(spherePos, 1.0);
  if (camera.projectionTransition >= 0.999) {
    return globeClip;
  }
  let flatClip = camera.flatViewProjection * vec4<f32>(merc01.x, merc01.y, altFrac, 1.0);
  if (camera.projectionTransition <= 0.001) {
    return flatClip;
  }
  return mix(flatClip, globeClip, camera.projectionTransition);
}

@vertex
fn vs_main(input: VertexInput, @builtin(vertex_index) vid: u32) -> VertexOutput {
  var quadOffsets = array<vec2<f32>, 6>(
    vec2<f32>(-0.5, -0.5),
    vec2<f32>( 0.5, -0.5),
    vec2<f32>(-0.5,  0.5),
    vec2<f32>(-0.5,  0.5),
    vec2<f32>( 0.5, -0.5),
    vec2<f32>( 0.5,  0.5),
  );

  // Same falloff as compute wave damping: near player → larger, calmer points.
  // Once stabilized, stay at the calm size even if the player leaves.
  let dist = length(input.data.xy - custom.playerXY);
  let proximity = 1.0 - smoothstep(custom.calmRadius, custom.fullRadius, dist);
  let nearness = select(proximity, 1.0, custom.stable > 0.5);
  let pointSize = mix(POINT_SIZE_FAR, POINT_SIZE_NEAR, nearness);

  let offset = quadOffsets[vid];
  let clipCenter = projectPoint(input.data.xyz);
  let screenOffset = offset * pointSize;
  let ndcOffset = vec2<f32>(
    screenOffset.x * 2.0 / camera.viewport.x,
    screenOffset.y * 2.0 / camera.viewport.y,
  );

  var out: VertexOutput;
  out.clipPosition = vec4<f32>(
    clipCenter.x + ndcOffset.x * clipCenter.w,
    clipCenter.y + ndcOffset.y * clipCenter.w,
    clipCenter.z,
    clipCenter.w,
  );
  out.heightT = input.data.w;
  out.uv = offset + vec2<f32>(0.5, 0.5);
  return out;
}
`,
      fragmentShader: /* wgsl */ `
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let centered = input.uv - vec2<f32>(0.5, 0.5);
  let dist = length(centered);
  // Soft edge (no hard discard) — hard circles + depth fighting read as vertical stripes.
  let alpha = smoothstep(0.5, 0.35, dist);
  if (alpha <= 0.001) {
    discard;
  }
  let bottom = vec3<f32>(0.25, 0.08, 0.55);
  let top = vec3<f32>(0.90, 0.72, 1.0);
  let rgb = mix(bottom, top, clamp(input.heightT, 0.0, 1.0));
  return vec4<f32>(rgb, 0.92 * alpha * frame.opacity);
}
`,
    });
  }

  /**
   * Update the player ground position used to damp wave amplitude / grow points.
   * Returns true on the frame the cloud latches calm. Later calls ignore distance.
   */
  setPlayerLonLat(longitude: number, latitude: number): boolean {
    if (this.stable) {
      return false;
    }
    const [x, y] = lonLatToMercator(longitude, latitude);
    this.playerX = x;
    this.playerY = y;
    if (!isFigurineStabilized(Math.hypot(x - this.originX, y - this.originY))) {
      return false;
    }
    this.stable = true;
    return true;
  }

  private syncRenderProximityUniforms(): void {
    this.layer?.setCustomUniforms(
      new Float32Array([
        this.playerX,
        this.playerY,
        WAVE_CALM_RADIUS_M,
        WAVE_FULL_RADIUS_M,
        this.stable ? 1 : 0,
        0,
        0,
        0,
      ]),
    );
  }

  /** Run compute: rest + time → outBuffer (VERTEX|STORAGE). */
  dispatch(timeSeconds: number): void {
    if (
      this.destroyed ||
      !this.computePipeline ||
      !this.computeBindGroup ||
      !this.paramsBuffer
    ) {
      return;
    }

    this.paramsData[0] = timeSeconds;
    this.paramsData[1] = this.pointCount;
    this.paramsData[2] = this.originX;
    this.paramsData[3] = this.originY;
    this.paramsData[4] = this.playerX;
    this.paramsData[5] = this.playerY;
    this.paramsData[6] = WAVE_CALM_RADIUS_M;
    this.paramsData[7] = WAVE_FULL_RADIUS_M;
    this.paramsData[8] = this.stable ? 1 : 0;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsData);
    this.syncRenderProximityUniforms();

    const encoder = this.device.createCommandEncoder({
      label: 'point-cloud-compute-encoder',
    });
    const pass = encoder.beginComputePass({ label: 'point-cloud-compute-pass' });
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.computeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.pointCount / WORKGROUP_SIZE));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frameHandler) {
      this.mapView.off('frame', this.frameHandler);
      this.frameHandler = null;
    }
    if (this.layer) {
      this.mapView.map.remove(this.layer);
      this.layer = null;
    }
    this.restBuffer?.destroy();
    this.outBuffer?.destroy();
    this.paramsBuffer?.destroy();
    this.restBuffer = null;
    this.outBuffer = null;
    this.paramsBuffer = null;
    this.computePipeline = null;
    this.computeBindGroup = null;
  }
}

const COMPUTE_WGSL = /* wgsl */ `
struct RestParticle {
  // xyz = rest position (EPSG:3857 + altitude metres), w = wavelength (seconds)
  rest: vec4<f32>,
  // x = phase, y = amplitude, z = heightT, w = pad
  wave: vec4<f32>,
};

struct SimParams {
  time: f32,
  count: f32,
  originX: f32,
  originY: f32,
  playerX: f32,
  playerY: f32,
  calmRadius: f32,
  fullRadius: f32,
  stable: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<storage, read> restParticles: array<RestParticle>;
@group(0) @binding(1) var<storage, read_write> outPositions: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: SimParams;

const TWO_PI: f32 = 6.28318530718;
const YAW_RAD_PER_SEC: f32 = ${YAW_RAD_PER_SEC};
const MIN_AMP_SCALE: f32 = ${WAVE_MIN_AMPLITUDE_SCALE};

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.count);
  if (i >= count) {
    return;
  }

  let p = restParticles[i];
  let wavelength = max(p.rest.w, 0.05);

  // Slow spin around the figurine up-axis (through the anchor).
  let angle = params.time * YAW_RAD_PER_SEC;
  let c = cos(angle);
  let s = sin(angle);
  let dx = p.rest.x - params.originX;
  let dy = p.rest.y - params.originY;

  var pos = vec3<f32>(
    params.originX + dx * c - dy * s,
    params.originY + dx * s + dy * c,
    p.rest.z,
  );

  // Dampen vertical wave as the player nears this point (ground distance).
  // Once stabilized, keep the calm amplitude and stop reading player distance.
  let toPlayer = pos.xy - vec2<f32>(params.playerX, params.playerY);
  let dist = length(toPlayer);
  let liveScale = mix(
    MIN_AMP_SCALE,
    1.0,
    smoothstep(params.calmRadius, params.fullRadius, dist),
  );
  let ampScale = select(liveScale, MIN_AMP_SCALE, params.stable > 0.5);
  pos.z += sin(params.time * (TWO_PI / wavelength) + p.wave.x) * p.wave.y * ampScale;

  // w carries normalized rest height for the fragment gradient
  outPositions[i] = vec4<f32>(pos, p.wave.z);
}
`;
