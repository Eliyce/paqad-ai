export async function runHealthAudit(result) {
  writeMarkdown(result.report_path, 'report');
  writeJsonFile(result.sidecar_path, result);
  writeJsonFile('finding-index.json', result.findings);
}
