// Complementary analytics-instrumentation agent (issue #241): provider catalog, call-site
// extraction, read-only detection, the classify-time gate, and the conflict→Decision-Pause
// map. The ledger that records what it writes lives in `src/analytics-tag/`.
export * from './providers.js';
export * from './call-sites.js';
export * from './detect.js';
export * from './gate.js';
export * from './conflicts.js';
