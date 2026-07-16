export function runHealthAudit(path) {
  const finding = inspect(path);
  if (finding) unlink(path);
  return finding;
}
