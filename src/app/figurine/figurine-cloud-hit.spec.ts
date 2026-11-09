import { cloudHitRadiusM, figurineCloudAtPoint, type CloudFootprint } from './figurine-cloud-hit';

const cloud: CloudFootprint = {
  id: 'jon-lord',
  originX: 100,
  originY: 200,
  radiusM: 30,
  heightM: 16,
  stable: true,
};

describe('figurineCloudAtPoint', () => {
  it('widens the hit radius with camera pitch', () => {
    expect(cloudHitRadiusM(10, 10, 0)).toBeCloseTo(10);
    expect(cloudHitRadiusM(10, 10, 45)).toBeCloseTo(20);
  });

  it('hits a stabilized cloud inside its footprint', () => {
    expect(figurineCloudAtPoint(120, 200, [cloud], 0)?.id).toBe('jon-lord');
  });

  it('ignores a cloud that is still waving', () => {
    expect(figurineCloudAtPoint(100, 200, [{ ...cloud, stable: false }], 0)).toBeNull();
  });

  it('ignores a point outside the footprint', () => {
    expect(figurineCloudAtPoint(100, 260, [cloud], 0)).toBeNull();
  });

  it('picks the closer cloud when footprints overlap', () => {
    const other: CloudFootprint = { ...cloud, id: 'paradjanov', originX: 140 };
    expect(figurineCloudAtPoint(130, 200, [cloud, other], 0)?.id).toBe('paradjanov');
  });
});
