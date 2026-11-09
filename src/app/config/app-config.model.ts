/** `joystick` walks a player from a stick. `regular` keeps map pan, zoom, and pitch. */
export type MapControlMode = 'regular' | 'joystick';

/** Follow camera and stick tuning used when `controls.mode` is `'joystick'`. */
export interface JoystickControlSettings {
  /**
   * Locked zoom. Higher is closer to the ground.
   * MapGPU keeps the 3D camera at least ~500 m above the surface, so in a
   * typical window the closest legal zoom is about 17–18. A higher value
   * stays at that limit instead of moving the camera inside the globe.
   */
  followZoom: number;
  /** Locked pitch in degrees. 0 looks straight down. */
  followPitch: number;
  /** Locked bearing in degrees, clockwise from north. 0 keeps north at the top. */
  followBearing: number;
  /** Ground speed in metres per second at full nipple deflection. */
  moveSpeedMps: number;
  /**
   * How quickly ground speed eases toward the stick, in seconds.
   * This is an exponential time constant: about two thirds of a speed
   * change lands in this long, and the rest follows. Releasing the stick
   * brakes in about half this time. `0` snaps.
   */
  moveResponseSeconds: number;
  /** Joystick base radius in CSS pixels. */
  radiusPx: number;
  /** Player start position as [longitude, latitude]. */
  playerStart: [number, number];
}

/** Shape shared by development and production app config files. */
export interface AppConfigSettings {
  debug: {
    /** When true, clicking the globe logs lon/lat to the console. */
    logClickCoordinates: boolean;
    /**
     * When true, show a corner FPS overlay.
     * Uses an independent rAF sampler (works on a static/idle MapView) plus
     * MapView draw FPS when the render loop is actually dirty.
     */
    showFps: boolean;
  };
  controls: {
    mode: MapControlMode;
    joystick: JoystickControlSettings;
  };
}
