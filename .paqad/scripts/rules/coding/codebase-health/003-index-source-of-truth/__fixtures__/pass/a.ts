export function runHealthAudit(gatherer) {
  const index = gatherer.loadIndex();
  if (!index) return 'index-not-built';
  return index.files;
}
