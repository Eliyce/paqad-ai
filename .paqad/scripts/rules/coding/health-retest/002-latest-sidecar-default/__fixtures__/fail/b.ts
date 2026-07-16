export function findLatestSidecar(entries) {
  const report = entries.find((entry) => entry.endsWith('.json'));
  return report ?? null;
}
// no ordering
