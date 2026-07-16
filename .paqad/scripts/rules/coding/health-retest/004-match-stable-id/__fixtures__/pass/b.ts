export function buildHealthRetestFindings(sourceFindings, currentFindings) {
  const currentIds = new Set(currentFindings.map((finding) => finding.id));
  return sourceFindings.map((finding) => ({
    ...finding, open: currentIds.has(finding.id),
  }));
}
