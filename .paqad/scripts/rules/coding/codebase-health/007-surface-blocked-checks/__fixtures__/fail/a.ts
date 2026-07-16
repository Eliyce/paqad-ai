export function createHealthCommand(result) {
  console.log(result.finding_count);
  return result.exit_code;
}
// blocked checks hidden
