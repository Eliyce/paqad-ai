function buildHealthRetestFindings(sourceFindings, currentFindings) {
  const categories = new Set(currentFindings.map((finding) => finding.category));
  return sourceFindings.map((finding) =>
    categories.has(finding.category) ? 'still-open' : 'fixed');
}
