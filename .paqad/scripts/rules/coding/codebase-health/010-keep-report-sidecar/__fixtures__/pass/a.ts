async function runHealthAudit(report) {
  writeMarkdown(report.report_path, render(report));
  writeJsonFile(report.sidecar_path, report);
  return report;
}
