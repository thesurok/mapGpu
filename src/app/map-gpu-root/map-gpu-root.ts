import { Component, type ElementRef, AfterViewInit, OnDestroy, ViewChild } from '@angular/core';
import { MapView, SimpleRenderer, lonLatToMercator } from "mapgpu/core";
import { RenderEngine } from "mapgpu/render";
import { GraphicsLayer, RasterTileLayer, VectorTileLayer, DynamicPointLayer, WGSLLayer } from "mapgpu/layers";
import { ComputePointCloud } from '../point-cloud/compute-point-cloud';

@Component({
  selector: 'app-map-gpu-root',
  imports: [],
  templateUrl: './map-gpu-root.html',
  styleUrl: './map-gpu-root.css',
})

export class MapGpuRoot implements AfterViewInit, OnDestroy {
  @ViewChild('mapGpuContainer')
  private readonly mapGpuContainer!: ElementRef<HTMLDivElement>;
  private mapView!: MapView;
  private renderEngine!: RenderEngine;
  private computeCloud: ComputePointCloud | null = null;


  ngAfterViewInit(): void {
    this.initMapGpu();
  }

  ngOnDestroy(): void {
    this.computeCloud?.destroy();
    this.computeCloud = null;
  }

  initMapGpu(): void {
    this.renderEngine = new RenderEngine();
    const mapView = new MapView({
      container: this.mapGpuContainer.nativeElement,
      center: [22.29500, 48.62389],
      zoom: 17,
      renderEngine: this.renderEngine,
      mode: "3d",
      pitch: 60
    });

    this.mapView = mapView;

    mapView.map.add(new RasterTileLayer({
      id: "osm",
      urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    }));

    const buildings = new VectorTileLayer({
      id: "buildings",
      url: "https://tiles.openfreemap.org/planet/20260311_001001_pt/{z}/{x}/{y}.pbf",
      sourceLayer: 'building',
      minZoom: 13,
      maxZoom: 14,
      renderer: new SimpleRenderer({
        type: 'fill-extrusion',
        color: [180, 180, 200, 255],
        heightField: 'render_height'
      })
    });

    mapView.map.add(buildings);

    this.drawTestPointCloudComputeShader();
    // this.drawTestPointCloudDynamicPointLayer();
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
    const data = await fetch('/data/json/point-clouds/painter.json').then(r => r.json());
    const anchorLon = 22.295;
    const anchorLat = 48.623;
    const [originX, originY] = lonLatToMercator(anchorLon, anchorLat);
    const scale = 120;
    const flatHeightCompensation = 2 * Math.PI;

    let minZ = Infinity;
    for (const p of data.points) {
      if (p.z < minZ) minZ = p.z;
    }

    const positions = new Float32Array(data.points.length * 3);
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i];
      // Blender world → map: X east, Y north, Z up
      positions[i * 3] = originX + p.x * scale;
      positions[i * 3 + 1] = originY + p.y * scale;
      positions[i * 3 + 2] =
        ((p.z - minZ) * scale) / flatHeightCompensation;
    }
    cloud.updatePositions(positions);
  }
  async drawTestPointCloudComputeShader(): Promise<void> {
    this.computeCloud?.destroy();
    this.computeCloud = await ComputePointCloud.create(
      this.mapView,
      this.renderEngine,
      '/data/json/point-clouds/painter.json',
      {
        id: 'painter-cloud-compute',
        anchorLon: 22.2969,
        anchorLat: 48.6225,
        scale: 100,
      },
    );
  }


  async drawTestPointCloudWGSLLayerExample(): Promise<void> {
    const mapView = this.mapView;

    // Mode3D injects camera/frame uniforms + Mercator helpers; projectMercator()
    // ignores altitude, so we project XYZ ourselves (same as globe-point-pipeline).
    // animated: true → MapView marks the render loop dirty every pre-frame tick;
    // frame.time is rewritten each draw — no CPU position uploads.
    const layer = new WGSLLayer({
      id: 'painter-cloud-wgsl',
      animated: true,
      topology: 'triangle-list',
      vertexBufferLayouts: [{
        arrayStride: 24, // rest.xyz + wave(wavelength, phase, amplitude)
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
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
      vertexShader: /* wgsl */ `
struct VertexInput {
  @location(0) position: vec3<f32>,
  // x = wavelength/period (seconds), y = phase (rad), z = amplitude (metres)
  @location(1) wave: vec3<f32>,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

const EARTH_RADIUS_M: f32 = 6378137.0;
const POINT_SIZE: f32 = 1.0;
const TWO_PI: f32 = 6.28318530718;

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

  // GPU sine: rest pose stays on GPU; only frame.time changes each frame.
  let wavelength = max(input.wave.x, 0.05);
  let phase = input.wave.y;
  let amplitude = input.wave.z;
  var animatedPos = input.position;
  animatedPos.z += sin(frame.time * (TWO_PI / wavelength) + phase) * amplitude;

  let offset = quadOffsets[vid];
  let clipCenter = projectPoint(animatedPos);
  let screenOffset = offset * POINT_SIZE;
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
  out.uv = offset + vec2<f32>(0.5, 0.5);
  return out;
}
`,
      fragmentShader: /* wgsl */ `
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let centered = input.uv - vec2<f32>(0.5, 0.5);
  let dist = length(centered);
  if (dist > 0.5) {
    discard;
  }
  let color = vec4<f32>(188.0 / 255.0, 140.0 / 255.0, 255.0 / 255.0, 220.0 / 255.0);
  return vec4<f32>(color.rgb, color.a * frame.opacity);
}
`,
    });

    mapView.map.add(layer);
    await mapView.when();

    const data = await fetch('/data/json/point-clouds/painter.json').then(r => r.json());
    const anchorLon = 22.295;
    const anchorLat = 48.623;
    const [originX, originY] = lonLatToMercator(anchorLon, anchorLat);
    const scale = 120;
    const flatHeightCompensation = 2 * Math.PI;

    let minZ = Infinity;
    for (const p of data.points) {
      if (p.z < minZ) minZ = p.z;
    }

    // Interleaved: rest.xyz, wavelength (s), phase (rad), amplitude (m) — uploaded once.
    const instances = new Float32Array(data.points.length * 6);
    for (let i = 0; i < data.points.length; i++) {
      const p = data.points[i];
      const base = i * 6;
      instances[base] = originX + p.x * scale;
      instances[base + 1] = originY + p.y * scale;
      instances[base + 2] = ((p.z - minZ) * scale) / flatHeightCompensation;

      // Stable per-point params from Blender coords (different wavelengths across the cloud).
      const hash = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719));
      instances[base + 3] = 0.7 + hash * 2.8;           // wavelength / period: ~0.7–3.5 s
      instances[base + 4] = (p.x + p.y * 2.0 + p.z) * 8; // phase
      instances[base + 5] = 0.35 + hash * 0.9;           // amplitude in stored height units
    }

    // VERTEX | COPY_DST — uploaded once; animation does not rewrite this buffer.
    const buffer = this.renderEngine.createBuffer(instances, 0x0020 | 0x0008);
    layer.setVertexBuffer(0, buffer);
    layer.setDrawParams({
      vertexCount: 6,
      instanceCount: data.points.length,
    });
    layer.requestRender();
  }
}