import { Component, type ElementRef, AfterViewInit, OnDestroy, ViewChild, inject, signal, viewChild } from '@angular/core';
import { MapView, SimpleRenderer, lonLatToMercator } from "mapgpu/core";
import { RenderEngine } from "mapgpu/render";
import { GraphicsLayer, RasterTileLayer, VectorTileLayer, DynamicPointLayer, WGSLLayer } from "mapgpu/layers";
import { appConfigSettings } from '../config/app-config';
import { Joystick } from '../joystick/joystick';
import { type JoystickVector } from '../movement/ground-movement';
import { Player } from '../player/player';
import { FigurineCollection } from '../figurine/figurine-collection';
import { ComputePointCloud } from '../point-cloud/compute-point-cloud';
import {
  POINT_SIZE_FAR_PX,
  POINT_SIZE_NEAR_PX,
  WAVE_CALM_RADIUS_M,
  WAVE_FULL_RADIUS_M,
  WAVE_MIN_AMPLITUDE_SCALE,
  YAW_RAD_PER_SEC,
  isFigurineStabilized,
} from '../point-cloud/figurine-cloud-anim';

export type FigurinePointCloudLayer = 'wgsl' | 'compute';

interface WgslFigurineCloud {
  id: string;
  layer: WGSLLayer;
  originX: number;
  originY: number;
  /** Latched calm: uniforms stay put and the shader ignores player distance. */
  stable: boolean;
}

@Component({
  selector: 'app-map-gpu-root',
  imports: [Joystick, Player],
  templateUrl: './map-gpu-root.html',
  styleUrl: './map-gpu-root.css',
})
export class MapGpuRoot implements AfterViewInit, OnDestroy {
  @ViewChild('mapGpuContainer')
  private readonly mapGpuContainer!: ElementRef<HTMLDivElement>;
  private readonly playerRef = viewChild(Player);

  readonly usesJoystick = appConfigSettings.controls.mode === 'joystick';
  readonly showFps = appConfigSettings.debug.showFps;
  readonly joystickRadiusPx = appConfigSettings.controls.joystick.radiusPx;
  readonly followBearing = appConfigSettings.controls.joystick.followBearing;
  readonly playerScreenX = signal(0);
  readonly playerScreenY = signal(0);
  readonly playerVisible = signal(false);
  readonly rafFps = signal(0);
  readonly drawFps = signal(0);

  private readonly figurines = inject(FigurineCollection);
  private mapView!: MapView;
  private joystickVector: JoystickVector = { x: 0, y: 0 };
  private lastFrameMs: number | null = null;
  private renderEngine!: RenderEngine;
  private readonly computeClouds: ComputePointCloud[] = [];
  private readonly wgslClouds: WgslFigurineCloud[] = [];
  private joystickKeepAliveLayer: WGSLLayer | null = null;
  private fpsRafId: number | null = null;
  private fpsFrames = 0;
  private drawFrames = 0;
  private fpsWindowStartMs = 0;
  private readonly onDebugClick = ({
    mapPoint,
  }: {
    mapPoint: [number, number] | null;
  }): void => {
    if (!mapPoint) {
      return;
    }
    const [longitude, latitude] = mapPoint;
    console.log(`[debug] click coordinates: lon=${longitude}, lat=${latitude}`);
  };

  private readonly onFrame = (): void => {
    // Count real draw callbacks. mapgpu's own fps stays at the last value
    // after the view goes clean, so a static map looked "capped".
    if (this.showFps) {
      this.drawFrames += 1;
    }
    this.syncCloudPlayerProximity();
    if (!this.usesJoystick) {
      return;
    }

    this.syncPlayerScreen();
  };

  private syncCloudPlayerProximity(): void {
    if (this.computeClouds.length === 0 && this.wgslClouds.length === 0) {
      return;
    }
    const player = this.playerRef();
    if (!player) {
      return;
    }
    const longitude = player.longitude();
    const latitude = player.latitude();
    const [playerX, playerY] = lonLatToMercator(longitude, latitude);
    for (const cloud of this.computeClouds) {
      if (cloud.setPlayerLonLat(longitude, latitude) && cloud.figurineId) {
        this.figurines.collect(cloud.figurineId);
      }
    }
    for (const cloud of this.wgslClouds) {
      this.syncWgslCloud(cloud, playerX, playerY);
    }
  }

