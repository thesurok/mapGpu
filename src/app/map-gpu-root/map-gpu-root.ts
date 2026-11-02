import { Component, type ElementRef, AfterViewInit, ViewChild } from '@angular/core';
import { MapView, SimpleRenderer } from "mapgpu/core";
import { RenderEngine } from "mapgpu/render";
import { RasterTileLayer, VectorTileLayer } from "mapgpu/layers";

@Component({
  selector: 'app-map-gpu-root',
  imports: [],
  templateUrl: './map-gpu-root.html',
  styleUrl: './map-gpu-root.css',
})

export class MapGpuRoot implements AfterViewInit {
  @ViewChild('mapGpuContainer')
  private readonly mapGpuContainer!: ElementRef<HTMLDivElement>;


  ngAfterViewInit(): void {
    this.initMapGpu();
  }

  async initMapGpu(): Promise<void> {
    const mapView = new MapView({
      container: this.mapGpuContainer.nativeElement,
      center: [22.29500, 48.62389],
      zoom: 15,
      renderEngine: new RenderEngine(),
      mode: "3d",
      pitch: 60
    });

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
        color: [180, 180, 200, 220],
        heightField: 'render_height',
        // minHeightField: 'render_min_height',
        // ambient: 0.35,
      })
    });

    mapView.map.add(buildings);

  }
}
