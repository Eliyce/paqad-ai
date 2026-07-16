function createHealthCommand() {
  const run = () => runHealthAudit({ projectRoot: '.' });
  return { run };
}
// canonical verb
