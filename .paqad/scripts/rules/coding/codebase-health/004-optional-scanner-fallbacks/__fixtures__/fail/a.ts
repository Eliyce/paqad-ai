export function createHealthGatherer() {
  const scanner = runBundledScanner();
  return { scanner };
}
// no optional fallbacks
