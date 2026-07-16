function runHealthAudit(projectRoot) {
  const files = walk(projectRoot);
  return inspect(files);
}
// no blocked index path
