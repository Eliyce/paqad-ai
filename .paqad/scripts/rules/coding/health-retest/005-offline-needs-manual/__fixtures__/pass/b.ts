export function evaluateRetestStatus(finding, offline) {
  const blocked = finding.requires_network && offline;
  if (blocked) return 'needs-manual-verification';
  return 'still-open';
}
