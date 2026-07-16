export function buildHealthRetestFindings(sourceFindings) {
  return sourceFindings.map((finding) => ({
    ...finding,
    retest_status: evaluate(finding),
  }));
}
