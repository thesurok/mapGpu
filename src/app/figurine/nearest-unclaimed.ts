import { eastNorthBetween } from '../movement/ground-movement';
import type { FigurineSite } from './figurine-collection';

/** Closest figurine the player has not stabilized yet. */
export interface UnclaimedFigurine {
  id: string;
  /** Ground distance from the player, in metres. */
  distanceM: number;
  /** Clockwise degrees from north, the same convention as the player heading. */
  bearingDeg: number;
}

export function nearestUnclaimedFigurine(
  longitude: number,
  latitude: number,
  sites: readonly FigurineSite[],
  collected: ReadonlySet<string>,
): UnclaimedFigurine | null {
  let best: UnclaimedFigurine | null = null;
  for (const site of sites) {
    if (collected.has(site.id)) {
      continue;
    }
    const offset = eastNorthBetween(longitude, latitude, site.longitude, site.latitude);
    const distanceM = Math.hypot(offset.east, offset.north);
    if (best && distanceM >= best.distanceM) {
      continue;
    }
    best = {
      id: site.id,
      distanceM,
      bearingDeg: (Math.atan2(offset.east, offset.north) * 180) / Math.PI,
    };
  }
  return best;
}
