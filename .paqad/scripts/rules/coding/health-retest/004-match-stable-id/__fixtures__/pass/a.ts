function buildHealthRetestFindings(sourceFindings, currentFindings) {
  const currentIds = new Set(currentFindings.map((finding) => finding.id));
  return sourceFindings.map((finding) =>
    currentIds.has(finding.id) ? 'still-open' : 'fixed');
}
