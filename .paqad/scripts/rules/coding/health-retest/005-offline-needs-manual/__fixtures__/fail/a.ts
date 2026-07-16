function evaluateRetestStatus(finding, offline) {
  if (finding.requires_network && offline) {
    return 'fixed';
  }
  return 'still-open';
}
