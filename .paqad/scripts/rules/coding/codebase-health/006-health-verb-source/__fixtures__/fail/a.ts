export function createHealthCommand() {
  return command.action(() => {
    return inspectRepository();
  });
}
