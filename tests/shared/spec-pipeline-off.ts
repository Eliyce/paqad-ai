import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SPEC_PIPELINE_OFF_LINES: readonly string[] = [
  'spec_pipeline_enabled=false',
  'spec_pipeline_experts_enabled=false',
  'spec_pipeline_adoption=warn',
];

export function withSpecPipelineOff(lines: readonly string[]): string[] {
  const keyOf = (line: string): string => line.split('=')[0]!.trim();
  const set = new Set(lines.map(keyOf));
  return [...SPEC_PIPELINE_OFF_LINES.filter((line) => !set.has(keyOf(line))), ...lines];
}

export function pinSpecPipelineOff(root: string): void {
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(
    join(root, '.paqad', 'configs', '.config.policy'),
    `${SPEC_PIPELINE_OFF_LINES.join('\n')}\n`,
    'utf8',
  );
}
