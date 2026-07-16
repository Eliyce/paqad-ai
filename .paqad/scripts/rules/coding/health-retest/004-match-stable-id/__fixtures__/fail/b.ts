export function buildHealthRetestFindings(sourceFindings, currentFindings) {
  return sourceFindings.map((finding) => ({
    ...finding,
    open: currentFindings.some((item) => item.title === finding.title),
  }));
}
