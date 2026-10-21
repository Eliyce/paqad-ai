import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

const STAGES = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
];

describe('stage brief and stage settings docs', () => {
  const claudeDoc = read('docs/modules/adapter-onboarding/features/claude-code/technical.md');

  it('the claude-code technical doc names the hook, the keys, the verb and the versions', () => {
    expect(claudeDoc).toContain('SubagentStart');
    expect(claudeDoc).toContain('stage-agent-start.mjs');
    expect(claudeDoc).toContain('`stage_effort_<stage>`');
    expect(claudeDoc).toContain('`stage_model_<stage>`');
    expect(claudeDoc).toContain('`paqad-ai stage settings`');
    expect(claudeDoc).toContain('a `pass` string that says in plain words what to pass');
    expect(claudeDoc).toContain('2.1.271');
    expect(claudeDoc).toContain('2.1.292');
  });

  it('the generated config example lists all twelve keys', () => {
    const example = read('.paqad/.config.example');
    for (const stage of STAGES) {
      expect(example).toContain(`# stage_effort_${stage}=`);
      expect(example).toContain(`# stage_model_${stage}=`);
    }
  });

  it('the module docs describe the seed hook and the recorded effort and model', () => {
    expect(read('docs/modules/adapter-onboarding/index/summary.md')).toContain(
      '`stage-agent-start.mjs` (SubagentStart)',
    );
    expect(read('docs/modules/onboarded-project-overview.md')).toContain('`SubagentStart` hook');
    expect(read('docs/modules/feature-evidence/index/summary.md')).toContain(
      "carries that stage's `requested_effort` and `requested_model`",
    );
  });

  it('the new docs text uses no em dash', () => {
    const added = claudeDoc.slice(claudeDoc.indexOf('- **Stage helper effort and model.**'));
    expect(added.slice(0, added.indexOf('## Testing Entry Points'))).not.toContain('—');
  });
});
