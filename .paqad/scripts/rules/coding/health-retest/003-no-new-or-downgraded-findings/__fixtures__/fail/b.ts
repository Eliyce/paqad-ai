export function buildHealthRetestFindings(sourceFindings) {
  return deriveNewFindings(sourceFindings).map((finding) => ({
    id: finding.id,
    status: 'fixed',
  }));
}
