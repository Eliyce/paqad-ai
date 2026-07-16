async function runHealthAudit(report) {
  writeMarkdown(report.report_path, render(report));
  return report;
}
// sidecar missing