  private syncWgslCloud(cloud: WgslFigurineCloud, playerX: number, playerY: number): void {
    if (cloud.stable) {
      return;
    }
    const distance = Math.hypot(playerX - cloud.originX, playerY - cloud.originY);
    if (isFigurineStabilized(distance)) {
      cloud.stable = true;
      this.figurines.collect(cloud.id);
    }
    cloud.layer.setCustomUniforms(
      this.figurineCloudUniforms(cloud.originX, cloud.originY, playerX, playerY, cloud.stable),
    );
  }

  private figurineCloudUniforms(
    originX: number,
    originY: number,
    playerX: number,
    playerY: number,
    stable: boolean,
  ): Float32Array {
    return new Float32Array([
      originX,
      originY,
      playerX,
      playerY,
      WAVE_CALM_RADIUS_M,
      WAVE_FULL_RADIUS_M,
      YAW_RAD_PER_SEC,
      stable ? 1 : 0,
    ]);
  }

  async ngAfterViewInit(): Promise<void> {
    this.initMapGpu();
    await this.mapView.when();

    this.nudgeMapViewportSync();
    if (this.showFps) {
      this.startFpsSampler();
    }
    this.mapView.on('frame', this.onFrame);
    if (this.usesJoystick) {
      this.installJoystickRenderKeepAlive();
      const [longitude, latitude] = appConfigSettings.controls.joystick.playerStart;
      this.playerRef()?.place(longitude, latitude);
      this.lockFollowCamera();
      this.syncPlayerScreen();
    }
    await this.addFigurinePointClouds();
    this.syncCloudPlayerProximity();
  }


  private startFpsSampler(): void {
    if (this.fpsRafId !== null) {
      return;
    }
    this.fpsFrames = 0;
    this.drawFrames = 0;
    this.fpsWindowStartMs = performance.now();
    const tick = (now: number): void => {
      this.fpsFrames += 1;
      const elapsed = now - this.fpsWindowStartMs;
      if (elapsed >= 1000) {
        this.rafFps.set(Math.round((this.fpsFrames / elapsed) * 1000));
        this.drawFps.set(Math.round((this.drawFrames / elapsed) * 1000));
        this.fpsFrames = 0;
        this.drawFrames = 0;
        this.fpsWindowStartMs = now;
      }
      this.fpsRafId = requestAnimationFrame(tick);
    };
    this.fpsRafId = requestAnimationFrame(tick);
  }

  private stopFpsSampler(): void {
    if (this.fpsRafId === null) {
      return;
    }
    cancelAnimationFrame(this.fpsRafId);
    this.fpsRafId = null;
  }

  private installJoystickRenderKeepAlive(): void {
    if (this.joystickKeepAliveLayer) {
      return;
    }
    const layer = new WGSLLayer({
      id: '__joystick-render-keepalive',
      animated: true,
      topology: 'point-list',
      vertexBufferLayouts: [{
        arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
      }],
      vertexShader: `
@vertex
fn vs_main() -> @builtin(position) vec4<f32> {
  // Off-screen; draw count is 0 anyway.
  return vec4<f32>(2.0, 2.0, 0.0, 1.0);
}
`,
      fragmentShader: `
@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0);
}
`,
    });
    this.mapView.map.add(layer);
    layer.setDrawParams({ vertexCount: 0 });
    this.joystickKeepAliveLayer = layer;
  }

