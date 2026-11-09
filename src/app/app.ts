import { Component, signal } from '@angular/core';
import { MapGpuRoot } from './map-gpu-root/map-gpu-root';
import { ControlPanel } from './control-panel/control-panel';
import { FigurineCalloutView } from './figurine-callout/figurine-callout';

@Component({
  selector: 'app-root',
  imports: [MapGpuRoot, ControlPanel, FigurineCalloutView],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('map-gpu-playground');
}
