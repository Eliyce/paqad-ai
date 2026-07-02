// Complementary analytics-instrumentation agent (issue #241, refined by #279): provider
// catalog, call-site extraction, read-only detection, the classify-time gate, and the
// conflict→Decision-Pause map. Analytics v2 (#279) makes the per-event docs tree the single
// source of truth for what is tracked; the #241 tracking-tag ledger was removed.
export * from './providers.js';
export * from './call-sites.js';
export * from './detect.js';
export * from './gate.js';
export * from './conflicts.js';
