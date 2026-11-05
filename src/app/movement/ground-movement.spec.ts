import { joystickToEastNorth, offsetLonLat } from './ground-movement';

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
