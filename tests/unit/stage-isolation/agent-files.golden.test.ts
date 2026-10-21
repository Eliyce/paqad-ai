import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { writeStageAgents } from '@/stage-isolation/agent-writer';

const home = mkdtempSync(join(tmpdir(), 'paqad-agent-golden-'));
writeStageAgents({ homeDir: home });
afterAll(() => rmSync(home, { recursive: true, force: true }));

function filesIn(subdir: string): string[] {
  return readdirSync(join(home, subdir)).sort();
}

describe('rendered agent files', () => {
  it.each(filesIn('.codex/agents'))('codex-cli %s', (name) => {
    expect(readFileSync(join(home, '.codex/agents', name), 'utf8')).toMatchSnapshot();
  });

  it.each(['paqad-expert.md', 'paqad-chief-architect.md'])('claude-code High Table %s', (name) => {
    expect(readFileSync(join(home, '.claude/agents', name), 'utf8')).toMatchSnapshot();
  });
});
