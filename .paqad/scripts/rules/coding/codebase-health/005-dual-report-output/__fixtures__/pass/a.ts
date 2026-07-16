async function runHealthAudit(report) {
  await writeJsonFile(report.sidecar_path, report);
  await writeMarkdown(report.report_path, render(report));
  await writeJsonFile('finding-index.json', report.findings);
}
