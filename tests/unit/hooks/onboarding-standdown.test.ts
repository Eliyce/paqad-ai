import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { journeyOwnerWritingDocs } from '../../../runtime/hooks/lib/agent-entry-sentinel.mjs';
import {
  hookStandsDown,
  hookStandsDownOutsideJourney,
} from '../../../runtime/hooks/lib/paqad-disabled.mjs';

import { tempRoot } from '../onboarding/journey/fixtures/journey.js';

describe('hooks while an onboarding journey runs before setup', () => {
  let root: string;
  const env = (): NodeJS.ProcessEnv => ({
    CLAUDE_PLUGIN_ROOT: '/plugin',
    CLAUDE_PROJECT_DIR: root,
  });

  beforeEach(() => {
    root = tempRoot('paqad-standdown-');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function journey(run: Record<string, unknown>): void {
    mkdirSync(join(root, '.paqad/onboarding'), { recursive: true });
    writeFileSync(join(root, '.paqad/onboarding/journey.json'), JSON.stringify(run));
  }

  it('only the journey-aware check passes the unonboarded stand-down when journey.json exists', () => {
    const payload = { cwd: root };
    expect(hookStandsDownOutsideJourney(payload, env())).toBe(true);
    journey({ status: 'running' });
    expect(hookStandsDownOutsideJourney(payload, env())).toBe(false);
    expect(hookStandsDown(payload, env())).toBe(true);
  });

  it('the sentinel skips docs staleness for the owner while docs or research run', () => {
    journey({
      owner_session: 'owner',
      status: 'running',
      stages: { project_docs: { status: 'running' } },
    });
    expect(journeyOwnerWritingDocs(root, 'owner')).toBe(true);
    expect(journeyOwnerWritingDocs(root, 'other')).toBe(false);
    journey({
      owner_session: 'owner',
      status: 'running',
      stages: { module_docs: { status: 'running' } },
    });
    expect(journeyOwnerWritingDocs(root, 'owner')).toBe(false);
  });
});
