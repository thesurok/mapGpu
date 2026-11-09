import type { AppConfigSettings } from './app-config.model';

/** Production settings — all debug options forced off. */
export const appConfigSettings: AppConfigSettings = {
  debug: {
    logClickCoordinates: false,
    showFps: false,
  },
  controls: {
    mode: 'joystick',
    joystick: {
      followZoom: 17.5,
      followPitch: 35,
      followBearing: 0,
      moveSpeedMps: 40,
      moveResponseSeconds: 0.18,
      radiusPx: 72,
      playerStart: [22.298340533604744, 48.62222379006886],
    },
  },
};
