function evaluateRetestStatus(finding, offline) {
  if (finding.requires_network && offline) {
    return 'needs-manual-verification';
  }
  return 'fixed';
}
