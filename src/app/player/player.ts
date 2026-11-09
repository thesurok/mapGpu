import { Component, computed, inject, input, signal } from '@angular/core';
import { appConfigSettings } from '../config/app-config';
import { FigurineCollection } from '../figurine/figurine-collection';
import { nearestUnclaimedFigurine } from '../figurine/nearest-unclaimed';
import {
  applyStickDeadzone,
  dampDegrees,
  joystickToEastNorth,
  offsetLonLat,
  smoothEastNorth,
  type EastNorthMeters,
  type JoystickVector,
} from '../movement/ground-movement';

/** Nipple deflections smaller than this do not move or turn the player. */
const NIPPLE_DEADZONE = 0.08;
/** Nose turns a little quicker than the body changes speed. */
const HEADING_RESPONSE_SECONDS = 0.1;
/** Below this, and with the stick released, velocity is cleared so the player does not creep. */
const STOP_SPEED_MPS = 0.2;

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
  private readonly collection = inject(FigurineCollection);

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
  /** Set once the player walks far enough to leave the stick dead zone. */
  readonly hasMoved = signal(false);
  /** Smoothed ground velocity in metres per second. The stick is the target, not the value. */
  private velocity: EastNorthMeters = { east: 0, north: 0 };

  /** Closest figurine that is still unclaimed. */
  readonly nextTarget = computed(() =>
    nearestUnclaimedFigurine(
      this.longitude(),
      this.latitude(),
      this.collection.figurines(),
      this.collection.collected(),
    ),
  );

  /** Ground metres to `nextTarget`, rounded for the counter. */
  readonly distanceM = computed(() => {
    const target = this.nextTarget();
    return target ? Math.round(target.distanceM) : 0;
  });

  /** Screen-space facing: world heading minus the camera's clockwise bearing. */
  readonly markerTransform = computed(
    () => `translate(-50%, -50%) rotate(${this.headingDeg() - this.cameraBearingDeg()}deg)`,
  );

  /** Points from the player toward the next unclaimed cloud, in screen space. */
  readonly arrowTransform = computed(() => {
    const target = this.nextTarget();
    const bearing = target ? target.bearingDeg : 0;
    return `translate(-50%, -50%) rotate(${bearing - this.cameraBearingDeg()}deg)`;
  });

  place(longitude: number, latitude: number): void {
    this.longitude.set(longitude);
    this.latitude.set(latitude);
    this.headingDeg.set(0);
    this.velocity = { east: 0, north: 0 };
  }

  /**
   * Advance one frame from the current nipple vector.
   * `bearingDeg` is the locked camera bearing, so stick-up matches screen-up.
   * Speed and heading ease toward the stick so a jittery finger does not lurch the camera.
   */
  step(vector: JoystickVector, dtSeconds: number, bearingDeg: number, speedMps: number): void {
    const stick = applyStickDeadzone(vector, NIPPLE_DEADZONE);
    const ground = joystickToEastNorth(stick, bearingDeg);
    const target = {
      east: ground.east * speedMps,
      north: ground.north * speedMps,
    };
    if (target.east !== 0 || target.north !== 0) {
      this.hasMoved.set(true);
    }
    const response = appConfigSettings.controls.joystick.moveResponseSeconds;
    const currentSpeed = Math.hypot(this.velocity.east, this.velocity.north);
    const targetSpeed = Math.hypot(target.east, target.north);
    // Ease off faster than speeding up, so letting go does not turn into a long slide.
    const tau = targetSpeed + 0.01 < currentSpeed ? response * 0.5 : response;
    const velocity = smoothEastNorth(this.velocity, target, dtSeconds, tau);
    const speed = Math.hypot(velocity.east, velocity.north);
    if (speed < STOP_SPEED_MPS && target.east === 0 && target.north === 0) {
      this.velocity = { east: 0, north: 0 };
      return;
    }
    this.velocity = velocity;
    const next = offsetLonLat(
      this.longitude(),
      this.latitude(),
      velocity.east * dtSeconds,
      velocity.north * dtSeconds,
    );
    this.longitude.set(next.longitude);
    this.latitude.set(next.latitude);
    const heading = (Math.atan2(velocity.east, velocity.north) * 180) / Math.PI;
    this.headingDeg.set(dampDegrees(this.headingDeg(), heading, dtSeconds, HEADING_RESPONSE_SECONDS));
  }
}
