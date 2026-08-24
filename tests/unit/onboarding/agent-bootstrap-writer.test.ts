import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildAgentBootstrapDocument,
  buildAgentRouterDocument,
} from '@/onboarding/agent-bootstrap-writer.js';
import { buildDecisionPauseContractBody } from '@/onboarding/decision-pause-contract-writer.js';
import { buildNarrationContractBody } from '@/onboarding/narration-contract-writer.js';
import { DECISION_PAUSE_UI_NOTES } from '@/adapters/shared/decision-pause-ui-shim.js';

// The two committed install assets. They ship under runtime/ and are reached via the
// ~/.paqad-ai/current symlink — these golden tests keep them byte-identical to their
// builders. Regenerate with: pnpm vitest run agent-bootstrap-writer -u
const COMMITTED_BOOTSTRAP = resolve(process.cwd(), 'runtime/AGENT-BOOTSTRAP.md');
const COMMITTED_ROUTER = resolve(process.cwd(), 'runtime/AGENT-ROUTER.md');

describe('agent bootstrap gate document (#498)', () => {
  it('matches the committed runtime/AGENT-BOOTSTRAP.md (golden)', async () => {
    await expect(buildAgentBootstrapDocument()).toMatchFileSnapshot(COMMITTED_BOOTSTRAP);
  });

  it('encodes the exact enablement precedence + token set (no new read surface)', () => {
    const doc = buildAgentBootstrapDocument();
    // Hard override first, then the layered paqad_enable surfaces, default ON.
    expect(doc).toContain('PAQAD_DISABLED');
    expect(doc).toContain('PAQAD_ENABLE');
    expect(doc).toContain('`.paqad/.config`');
    expect(doc).toContain('`.paqad/configs/.config.app`');
    expect(doc).toContain('⇒ ON');
    // The falsy token set must match framework-config.ts FALSY = {0,false,no,off}.
    expect(doc).toContain('`false`, `0`, `no`, or `off`');
  });

  it('tells a disabled session to load nothing and behave as a normal assistant', () => {
    const doc = buildAgentBootstrapDocument();
    expect(doc).toMatch(/If paqad resolves to OFF:[\s\S]*Load no `docs\/instructions`/);
    expect(doc).toMatch(/no `docs\/modules`/);
    expect(doc).toMatch(/act as a normal assistant/);
  });

  it('resolves enablement FIRST, then points at the router (never before)', () => {
    const doc = buildAgentBootstrapDocument();
    const enablement = doc.indexOf('## 1. Enablement check');
    const routerPointer = doc.indexOf('## 2. When paqad is ON');
    expect(enablement).toBeGreaterThan(-1);
    expect(routerPointer).toBeGreaterThan(enablement);
    expect(doc).toContain('load `AGENT-ROUTER.md`');
  });

  it('is host-neutral: self-probe is the default, a host-told verdict is the exception (F7)', () => {
    const doc = buildAgentBootstrapDocument();
    // The conditional accelerator line, phrased so a host with no prompt-time hook
    // still has a self-sufficient default path.
    expect(doc).toMatch(/If a host gate has already told you the enablement verdict/i);
    expect(doc).toMatch(/Otherwise resolve `paqad_enable` yourself/i);
  });

  it('is JUST the gate — the router/narration/decision-pause prose has moved out (AC-4)', () => {
    const doc = buildAgentBootstrapDocument();
    // The workflow list, the narration contract, the stage protocol, and the
    // Decision Pause Contract all live in the router now, not the gate.
    expect(doc).not.toContain('## 2. Route first');
    expect(doc).not.toContain('feature-development');
    expect(doc).not.toContain('# paqad narration contract');
    expect(doc).not.toContain('Marking feature-development stages');
    expect(doc).not.toContain('# Decision Pause Contract');
  });

  it('carries no hardcoded workflow count (AC-3)', () => {
    expect(buildAgentBootstrapDocument()).not.toContain('9 workflows');
  });
});

