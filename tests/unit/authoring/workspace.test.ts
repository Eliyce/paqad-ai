import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AuthoringRefusal,
  allStageStates,
  readGateMeta,
  renderGateMarkdown,
  requireEarlierGates,
  setWaiting,
  SkillWorkspace,
  validateSkillName,
  WORKSPACE_ROOT,
} from '@/authoring/workspace.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-workspace-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

describe('skill names', () => {
  it('AC-59: refuses ../x and other unsafe names before any path is built', () => {
    for (const name of ['../x', 'a/b', 'Upper', '-lead', 'double--hyphen', '', 'a'.repeat(65)]) {
      expect(() => validateSkillName(name)).toThrow(AuthoringRefusal);
      expect(() => new SkillWorkspace(project(), name)).toThrow(AuthoringRefusal);
    }
    expect(validateSkillName('processing-invoices')).toBe('processing-invoices');
  });

  it('places the workspace under the git-ignored tmp folder', () => {
    const workspace = new SkillWorkspace(project(), 'processing-invoices');
    expect(workspace.rel).toBe(`${WORKSPACE_ROOT}/processing-invoices`);
    expect(WORKSPACE_ROOT).toBe('.paqad/tmp/authoring/skills');
  });
});

describe('gate artifacts', () => {
  it('round-trips the gate metadata of a markdown artifact', () => {
    const text = renderGateMarkdown({ gate: 'failed', reason: 'x' }, '# Body');
    expect(readGateMeta(text, 'markdown')).toEqual({ gate: 'failed', reason: 'x' });
    expect(readGateMeta('# no frontmatter', 'markdown')).toBeNull();
    expect(readGateMeta('{"gate":"passed"}', 'json')).toEqual({ gate: 'passed' });
    expect(readGateMeta('{bad', 'json')).toBeNull();
  });

  it('INV-3: redacts known project secrets before writing', () => {
    const root = project();
    writeFileSync(join(root, '.paqad', 'secrets.env'), 'OPENAI_API_KEY=sk-test-value-123\n');
    const workspace = new SkillWorkspace(root, 'processing-invoices');
    workspace.write('sources.md', 'key sk-test-value-123 here');
    expect(workspace.read('sources.md')).toBe('key [REDACTED] here');
  });
});

describe('stage order', () => {
  it('reports every stage not run on an empty workspace', () => {
    const states = allStageStates(new SkillWorkspace(project(), 'processing-invoices'));
    expect(states.map((state) => [state.stage.id, state.state])).toEqual([
      ['S0', 'not-run'],
      ['S1', 'not-run'],
      ['S2', 'not-run'],
      ['S3', 'not-run'],
      ['S4', 'not-run'],
      ['S5', 'not-run'],
      ['S6', 'not-run'],
      ['S7', 'not-run'],
    ]);
  });

  it('AC-1: refuses a later stage naming the missing artifact and the command', () => {
    const workspace = new SkillWorkspace(project(), 'processing-invoices');
    expect(() => requireEarlierGates(workspace, 'S2')).toThrow(
      "S2 evidence can't start: S0 justify has not passed (it has not run). The missing artifact is " +
        '.paqad/tmp/authoring/skills/processing-invoices/justification.md. Run paqad-ai skill justify ' +
        'processing-invoices first.',
    );
    expect(() => requireEarlierGates(workspace, 'S0')).not.toThrow();
  });

  it('FR-51: a waiting stage blocks the next one and names the decision', () => {
    const workspace = new SkillWorkspace(project(), 'processing-invoices');
    workspace.write('justification.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
    setWaiting(workspace, { stage: 'S1', decision: 'D-01M6Z000000000000000000000', resume: 'r' });
    expect(() => requireEarlierGates(workspace, 'S2')).toThrow(
      /S1 intake has not passed \(it is waiting on decision D-01M6Z000000000000000000000\)/,
    );
  });
});
