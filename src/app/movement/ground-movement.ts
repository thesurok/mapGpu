import { EARTH_RADIUS, MAX_LAT } from 'mapgpu/core';
import { degreesToRadians } from '../utils/degrees-to-radians';

/**
 * Nipple offset inside the joystick component.
 * Both axes are normalised by the base radius, so a nipple on the rim has length 1.
 * `x` is positive to the right. `y` is positive down, matching CSS and pointer events.
 */
export interface JoystickVector {
  x: number;
  y: number;
}

/** East/north displacement on the local ground plane, in metres. */
export interface EastNorthMeters {
  east: number;
  north: number;
}

const METERS_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS;

/**
 * Map a 2D nipple offset onto the ground plane around the player.
 *
 * The joystick is a screen-space control. Its `x`/`y` are not longitude or
 * latitude. This turns that deflection into metres of east/north travel:
 *
 * 1. Flip Y. Screen +y points down, and with a north-up camera the ground's
 *    north points up the screen, so "stick up" is `-y`.
 * 2. Rotate by the camera bearing (degrees clockwise from north, the same
 *    convention as MapView). Stick-up then walks toward the top of the view
 *    and stick-right walks toward the right edge, including when the camera
 *    is turned.
 * 3. Keep the deflection as the vector length. A nipple halfway to the rim
 *    produces a vector of length 0.5, so speed scales with how far it is pushed.
 *
 * Web Mercator metres are intentionally not used. Mercator Y is stretched by
 * `1 / cos(latitude)`, so treating those metres as ground distance would make
 * the same nipple walk farther as the player leaves the equator.
 */
export function joystickToEastNorth(vector: JoystickVector, bearingDeg: number): EastNorthMeters {
  const bearing = degreesToRadians(bearingDeg);
  const sin = Math.sin(bearing);
  const cos = Math.cos(bearing);
  const right = vector.x;
  const up = -vector.y;
  return {
    east: up * sin + right * cos,
    north: up * cos - right * sin,
  };
}

/**
 * Step a geographic position by an east/north ground offset.
 *
 * A degree of latitude is a fixed arc (`π/180 × Earth radius`). A degree of
 * longitude shrinks by `cos(latitude)`, so the same eastward metres become a
 * larger longitude change toward the poles. Latitude is clamped to the Web
 * Mercator limit the map itself can display.
 */
/**
 * Ground metres from one geographic point to another.
 * East and north use the same degree lengths as `offsetLonLat`.
 */
export function eastNorthBetween(
  fromLongitude: number,
  fromLatitude: number,
  toLongitude: number,
  toLatitude: number,
): EastNorthMeters {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(degreesToRadians(fromLatitude));
  return {
    east: (toLongitude - fromLongitude) * metersPerDegLon,
    north: (toLatitude - fromLatitude) * METERS_PER_DEG_LAT,
  };
}

const MIN_RESPONSE_SECONDS = 1e-3;

/**
 * Ease a ground velocity toward a target.
 *
 * `responseSeconds` is the exponential time constant. The same target sampled
 * as one step or as several shorter steps ends at the same velocity, so a
 * dropped frame does not change how the motion feels.
 * A non-positive response snaps to the target.
 */
export function smoothEastNorth(
  current: EastNorthMeters,
  target: EastNorthMeters,
  dtSeconds: number,
  responseSeconds: number,
): EastNorthMeters {
  if (!(responseSeconds > 0)) {
    return { east: target.east, north: target.north };
  }
  const alpha = 1 - Math.exp(-Math.max(0, dtSeconds) / Math.max(responseSeconds, MIN_RESPONSE_SECONDS));
  return {
    east: current.east + (target.east - current.east) * alpha,
    north: current.north + (target.north - current.north) * alpha,
  };
}

/** Shortest-arc ease from one compass heading to another, in degrees. */
export function dampDegrees(
  currentDeg: number,
  targetDeg: number,
  dtSeconds: number,
  responseSeconds: number,
): number {
  if (!(responseSeconds > 0)) {
    return targetDeg;
  }
  const alpha = 1 - Math.exp(-Math.max(0, dtSeconds) / Math.max(responseSeconds, MIN_RESPONSE_SECONDS));
  return currentDeg + shortestDegreesDelta(currentDeg, targetDeg) * alpha;
}

function shortestDegreesDelta(currentDeg: number, targetDeg: number): number {
  let delta = (targetDeg - currentDeg) % 360;
  if (delta > 180) {
    delta -= 360;
  }
  if (delta < -180) {
    delta += 360;
  }
  return delta;
}

/**
 * Ignore deflections inside `deadzone` and rescale the rest so the rim is still full speed.
 * A stick that crosses the deadzone therefore starts at zero instead of popping.
 */
export function applyStickDeadzone(vector: JoystickVector, deadzone: number): JoystickVector {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!(deadzone < 1) || magnitude <= deadzone || magnitude === 0) {
    return { x: 0, y: 0 };
  }
  const scale = (magnitude - deadzone) / ((1 - deadzone) * magnitude);
  return {
    x: vector.x * scale,
    y: vector.y * scale,
  };
}

export function offsetLonLat(
  longitude: number,
  latitude: number,
  eastMeters: number,
  northMeters: number,
): { longitude: number; latitude: number } {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(degreesToRadians(latitude));
  const safeMetersPerDegLon = Math.abs(metersPerDegLon) < 1e-6 ? 1e-6 : metersPerDegLon;
  const nextLatitude = latitude + northMeters / METERS_PER_DEG_LAT;
  return {
    longitude: longitude + eastMeters / safeMetersPerDegLon,
    latitude: Math.max(-MAX_LAT, Math.min(MAX_LAT, nextLatitude)),
  };
}
