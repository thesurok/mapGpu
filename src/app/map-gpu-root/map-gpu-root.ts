import { Component, type ElementRef, AfterViewInit, OnDestroy, ViewChild, signal, viewChild } from '@angular/core';
import { MapView, SimpleRenderer, lonLatToMercator } from "mapgpu/core";
import { RenderEngine } from "mapgpu/render";
import { GraphicsLayer, RasterTileLayer, VectorTileLayer, DynamicPointLayer, WGSLLayer } from "mapgpu/layers";
import { appConfigSettings } from '../config/app-config';
import { Joystick } from '../joystick/joystick';
import { type JoystickVector } from '../movement/ground-movement';
import { Player } from '../player/player';
import { ComputePointCloud } from '../point-cloud/compute-point-cloud';

/** Extensible layer backend for figurine point clouds. Add new kinds as support lands. */
export type FigurinePointCloudLayer = 'wgsl' | 'compute';

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

  /** True when config selects the joystick player instead of map pan/zoom. */
  readonly usesJoystick = appConfigSettings.controls.mode === 'joystick';
  readonly showFps = appConfigSettings.debug.showFps;
  readonly joystickRadiusPx = appConfigSettings.controls.joystick.radiusPx;
  readonly followBearing = appConfigSettings.controls.joystick.followBearing;
  readonly playerScreenX = signal(0);
  readonly playerScreenY = signal(0);
  readonly playerVisible = signal(false);
  /** Browser animation-frame rate (independent of MapView dirty checks). */
  readonly rafFps = signal(0);
  /** MapView dirty-render rate; ~0 when the map is idle/static. */
  readonly drawFps = signal(0);

  private mapView!: MapView;
  private joystickVector: JoystickVector = { x: 0, y: 0 };
  private lastFrameMs: number | null = null;
  private renderEngine!: RenderEngine;
  private readonly computeClouds: ComputePointCloud[] = [];
  /** Animated no-op layer so MapView stays dirty without figurine clouds. */
  private joystickKeepAliveLayer: WGSLLayer | null = null;
  private fpsRafId: number | null = null;
  private fpsFrames = 0;
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

  private readonly onFrame = (event?: { frameNumber: number; fps: number }): void => {
    if (this.showFps && event && Number.isFinite(event.fps)) {
      this.drawFps.set(Math.round(event.fps));
    }
    if (!this.usesJoystick) {
      return;
    }
    // Motion advances in lockCamera getTarget (pre-frame) so the camera and
    // player share the same lon/lat for this draw. Only project the marker here.
    this.syncPlayerScreen();
  };

  async ngAfterViewInit(): Promise<void> {
    this.initMapGpu();
    await this.mapView.when();
    // Ensure Mode3D frustum matches the laid-out container (ResizeObserver
    // used to skip onResize when the canvas backing store already matched,
    // which left buildings missing until a DevTools-driven resize).
    this.nudgeMapViewportSync();
    if (this.showFps) {
      this.startFpsSampler();
    }
    if (this.usesJoystick || this.showFps) {
      this.mapView.on('frame', this.onFrame);
    }
    if (this.usesJoystick) {
      this.installJoystickRenderKeepAlive();
      const [longitude, latitude] = appConfigSettings.controls.joystick.playerStart;
      this.playerRef()?.place(longitude, latitude);
      this.lockFollowCamera();
      this.syncPlayerScreen();
    }
    await this.addFigurinePointClouds();
  }

  /**
   * rAF-based sampler so the overlay keeps updating on a static MapView
   * (dirty-checking correctly stops emitting `frame` when nothing changes).
   */
  private startFpsSampler(): void {
    if (this.fpsRafId !== null) {
      return;
    }
    this.fpsFrames = 0;
    this.fpsWindowStartMs = performance.now();
    const tick = (now: number): void => {
      this.fpsFrames += 1;
      const elapsed = now - this.fpsWindowStartMs;
      if (elapsed >= 1000) {
        this.rafFps.set(Math.round((this.fpsFrames / elapsed) * 1000));
        this.fpsFrames = 0;
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

  /**
   * Figurines' `animated: true` WGSL layers mark the render loop dirty every
   * pre-frame. Without them the loop idles and joystick `lockCamera` stepping
   * never runs. This invisible animated layer restores that heartbeat.
   */
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
      vertexShader: /* wgsl */ `
@vertex
fn vs_main() -> @builtin(position) vec4<f32> {
  // Off-screen; draw count is 0 anyway.
  return vec4<f32>(2.0, 2.0, 0.0, 1.0);
}
`,
      fragmentShader: /* wgsl */ `
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

  /** Force MapView's ResizeObserver path so tile covering uses the real viewport. */
  private nudgeMapViewportSync(): void {
    const container = this.mapGpuContainer.nativeElement;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) {
      return;
    }
    const prev = container.style.width;
    // 1px toggle is enough for ResizeObserver; restored next frame.
    container.style.width = `${container.clientWidth - 1}px`;
    requestAnimationFrame(() => {
      container.style.width = prev;
    });
  }

  async addFigurinePointClouds(): Promise<void> {
    const fogurinesData = await fetch('/data/figurines-data.json').then(r => r.json());
    for (const figurine of Object.keys(fogurinesData)) {
      const data = fogurinesData[figurine];
      console.log(data);
      await this.drawFigurinePointCloud(figurine, data.longitude, data.latitude, 'compute');
    }
  }

  ngOnDestroy(): void {
    this.stopFpsSampler();
    if (appConfigSettings.debug.logClickCoordinates) {
      this.mapView?.off('click', this.onDebugClick);
    }
    if (this.usesJoystick || this.showFps) {
      this.mapView?.off('frame', this.onFrame);
    }
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
      urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
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
      '/data/json/point-clouds/painter.json',
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
      `/data/json/point-clouds/${jsonName}`,
      {
        id: `${pointsJsonName}-cloud-compute`,
        anchorLon: longitude,
        anchorLat: latitude,
        scale: 120,
      },
    );
    this.computeClouds.push(cloud);
  }

  private async drawFigurinePointCloudWgsl(
    pointsJsonName: string,
    longitude: number,
    latitude: number,
  ): Promise<void> {
    const mapView = this.mapView;


    const layer = new WGSLLayer({
      id: `${pointsJsonName}-cloud-wgsl`,
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
      vertexShader: `
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
      fragmentShader: `
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

    const jsonName = pointsJsonName.endsWith('.json')
      ? pointsJsonName
      : `${pointsJsonName}.json`;
    const data = await fetch(`/data/json/point-clouds/${jsonName}`).then(r => r.json());
    const [originX, originY] = lonLatToMercator(longitude, latitude);
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
      instances[base + 5] = 1.2 + hash * 2.8;             // amplitude in stored height units
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

  /**
   * Advance the player from the latest nipple vector.
   * Mapping lives in `ground-movement.ts`. Screen projection is separate
   * (`syncPlayerScreen`) so it can run after the camera has locked.
   */
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

  /** `toScreen` is the 3D ground point projected into the 2D overlay. */
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