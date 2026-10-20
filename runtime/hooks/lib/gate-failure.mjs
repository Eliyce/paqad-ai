export function gateFailureMessage(gateName, error) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    `paqad could not run its ${gateName} check (${detail}). ` +
    'Run "paqad-ai doctor" to repair the install, or set PAQAD_DISABLED=1 to turn paqad off.'
  );
}
