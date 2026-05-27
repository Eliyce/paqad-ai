export {
  DEFAULT_FRESH_WINDOW_DAYS,
  DEFAULT_STALE_CLIFF_DAYS,
  ageInDays,
  scoreFreshness,
  scoreFreshnessAverage,
  type FreshnessOptions,
} from './freshness.js';

export { scorePresence, type PresenceCounts, type PresenceOptions } from './presence.js';

export { SCORE_BAND_THRESHOLDS, bandForScore } from './band.js';