describe('agent router document (#498)', () => {
  it('matches the committed runtime/AGENT-ROUTER.md (golden)', async () => {
    await expect(buildAgentRouterDocument()).toMatchFileSnapshot(COMMITTED_ROUTER);
  });

  it('states it is reached from the gate once enablement resolved ON', () => {
    const doc = buildAgentRouterDocument();
    expect(doc).toContain('# Paqad Framework Router');
    expect(doc).toMatch(/reach this file from the framework gate \(`AGENT-BOOTSTRAP\.md`\)/);
    expect(doc).toMatch(/enablement has resolved to \*\*ON\*\*/);
  });

  it('orders the steps: route → load → sentinel', () => {
    const doc = buildAgentRouterDocument();
    const route = doc.indexOf('## 1. Route first');
    const load = doc.indexOf('## 2. Load only what the routed workflow needs');
    const sentinel = doc.indexOf('## 3. Confirm the load');
    expect(route).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(route);
    expect(sentinel).toBeGreaterThan(load);
  });

  it('routes first: names the 11 workflows and the read-first / ask-if-torn rules (#336)', () => {
    const doc = buildAgentRouterDocument();
    const route = doc.slice(
      doc.indexOf('## 1. Route first'),
      doc.indexOf('## 2. Load only what the routed workflow needs'),
    );
    for (const workflow of [
      'feature-development',
      'project-question',
      'documentation-update',
      'module-documentation',
      'pentest',
      'design-test',
      'codebase-health',
      'rules-analyze',
      'root-cause-analysis',
      'site-map',
      'no workflow',
    ]) {
      expect(route).toContain(workflow);
    }
    expect(route).toContain('Any code change is feature-development');
    expect(route).toMatch(/read or fetch it first/i);
    expect(route).toContain('AskUserQuestion');
    // Per-message + pause/resume, never reset.
    expect(route).toContain('Switching pauses');
    expect(route).toContain('New work is not a resume');
  });

  it('always-loads stack/design-system/workflows but gates rules to feature-development (#336)', () => {
    // Regression guard: stack, design-system, and the feature-development +
    // delivery-policy workflows stay in the always-load contract. Rules move OUT
    // of the unconditional load — they load only on the feature-development route
    // (issue #336) — but the section must still name the artifact-first mechanism.
    const doc = buildAgentRouterDocument();
    const loadSection = doc.slice(
      doc.indexOf('## 2. Load only what the routed workflow needs'),
      doc.indexOf('### Workflow handling'),
    );
    expect(loadSection).toContain('`docs/instructions/stack`');
    expect(loadSection).toContain('`docs/instructions/design-system`');
    expect(loadSection).toContain('`docs/instructions/workflows`');
    // Rules are present but explicitly feature-development-only, not unconditional.
    expect(loadSection).toContain('Rules load only for `feature-development`');
    expect(loadSection).toContain('`docs/instructions/rules`');
    expect(loadSection).toContain('run **no** rule-scripts');
  });

  it('loads docs/site-map/ as documentation on the site-map route (ART-10)', () => {
    // The living-doc contract: the site-map workflow builds on the stored map, and
    // the framework treats it as documentation a project question can read. Honest
    // when absent so a flag-off or map-less project loads nothing (INV-1).
    const doc = buildAgentRouterDocument();
    const loadSection = doc.slice(
      doc.indexOf('## 2. Load only what the routed workflow needs'),
      doc.indexOf('### Workflow handling'),
    );
    expect(loadSection).toContain('`docs/site-map/`');
    expect(loadSection).toMatch(/routed to \*\*site-map\*\*/);
    expect(loadSection).toContain('build on it');
    expect(loadSection).toMatch(/only when it is present/i);
  });

  it('preserves the workflow-handling trigger (create documentation / feature workflows)', () => {
    // Relocated verbatim from the entry-file templates (issue #229). Without this,
    // an enabled agent would stop treating `create documentation` as a Paqad
    // workflow and would ask for a document type instead.
    const doc = buildAgentRouterDocument();
    expect(doc).toContain('### Workflow handling');
    expect(doc).toContain('`create documentation`');
    expect(doc).toContain(
      'Do not ask the user to choose a document type when a Paqad workflow already matches the request.',
    );
  });

  it('confirms the load with the unchanged sentinel payload + invalidation triggers', () => {
    const doc = buildAgentRouterDocument();
    expect(doc).toContain('## 3. Confirm the load (sentinel)');
    expect(doc).toContain('.paqad/.agent-entry-loaded');
    expect(doc).toContain('"loaded_at"');
    expect(doc).toContain('"entry_file"');
    expect(doc).toContain('"framework_version"');
    expect(doc).toMatch(/invalidated automatically if the entry file/);
  });

  it('carries the FULL narration contract inline', () => {
    const doc = buildAgentRouterDocument();
    expect(doc).toContain(buildNarrationContractBody());
    expect(doc).toContain('# paqad narration contract');
    expect(doc).toContain('## Plain-English translations');
  });

  it('carries the FULL decision-pause contract inline, incl. the per-adapter table', () => {
    const doc = buildAgentRouterDocument();
    expect(doc).toContain(buildDecisionPauseContractBody());
    expect(doc).toContain('# Decision Pause Contract');
    expect(doc).toContain('## Per-adapter UI');
  });

  it('keeps the Claude tray instruction (AskUserQuestion row) reachable', () => {
    const doc = buildAgentRouterDocument();
    // This row is what tells Claude Code to surface a pause via the tray.
    expect(doc).toContain(DECISION_PAUSE_UI_NOTES['claude-code']);
    expect(DECISION_PAUSE_UI_NOTES['claude-code']).toContain('AskUserQuestion');
    expect(doc).toContain('Adapter:');
  });
});
