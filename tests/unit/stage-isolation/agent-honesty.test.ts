import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { renderStageAgentFiles } from '@/stage-isolation/agent-writer.js';
import { MANDATORY_STAGE_AGENTS, buildStageAgentBody } from '@/stage-isolation/stage-agents.js';

const PLUGIN_AGENTS = join(process.cwd(), 'runtime/claude-plugin/agents');
const ENFORCER = /AskUserQuestion|capability gate|stage-agent-[a-z-]+\.mjs|`paqad-ai [^`]+`/u;

function doNotLines(body: string): string[] {
  const start = body.indexOf('## Do not');
  const end = body.indexOf('## Example');
  return body.slice(start, end).split('\n- ').slice(1);
}

function words(text: string): number {
  return text.trim().split(/\s+/u).length;
}

describe('honest agent files', () => {
  it('claims no hold in any rendered plugin agent', () => {
    for (const name of readdirSync(PLUGIN_AGENTS)) {
      expect(readFileSync(join(PLUGIN_AGENTS, name), 'utf8')).not.toContain('holds a stage');
    }
  });

  it.each(['claude-code', 'codex-cli'])('names an enforcer on every Do not line for %s', (host) => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      for (const line of doNotLines(buildStageAgentBody(def, host))) {
        expect(line).toMatch(ENFORCER);
      }
    }
  });

  it.each(['claude-code', 'codex-cli'])('keeps every %s stage body under 300 words', (host) => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      expect(words(buildStageAgentBody(def, host)), def.agentName).toBeLessThan(300);
    }
  });

  it('passes the agent lint: no warning on a Do not line, and Bash held by the guard', async () => {
    for (const name of readdirSync(PLUGIN_AGENTS)) {
      const run = await execa(
        'node',
        ['dist/cli/index.js', 'agent', 'lint', join('runtime/claude-plugin/agents', name)],
        { reject: false },
      );
      expect(run.stdout).not.toContain('AG-021');
      if (/planning|specification|review|checks/u.test(name)) {
        expect(run.stdout).not.toContain('AG-022');
      }
    }
  }, 60_000);

  it('keeps the rendered files in step with the plugin copies', () => {
    for (const { name, content } of renderStageAgentFiles('claude-code')) {
      expect(readFileSync(join(PLUGIN_AGENTS, name), 'utf8')).toBe(content);
    }
  });
});
