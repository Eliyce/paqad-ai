export interface StageResult {
  ok: boolean;
  lines: string[];
  artifacts: string[];
  decision?: string;
  stopped?: boolean;
}

export function stageExitCode(result: StageResult): 0 | 1 {
  return result.ok || result.decision !== undefined || result.stopped === true ? 0 : 1;
}

export function stageResult(ok: boolean, lines: string[], artifacts: string[] = []): StageResult {
  return { ok, lines, artifacts };
}
