import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { STAGE_AGENT_AUDIT_SOURCES } from '@/stage-isolation/agent-audit.js';
import { lintAllAgents } from '@/authoring/lint/audit.js';
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
  it('AC-58: claims no hold in any rendered plugin agent', () => {
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

  it('AC-59: agent lint --all finds no AG-021 on a Claude Code or Codex render, and every Do not line names its enforcer', () => {
    const report = lintAllAgents(process.cwd(), { agentSources: STAGE_AGENT_AUDIT_SOURCES });
    const rendered = report.items.filter(
      (item) =>
        item.path.startsWith('runtime/claude-plugin/agents/') ||
        item.path.startsWith('runtime/templates/stage-agents/'),
    );
    expect(rendered.some((item) => item.path.includes('codex.toml.hbs#paqad-review'))).toBe(true);
    expect(rendered.some((item) => item.path.endsWith('agents/paqad-review.md'))).toBe(true);
    for (const item of rendered) {
      expect(
        item.findings.filter((finding) => finding.rule === 'AG-021').map((f) => f.line),
        item.path,
      ).toEqual([]);
    }
    for (const host of ['claude-code', 'codex-cli']) {
      for (const { content } of renderStageAgentFiles(host)) {
        for (const line of doNotLines(content)) {
          expect(line).toMatch(ENFORCER);
        }
      }
    }
  });

  it('keeps the rendered files in step with the plugin copies', () => {
    for (const { name, content } of renderStageAgentFiles('claude-code')) {
      expect(readFileSync(join(PLUGIN_AGENTS, name), 'utf8')).toBe(content);
    }
  });
});
