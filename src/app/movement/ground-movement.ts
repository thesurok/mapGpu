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
