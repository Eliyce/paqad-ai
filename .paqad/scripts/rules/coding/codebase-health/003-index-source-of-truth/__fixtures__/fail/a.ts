export function runHealthAudit(files) {
  const findings = scanFiles(files);
  return findings;
}
// index bypassed
