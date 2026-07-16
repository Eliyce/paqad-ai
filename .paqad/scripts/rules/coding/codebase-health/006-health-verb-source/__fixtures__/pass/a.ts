export function createHealthCommand() {
  return command.action(async () => {
    const result = await runHealthAudit(options);
    return result;
  });
}
