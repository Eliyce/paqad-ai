import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RequestClassifier } from '@/pipeline/classifier.js';

describe('classifier analytics gate (issue #241)', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-atc-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const classify = () =>
    new RequestClassifier({ projectRoot }).classify({
      request: 'add a checkout feature',
      resolved_workflow: {
        workflow: 'feature-development',
        workflow_source: 'routing-skill',
        workflow_reason: 'x',
        matched_rule: 'x',
      },
    });

  it('leaves analytics_tag unset when the flag is off (default) — no field, no scan', async () => {
    const result = await classify();
    expect(result.analytics_tag).toBeUndefined();
  });

  it('sets analytics_tag when the flag is on (dormant with no provider wired)', async () => {
    writeFileSync(
      join(projectRoot, '.paqad', '.config'),
      'analytics_instrumentation=true\n',
      'utf8',
    );
    const result = await classify();
    expect(result.analytics_tag).toBe('dormant');
  });
});
