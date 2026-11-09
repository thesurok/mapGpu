import {
  applyStickDeadzone,
  dampDegrees,
  eastNorthBetween,
  joystickToEastNorth,
  offsetLonLat,
  smoothEastNorth,
} from './ground-movement';

describe('joystickToEastNorth', () => {
  it('maps stick-up to north when the camera faces north', () => {
    const { east, north } = joystickToEastNorth({ x: 0, y: -1 }, 0);
    expect(east).toBeCloseTo(0);
    expect(north).toBeCloseTo(1);
  });

  it('maps stick-right to east when the camera faces north', () => {
    const { east, north } = joystickToEastNorth({ x: 1, y: 0 }, 0);
    expect(east).toBeCloseTo(1);
    expect(north).toBeCloseTo(0);
  });

  it('maps stick-up to east when the camera bearing is 90 degrees', () => {
    const { east, north } = joystickToEastNorth({ x: 0, y: -1 }, 90);
    expect(east).toBeCloseTo(1);
    expect(north).toBeCloseTo(0);
  });

  it('keeps a half deflection at half length', () => {
    const { east, north } = joystickToEastNorth({ x: 0, y: 0.5 }, 0);
    expect(Math.hypot(east, north)).toBeCloseTo(0.5);
    expect(north).toBeCloseTo(-0.5);
  });
});

describe('eastNorthBetween', () => {
  it('measures a northward offset in ground metres', () => {
    const { east, north } = eastNorthBetween(22.3, 48.62, 22.3, 48.62 + 100 / ((Math.PI / 180) * 6378137));
    expect(east).toBeCloseTo(0, 4);
    expect(north).toBeCloseTo(100, 3);
  });

  it('measures an eastward offset with the local longitude scale', () => {
    const latitude = 48.62;
    const metersPerDegLon = ((Math.PI / 180) * 6378137) * Math.cos((latitude * Math.PI) / 180);
    const { east, north } = eastNorthBetween(22.3, latitude, 22.3 + 80 / metersPerDegLon, latitude);
    expect(east).toBeCloseTo(80, 3);
    expect(north).toBeCloseTo(0, 4);
  });
});

describe('offsetLonLat', () => {
  it('advances latitude by ground metres and leaves longitude unchanged', () => {
    const next = offsetLonLat(22.3, 48.62, 0, 111.319);
    expect(next.longitude).toBeCloseTo(22.3, 8);
    expect(next.latitude).toBeGreaterThan(48.62);
  });

  it('uses a shorter longitude degree away from the equator', () => {
    const eastMeters = 1000;
    const equator = offsetLonLat(0, 0, eastMeters, 0);
    const north = offsetLonLat(0, 60, eastMeters, 0);
    expect(north.longitude - 0).toBeGreaterThan(equator.longitude - 0);
  });
});

describe('smoothEastNorth', () => {
  it('moves partway toward the target instead of snapping', () => {
    const next = smoothEastNorth({ east: 0, north: 0 }, { east: 0, north: 40 }, 0.18, 0.18);
    expect(next.north).toBeGreaterThan(20);
    expect(next.north).toBeLessThan(30);
    expect(next.east).toBeCloseTo(0);
  });

  it('matches one step to several shorter steps of the same target', () => {
    const target = { east: 10, north: -4 };
    const once = smoothEastNorth({ east: 0, north: 0 }, target, 0.05, 0.2);
    let stepped = { east: 0, north: 0 };
    for (let i = 0; i < 5; i++) {
      stepped = smoothEastNorth(stepped, target, 0.01, 0.2);
    }
    expect(stepped.east).toBeCloseTo(once.east, 6);
    expect(stepped.north).toBeCloseTo(once.north, 6);
  });

  it('snaps when the response is zero', () => {
    const next = smoothEastNorth({ east: 1, north: 2 }, { east: 8, north: 9 }, 0.016, 0);
    expect(next).toEqual({ east: 8, north: 9 });
  });
});

describe('dampDegrees', () => {
  it('turns the short way across north', () => {
    const towardEastOfNorth = dampDegrees(350, 10, 0.1, 0.1);
    const towardWestOfNorth = dampDegrees(10, 350, 0.1, 0.1);
    expect(towardEastOfNorth).toBeGreaterThan(350);
    expect(towardEastOfNorth).toBeLessThan(370);
    expect(towardWestOfNorth).toBeLessThan(10);
    expect(towardWestOfNorth).toBeGreaterThan(-10);
  });
});

describe('applyStickDeadzone', () => {
  it('zeroes a deflection inside the deadzone', () => {
    expect(applyStickDeadzone({ x: 0.05, y: 0 }, 0.08)).toEqual({ x: 0, y: 0 });
  });

  it('keeps a full deflection at full length', () => {
    const next = applyStickDeadzone({ x: 0, y: -1 }, 0.08);
    expect(next.x).toBeCloseTo(0);
    expect(next.y).toBeCloseTo(-1);
  });

  it('starts at zero as the stick leaves the deadzone', () => {
    const next = applyStickDeadzone({ x: 0.08, y: 0 }, 0.08);
    expect(next).toEqual({ x: 0, y: 0 });
  });
});
