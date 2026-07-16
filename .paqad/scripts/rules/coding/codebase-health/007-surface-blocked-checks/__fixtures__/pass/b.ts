function createHealthCommand(result) {
  const blocked_checks = result.blocked_checks;
  return blocked_checks.map((check) => check.install_hint);
}
// gaps stay visible
