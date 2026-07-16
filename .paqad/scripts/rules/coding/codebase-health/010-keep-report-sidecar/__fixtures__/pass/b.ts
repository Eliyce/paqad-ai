export async function runHealthAudit(result) {
  await writeJsonFile(result.sidecar_path, result);
  await writeMarkdown(result.report_path, 'report');
  return result;
}
