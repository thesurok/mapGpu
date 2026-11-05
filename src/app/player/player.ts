import { Component, computed, input, signal } from '@angular/core';
import { appConfigSettings } from '../config/app-config';
import { joystickToEastNorth, offsetLonLat, type JoystickVector } from '../movement/ground-movement';

/** Nipple deflections smaller than this do not move or turn the player. */
const NIPPLE_DEADZONE = 0.08;

/**
 * Ground player drawn as a 2D marker.
 *
 * Geographic position (longitude / latitude) is the 3D location on the map.
 * The parent projects that position with `MapView.toScreen` and passes the
 * resulting CSS pixel as `screenX` / `screenY`. Nipple input is applied in
 * `step` via `joystickToEastNorth` and `offsetLonLat`.
 */
@Component({
  selector: 'app-player',
  imports: [],
  templateUrl: './player.html',
  styleUrl: './player.css',
})
export class Player {
  /** CSS pixel from `MapView.toScreen`, relative to the map overlay. */
  readonly screenX = input(0);
  readonly screenY = input(0);
  /** Camera bearing in degrees clockwise from north. Used only to face the marker on screen. */
  readonly cameraBearingDeg = input(0);
  readonly visible = input(false);

  private readonly start = appConfigSettings.controls.joystick.playerStart;
  readonly longitude = signal(this.start[0]);
  readonly latitude = signal(this.start[1]);
  readonly headingDeg = signal(0);

  /** Screen-space facing: world heading minus the camera's clockwise bearing. */
  readonly markerTransform = computed(
    () => `translate(-50%, -50%) rotate(${this.headingDeg() - this.cameraBearingDeg()}deg)`,
  );

  place(longitude: number, latitude: number): void {
    this.longitude.set(longitude);
    this.latitude.set(latitude);
    this.headingDeg.set(0);
  }

  /**
   * Advance one frame from the current nipple vector.
   * `bearingDeg` is the locked camera bearing, so stick-up matches screen-up.
   */
  step(vector: JoystickVector, dtSeconds: number, bearingDeg: number, speedMps: number): void {
    const ground = joystickToEastNorth(vector, bearingDeg);
    if (Math.hypot(ground.east, ground.north) < NIPPLE_DEADZONE) {
      return;
    }
    const distance = speedMps * dtSeconds;
    const next = offsetLonLat(
      this.longitude(),
      this.latitude(),
      ground.east * distance,
      ground.north * distance,
    );
    this.longitude.set(next.longitude);
    this.latitude.set(next.latitude);
    this.headingDeg.set((Math.atan2(ground.east, ground.north) * 180) / Math.PI);
  }
}
