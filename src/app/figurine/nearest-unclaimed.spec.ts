import { nearestUnclaimedFigurine } from './nearest-unclaimed';
import type { FigurineSite } from './figurine-collection';

const sites: FigurineSite[] = [
  { id: 'near', longitude: 22.301, latitude: 48.622 },
  { id: 'far', longitude: 22.32, latitude: 48.622 },
];

describe('nearestUnclaimedFigurine', () => {
  it('picks the closest figurine that is still unclaimed', () => {
    const target = nearestUnclaimedFigurine(22.298, 48.622, sites, new Set());
    expect(target?.id).toBe('near');
    expect(target?.distanceM).toBeGreaterThan(0);
    expect(target?.bearingDeg).toBeGreaterThan(0);
  });

  it('skips a collected figurine and aims at the next one', () => {
    const target = nearestUnclaimedFigurine(22.298, 48.622, sites, new Set(['near']));
    expect(target?.id).toBe('far');
  });

  it('returns nothing once every figurine is claimed', () => {
    const target = nearestUnclaimedFigurine(22.298, 48.622, sites, new Set(['near', 'far']));
    expect(target).toBeNull();
  });
});
