export function runHealthAudit(index) {
  const findings = inspect(index);
  return findings.map((finding) => finding.suggestion);
}
// suggestions only
