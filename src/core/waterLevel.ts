/**
 * Chapter 2 Season 3 — Water Level Stage System
 *
 * Stages 0–7 map to the 8 discrete water heights used during Ch2S3.
 * Set exactly ONE WaterLevel_N=true in .env to activate that stage.
 * The active stage is broadcast as a WL0–WL7 event flag via the
 * /fortnite/api/calendar/v1/timeline endpoint.
 *
 * Stage 0 = fully flooded (season start)
 * Stage 7 = fully receded (season end)
 */

import { config } from '../config';

export function getActiveWaterStage(): number {
  for (let i = 0; i <= 7; i++) {
    if (config.waterLevel.stages[i] === true) return i;
  }
  return -1; // none enabled
}
