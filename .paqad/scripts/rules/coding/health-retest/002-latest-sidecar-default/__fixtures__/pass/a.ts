function findLatestSidecar(files) {
  const candidates = files.filter((name) => name.endsWith('.json')).sort();
  const latest = candidates.at(-1);
  return latest;
}