  private nudgeMapViewportSync(): void {
    const container = this.mapGpuContainer.nativeElement;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) {
      return;
    }
    const prev = container.style.width;
    container.style.width = `${container.clientWidth - 1}px`;
    requestAnimationFrame(() => {
      container.style.width = prev;
    });
  }

  async addFigurinePointClouds(): Promise<void> {
    await this.figurines.load();
    for (const figurine of this.figurines.figurines()) {
      await this.drawFigurinePointCloud(figurine.id, figurine.longitude, figurine.latitude, 'wgsl');
    }
  }

  ngOnDestroy(): void {
    this.stopFpsSampler();
    if (appConfigSettings.debug.logClickCoordinates) {
      this.mapView?.off('click', this.onDebugClick);
    }
    this.mapView?.off('frame', this.onFrame);
    if (this.usesJoystick) {
      this.mapView?.unlockCamera();
    }
    if (this.joystickKeepAliveLayer) {
      this.mapView?.map.remove(this.joystickKeepAliveLayer);
      this.joystickKeepAliveLayer = null;
    }
    for (const cloud of this.computeClouds) {
      cloud.destroy();
    }
    this.computeClouds.length = 0;
    for (const cloud of this.wgslClouds) {
      this.mapView?.map.remove(cloud.layer);
    }
    this.wgslClouds.length = 0;
  }

  onJoystickVector(vector: JoystickVector): void {
    this.joystickVector = vector;
  }

  initMapGpu(): void {
    this.renderEngine = new RenderEngine();
    const joystick = appConfigSettings.controls.joystick;
    const mapView = new MapView({
      container: this.mapGpuContainer.nativeElement,
      center: this.usesJoystick
        ? joystick.playerStart
        : [22.298340533604744, 48.62222379006886],
      zoom: this.usesJoystick ? joystick.followZoom : 17,
      renderEngine: this.renderEngine,
      mode: "3d",
      pitch: this.usesJoystick ? joystick.followPitch : 60,
      bearing: this.usesJoystick ? joystick.followBearing : 0,
      interaction: this.usesJoystick ? false : {},
    });

    this.mapView = mapView;

    if (appConfigSettings.debug.logClickCoordinates) {
      mapView.on('click', this.onDebugClick);
    }

    mapView.map.add(new RasterTileLayer({
      id: "osm",
      urlTemplate: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    }));

    // mapView.map.add(new VectorTileLayer({
    //   id: "buildings",
    //   url: "https://tiles.openfreemap.org/planet/20260311_001001_pt/{z}/{x}/{y}.pbf",
    //   sourceLayer: 'building',
    //   // OpenFreeMap planet tiles are empty above z14 here (HTTP 200, 0 bytes).
    //   // maxZoom clamps tile requests so camera zoom 15+ overzooms z14 meshes.
    //   minZoom: 13,
    //   maxZoom: 14,
    //   renderer: new SimpleRenderer({
    //     type: 'fill-extrusion',
    //     color: [180, 180, 200, 255],
    //     heightField: 'render_height'
    //   })
    // }));
  }

  drawTestSphere(): void {
    const sphereLayer = new GraphicsLayer({ id: `sphere` });
    sphereLayer.renderer = new SimpleRenderer({
      type: "mesh-3d",
      meshType: 'sphere',
      color: [188, 140, 255, 235],
      scale: [20, 20, 20]
    });

    sphereLayer.add({
      id: 'my-sphere',
      geometry: {
        type: 'Point',
        coordinates: [22.295, 48.62389],
      },
      attributes: {},
    });
    this.mapView.map.add(sphereLayer);

  }

  async drawTestPointCloudDynamicPointLayer(): Promise<void> {
    const mapView = this.mapView;
    const cloud = new DynamicPointLayer({
      id: 'painter-cloud',
      maxPoints: 200_000,
      symbol: {
        type: 'simple-marker',
        color: [188, 140, 255, 220],
        size: 2,
      },
    });

    mapView.map.add(cloud);
    await mapView.when();
    cloud.attachRenderEngine(this.renderEngine);
    const data = await fetch('data/json/point-clouds/painter.json').then(r => r.json());
    const anchorLon = 22.295;
    const anchorLat = 48.623;
    const [originX, originY] = lonLatToMercator(anchorLon, anchorLat);
    const scale = 60;
    const flatHeightCompensation = 2 * Math.PI;

    let minZ = Infinity;
    for (const p of data.points) {
      if (p.z < minZ) minZ = p.z;
    }

    const positions = new Float32Array(data.points.length * 3);
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i];
      positions[i * 3] = originX + p.x * scale;
      positions[i * 3 + 1] = originY + p.y * scale;
      positions[i * 3 + 2] =
        ((p.z - minZ) * scale) / flatHeightCompensation;
    }
    cloud.updatePositions(positions);
  }

  async drawTestPointCloudComputeShader(): Promise<void> {
    const cloud = await ComputePointCloud.create(
      this.mapView,
      this.renderEngine,
      'data/json/point-clouds/painter.json',
      {
        id: 'painter-cloud-compute',
        anchorLon: 22.2969,
        anchorLat: 48.6225,
        scale: 100,
      },
    );
    this.computeClouds.push(cloud);
  }

  async drawFigurinePointCloud(
    pointsJsonName: string,
    longitude: number,
    latitude: number,
    layer: FigurinePointCloudLayer,
  ): Promise<void> {
    switch (layer) {
      case 'wgsl':
        await this.drawFigurinePointCloudWgsl(pointsJsonName, longitude, latitude);
        break;
      case 'compute':
        await this.drawFigurinePointCloudCompute(pointsJsonName, longitude, latitude);
        break;
      default: {
        const _exhaustive: never = layer;
        throw new Error(`Unsupported figurine point cloud layer: ${String(_exhaustive)}`);
      }
    }
  }

  private async drawFigurinePointCloudCompute(
    pointsJsonName: string,
    longitude: number,
    latitude: number,
  ): Promise<void> {
    const jsonName = pointsJsonName.endsWith('.json')
      ? pointsJsonName
      : `${pointsJsonName}.json`;
    const cloud = await ComputePointCloud.create(
      this.mapView,
      this.renderEngine,
      `data/json/point-clouds/${jsonName}`,
      {
        id: `${pointsJsonName}-cloud-compute`,
        figurineId: pointsJsonName,
        anchorLon: longitude,
        anchorLat: latitude,
        scale: 120,
      },
    );
    this.computeClouds.push(cloud);
  }

  async drawFigurinePointCloudWgslDebug(pointsJsonName: string, longitude: number, latitude: number): Promise<void> {
    console.log("drawFigurinePointCloudWgslDebug", pointsJsonName, longitude, latitude);
    const [originX, originY] = lonLatToMercator(longitude, latitude);
    const layer = new WGSLLayer({
      id: "test-layer",
      animated: false,
      topology: 'triangle-list',
      vertexBufferLayouts: [{
        arrayStride: 12,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" }
        ]
      }],
      vertexShader: `
      `,
      fragmentShader: `
      `
    });
    this.mapView.map.add(layer);
    await this.mapView.when();
  }

  private async drawFigurinePointCloudWgsl(
    pointsJsonName: string,
    longitude: number,
    latitude: number,
  ): Promise<void> {
    const mapView = this.mapView;
    const [originX, originY] = lonLatToMercator(longitude, latitude);

    const layer = new WGSLLayer({
      id: `${pointsJsonName}-cloud-wgsl`,
      animated: true,
      topology: 'triangle-list',
      vertexBufferLayouts: [{
        arrayStride: 32,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32' },
        ],
      }],
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
      vertexShader: `
struct CustomUniforms {
  originXY: vec2<f32>,
  playerXY: vec2<f32>,
  calmRadius: f32,
  fullRadius: f32,
  yawRadPerSec: f32,
  stable: f32,
};

struct VertexInput {
  @location(0) position: vec3<f32>,
  // x = wavelength/period (seconds), y = phase (rad), z = amplitude (metres)
  @location(1) wave: vec3<f32>,
  @location(2) heightT: f32,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) heightT: f32,
  @location(1) uv: vec2<f32>,
};

const EARTH_RADIUS_M: f32 = 6378137.0;
const TWO_PI: f32 = 6.28318530718;
const POINT_SIZE_FAR: f32 = ${POINT_SIZE_FAR_PX};
const POINT_SIZE_NEAR: f32 = ${POINT_SIZE_NEAR_PX};
const MIN_AMP_SCALE: f32 = ${WAVE_MIN_AMPLITUDE_SCALE};

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

  // Slow spin around the figurine up-axis (through the anchor).
  let angle = frame.time * custom.yawRadPerSec;
  let c = cos(angle);
  let s = sin(angle);
  let dx = input.position.x - custom.originXY.x;
  let dy = input.position.y - custom.originXY.y;
  var animatedPos = vec3<f32>(
    custom.originXY.x + dx * c - dy * s,
    custom.originXY.y + dx * s + dy * c,
    input.position.z,
  );

  // Dampen vertical wave as the player nears this point; grow sprite size.
  // stable latches the calm pose so leaving the figurine does not revive the wave.
  let dist = length(animatedPos.xy - custom.playerXY);
  let proximity = 1.0 - smoothstep(custom.calmRadius, custom.fullRadius, dist);
  let nearness = select(proximity, 1.0, custom.stable > 0.5);
  let ampScale = mix(1.0, MIN_AMP_SCALE, nearness);
  let pointSize = mix(POINT_SIZE_FAR, POINT_SIZE_NEAR, nearness);

  let wavelength = max(input.wave.x, 0.05);
  animatedPos.z += sin(frame.time * (TWO_PI / wavelength) + input.wave.y)
    * input.wave.z * ampScale;

  let offset = quadOffsets[vid];
  let clipCenter = projectPoint(animatedPos);
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
  out.heightT = input.heightT;
  out.uv = offset + vec2<f32>(0.5, 0.5);
  return out;
}
`,
      fragmentShader: `
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let centered = input.uv - vec2<f32>(0.5, 0.5);
  let dist = length(centered);
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

    mapView.map.add(layer);
    await mapView.when();

    // Seed custom uniforms before first draw so the pipeline includes @group(2).
    layer.setCustomUniforms(this.figurineCloudUniforms(originX, originY, 1e12, 1e12, false));

    const jsonName = pointsJsonName.endsWith('.json')
      ? pointsJsonName
      : `${pointsJsonName}.json`;
    const data = await fetch(`data/json/point-clouds/${jsonName}`).then(r => r.json());
    const scale = 100;
    const flatHeightCompensation = 2 * Math.PI;

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of data.points) {
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const zSpan = Math.max(maxZ - minZ, 1e-6);

    // Interleaved: rest.xyz, wavelength, phase, amplitude, heightT, pad — uploaded once.
    const instances = new Float32Array(data.points.length * 8);
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i];
      const base = i * 8;
      instances[base] = originX + p.x * scale;
      instances[base + 1] = originY + p.y * scale;
      instances[base + 2] = ((p.z - minZ) * scale) / flatHeightCompensation;

      const hash = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719));
      instances[base + 3] = 0.7 + hash * 2.8;           // wavelength / period
      instances[base + 4] = (p.x + p.y * 2.0 + p.z) * 8; // phase
      instances[base + 5] = 1.2 + hash * 2.8;             // amplitude
      instances[base + 6] = (p.z - minZ) / zSpan;         // heightT gradient
      instances[base + 7] = 0;
    }

    // VERTEX | COPY_DST — uploaded once; animation does not rewrite this buffer.
    const buffer = this.renderEngine.createBuffer(instances, 0x0020 | 0x0008);
    layer.setVertexBuffer(0, buffer);
    layer.setDrawParams({
      vertexCount: 6,
      instanceCount: data.points.length,
    });
    this.wgslClouds.push({ id: pointsJsonName, layer, originX, originY, stable: false });
    layer.requestRender();
  }

  private lockFollowCamera(): void {
    const joystick = appConfigSettings.controls.joystick;
    this.mapView.lockCamera({
      fields: ['center', 'zoom', 'pitch', 'bearing'],
      getTarget: () => {
        this.advancePlayerFromJoystick();
        const player = this.playerRef();
        if (!player) {
          return undefined;
        }
        return {
          center: [player.longitude(), player.latitude()],
          zoom: joystick.followZoom,
          pitch: joystick.followPitch,
          bearing: joystick.followBearing,
        };
      },
    });
  }

  private advancePlayerFromJoystick(): void {
    const now = performance.now();
    const previous = this.lastFrameMs;
    this.lastFrameMs = now;
    if (previous === null) {
      return;
    }
    const dtSeconds = Math.min(0.05, (now - previous) / 1000);
    this.playerRef()?.step(
      this.joystickVector,
      dtSeconds,
      this.followBearing,
      appConfigSettings.controls.joystick.moveSpeedMps,
    );
  }

  private syncPlayerScreen(): void {
    const player = this.playerRef();
    if (!player || !this.mapView) {
      return;
    }
    const screen = this.mapView.toScreen(player.longitude(), player.latitude());
    if (!screen) {
      this.playerVisible.set(false);
      return;
    }
    this.playerScreenX.set(screen[0]);
    this.playerScreenY.set(screen[1]);
    this.playerVisible.set(true);
  }
}