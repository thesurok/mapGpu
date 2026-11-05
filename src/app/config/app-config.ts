import type { AppConfigSettings } from './app-config.model';

/**
 * Application settings for the playground.
 * Production builds replace this file with `app-config.prod.ts`
 * (see `fileReplacements` in angular.json) so every debug flag is false.
 */
export const appConfigSettings: AppConfigSettings = {
  debug: {
    logClickCoordinates: false,
    showFps: true,
  },
  controls: {
    mode: 'joystick',
    joystick: {
      followZoom: 17.5,
      followPitch: 35,
      followBearing: 0,
      moveSpeedMps: 40,
      radiusPx: 72,
      playerStart: [22.298340533604744, 48.62222379006886],
    },
  },
};

export type { AppConfigSettings };
