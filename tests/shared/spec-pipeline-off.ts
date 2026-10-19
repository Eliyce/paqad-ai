// Issue #640 turned the spec pipeline, the experts and strict adoption on by default. Tests
// written to prove the switched-off path (byte-identical feature-development, FR-11) must now
// switch those keys off explicitly, so they keep proving that path instead of silently running
// the pipeline. These helpers pin the three keys off in a temp project.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The three spec-pipeline switches, set off: the pre-#640 behaviour, made explicit. */
export const SPEC_PIPELINE_OFF_LINES: readonly string[] = [
  'spec_pipeline_enabled=false',
  'spec_pipeline_experts_enabled=false',
  'spec_pipeline_adoption=warn',
];

/**
 * Return `lines` plus an explicit off line for every spec-pipeline switch `lines` does not set
 * already, so a case's own value always wins and every unset switch reads off.
 */
export function withSpecPipelineOff(lines: readonly string[]): string[] {
  const keyOf = (line: string): string => line.split('=')[0]!.trim();
  const set = new Set(lines.map(keyOf));
  return [...SPEC_PIPELINE_OFF_LINES.filter((line) => !set.has(keyOf(line))), ...lines];
}

/**
 * Pin the three switches off in the temp project's team layer (`.paqad/configs/.config.policy`).
 * A test that later writes `.paqad/.config` still wins key by key (LOCAL-WINS), so a test that
 * sets only `spec_pipeline_enabled=true` keeps the experts off and adoption at warn, as before.
 */
export function pinSpecPipelineOff(root: string): void {
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(
    join(root, '.paqad', 'configs', '.config.policy'),
    `${SPEC_PIPELINE_OFF_LINES.join('\n')}\n`,
    'utf8',
  );
}
