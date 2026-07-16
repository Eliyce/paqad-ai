async function runHealthAudit(report) {
  await writeMarkdown(report.report_path, render(report));
  return report;
}
// sidecar and index missing
