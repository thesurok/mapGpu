import { Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { type JoystickVector } from '../movement/ground-movement';

/**
 * Virtual stick that appears where the pointer goes down.
 * The nipple follows the pointer, clamped to the base radius, and emits a
 * normalised screen vector (positive x right, positive y down) until release.
 */
@Component({
  selector: 'app-joystick',
  imports: [],
  templateUrl: './joystick.html',
  styleUrl: './joystick.css',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerUp($event)',
  },
})
export class Joystick {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Base radius in CSS pixels. The nipple cannot travel past this. */
  readonly radiusPx = input(72);

  /** Fires on press, drag, and release. Release is the zero vector. */
  readonly vectorChange = output<JoystickVector>();

  readonly active = signal(false);
  readonly originX = signal(0);
  readonly originY = signal(0);
  readonly nippleX = signal(0);
  readonly nippleY = signal(0);

  readonly diameterPx = computed(() => this.radiusPx() * 2);
  readonly nippleTransform = computed(
    () => `translate(calc(-50% + ${this.nippleX()}px), calc(-50% + ${this.nippleY()}px))`,
  );

  private pointerId: number | null = null;

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.pointerId !== null) {
      return;
    }
    event.preventDefault();
    const point = this.localPoint(event);
    this.pointerId = event.pointerId;
    this.host.nativeElement.setPointerCapture(event.pointerId);
    this.originX.set(point.x);
    this.originY.set(point.y);
    this.nippleX.set(0);
    this.nippleY.set(0);
    this.active.set(true);
    this.vectorChange.emit({ x: 0, y: 0 });
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    const point = this.localPoint(event);
    const dx = point.x - this.originX();
    const dy = point.y - this.originY();
    const radius = this.radiusPx();
    const distance = Math.hypot(dx, dy);
    const scale = distance > radius && distance > 0 ? radius / distance : 1;
    const nippleX = dx * scale;
    const nippleY = dy * scale;
    this.nippleX.set(nippleX);
    this.nippleY.set(nippleY);
    this.vectorChange.emit({
      x: nippleX / radius,
      y: nippleY / radius,
    });
  }

  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    const element = this.host.nativeElement;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    this.pointerId = null;
    this.nippleX.set(0);
    this.nippleY.set(0);
    this.active.set(false);
    this.vectorChange.emit({ x: 0, y: 0 });
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.host.nativeElement.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }
}
