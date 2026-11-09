/** Ground footprint of one figurine point cloud, in EPSG:3857 metres. */
export interface CloudFootprint {
  id: string;
  originX: number;
  originY: number;
  /** Horizontal distance from the anchor to the farthest point. */
  radiusM: number;
  /** Vertical extent of the cloud. Pitch shifts this up-screen, so it widens the hit. */
  heightM: number;
  stable: boolean;
}

/**
 * Ground radius that still covers the pitched silhouette.
 * Altitude projects away from the camera by about height × tan(pitch).
 */
export function cloudHitRadiusM(radiusM: number, heightM: number, pitchDeg: number): number {
  const pitchRad = (Math.min(89, Math.max(0, pitchDeg)) * Math.PI) / 180;
  return radiusM + heightM * Math.tan(pitchRad);
}

/** Closest stabilized cloud whose footprint contains the ground point. */
export function figurineCloudAtPoint(
  mercatorX: number,
  mercatorY: number,
  clouds: readonly CloudFootprint[],
  pitchDeg: number,
): CloudFootprint | null {
  let best: CloudFootprint | null = null;
  let bestDistance = Infinity;
  for (const cloud of clouds) {
    if (!cloud.stable) {
      continue;
    }
    const distance = Math.hypot(mercatorX - cloud.originX, mercatorY - cloud.originY);
    if (distance > cloudHitRadiusM(cloud.radiusM, cloud.heightM, pitchDeg) || distance >= bestDistance) {
      continue;
    }
    best = cloud;
    bestDistance = distance;
  }
  return best;
}
