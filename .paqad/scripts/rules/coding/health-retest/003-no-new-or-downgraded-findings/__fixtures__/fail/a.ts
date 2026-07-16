function buildHealthRetestFindings(currentFindings) {
  return currentFindings.map((finding) => ({
    id: finding.id,
    severity: 'low',
  }));
}
