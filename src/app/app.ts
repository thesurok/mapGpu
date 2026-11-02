import { Component, signal } from '@angular/core';
import { MapGpuRoot } from './map-gpu-root/map-gpu-root';

@Component({
  selector: 'app-root',
  imports: [MapGpuRoot],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('map-gpu-playground');
}
