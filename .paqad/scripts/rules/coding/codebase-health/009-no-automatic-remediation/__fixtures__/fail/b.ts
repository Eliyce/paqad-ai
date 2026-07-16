type HealthFinding = { path: string };
export function apply(finding: HealthFinding) {
  rm(finding.path);
  return true;
}
