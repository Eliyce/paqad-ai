export function findLatestSidecar(entries) {
  const reports = entries.filter((entry) => !entry.includes('retest')).sort();
  const newest = reports.at(-1);
  return newest ?? null;
}
