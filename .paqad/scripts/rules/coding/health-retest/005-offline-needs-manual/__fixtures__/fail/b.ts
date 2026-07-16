export function evaluateRetestStatus(finding, offline) {
  const blocked = finding.requires_network && offline;
  if (blocked) return 'fixed';
  return 'still-open';
}
