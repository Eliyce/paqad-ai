export function createHealthCommand(result) {
  for (const blocked of result.blocked_checks) {
    console.log(blocked.install_hint);
  }
}
