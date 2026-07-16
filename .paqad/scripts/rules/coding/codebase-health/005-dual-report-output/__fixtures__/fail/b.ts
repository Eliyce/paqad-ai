export async function runHealthAudit(result) {
  writeJsonFile(result.sidecar_path, result);
  return result;
}
// markdown and index missing
