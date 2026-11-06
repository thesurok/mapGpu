/**
 * Shared figurine point-cloud animation constants (WGSL vertex path and optional compute).
 */

/** Slow yaw around the figurine up-axis (radians / second). */
export const YAW_RAD_PER_SEC = 0.525;
/** Inside this ground distance (m) wave amplitude is nearly zero. */
export const WAVE_CALM_RADIUS_M = 28;
/** Outside this ground distance (m) wave amplitude is full. */
export const WAVE_FULL_RADIUS_M = 140;
/** Floor so the cloud never looks completely dead (still a tiny shimmer). */
export const WAVE_MIN_AMPLITUDE_SCALE = 0.03;
/** Screen-space point size when the wave is fully active (player far). */
export const POINT_SIZE_FAR_PX = 1.0;
/** Screen-space point size when the cloud is calm (player near). */
export const POINT_SIZE_NEAR_PX = 4.5;
