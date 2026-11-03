import { Component, type ElementRef, AfterViewInit, ViewChild } from '@angular/core';
import { MapView, SimpleRenderer } from "mapgpu/core";
import { RenderEngine } from "mapgpu/render";
import { GraphicsLayer, RasterTileLayer, VectorTileLayer } from "mapgpu/layers";

@Component({
  selector: 'app-map-gpu-root',
  imports: [],
  templateUrl: './map-gpu-root.html',
  styleUrl: './map-gpu-root.css',
})

export class MapGpuRoot implements AfterViewInit {
  @ViewChild('mapGpuContainer')
  private readonly mapGpuContainer!: ElementRef<HTMLDivElement>;
  private mapView!: MapView;


  ngAfterViewInit(): void {
    this.initMapGpu();
  }

  initMapGpu(): void {
    const mapView = new MapView({
      container: this.mapGpuContainer.nativeElement,
      center: [22.29500, 48.62389],
      zoom: 13,
      renderEngine: new RenderEngine(),
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
      performance: {
        mode: 'legacy',          // avoid worker 404 spam / failed parses
        maxInFlightTiles: 16,    // default is ~8; raise if network allows
      },
      renderer: new SimpleRenderer({
        type: 'fill-extrusion',
        color: [180, 180, 200, 255],
        heightField: 'render_height',

        // minHeightField: 'render_min_height',
        // ambient: 0.35,
      })
    });

    mapView.map.add(buildings);

    this.drawTestSphere();
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
}