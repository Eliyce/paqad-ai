import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MANAGED_HEADER } from '@/onboarding/decision-pause-contract-writer.js';
import {
  buildNarrationContractBody,
  buildNarrationContractDocument,
} from '@/onboarding/narration-contract-writer.js';
import { PAQAD_TERM_TRANSLATIONS, PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';

describe('narration-contract-writer', () => {
  it('builds a body that starts with the narration-contract heading (no managed header)', () => {
    const body = buildNarrationContractBody();
    expect(body.startsWith('# paqad narration contract')).toBe(true);
    expect(body.startsWith(MANAGED_HEADER)).toBe(false);
  });

  it('tells the orchestrator to resolve the stage settings once and pass model and effort per stage', () => {
    const body = buildNarrationContractBody();
    const dispatch = body
      .split('\n')
      .find((line) => line.startsWith('2. Dispatch the stage agent'))!;
    expect(dispatch).toContain('`paqad-ai stage settings`');
    expect(dispatch).toContain(
      "it prints JSON giving each stage this project's `effort` and `model` and a `pass` string",
    );
    expect(dispatch).toContain(
      "pass that stage's `model` and `effort` on each stage Agent call when the value is not `inherit`",
    );
    expect(dispatch).toContain(
      'when a stage is set to `inherit` but its agent file carries a default effort, pass your OWN current effort level on that Agent call',
    );
    expect(body).toContain('a SubagentStart hook hands each stage agent a short stage brief');
    const router = readFileSync(join(process.cwd(), 'runtime/AGENT-ROUTER.md'), 'utf8');
    expect(router).toContain(dispatch);
  });

  it('documents the cadence, voice, and status-block format', () => {
    const body = buildNarrationContractBody();
    expect(body).toContain('## When paqad speaks (cadence)');
    expect(body).toContain('Handshake');
    expect(body).toContain('## Voice');
    expect(body).toContain('## Status-block format');
    expect(body).toContain('**▸ paqad**');
  });

  describe('who speaks, and on which channel', () => {
    it('AC-3: no longer promises that the hooks surface the narration for the agent', () => {
      expect(buildNarrationContractBody()).not.toContain(
        'the entry lines and the end-of-change receipt are surfaced for you',
      );
    });

    it('AC-3: puts the voice on the Claude Code and Codex agents themselves', () => {
      const body = buildNarrationContractBody();
      expect(body).toContain('On **Claude Code and Codex** YOU speak');
      expect(body).toContain('Never treat a hook as having spoken for you');
      expect(body).toContain('On **Gemini** the record hook is deliberately record-only');
    });

    it('AC-3: states per surface which channels actually render', () => {
      const body = buildNarrationContractBody();
      expect(body).toContain('Claude Code CLI');
      expect(body).toContain('Claude Code Desktop');
      expect(body).toContain('PreToolUse:<Tool> says:');
      expect(body).toContain('Your assistant text, final message of the turn');
    });

    it('states the placement rule mid-turn narration was silently missing', () => {
      const body = buildNarrationContractBody();
      expect(body).toContain('**final message of the turn**');
      expect(body).toContain('between tool calls');
    });
  });

  it('reuses the canonical verdict words', () => {
    const body = buildNarrationContractBody();
    expect(body).toContain(PAQAD_VERDICT.pass);
    expect(body).toContain(PAQAD_VERDICT.fail);
    expect(body).toContain(PAQAD_VERDICT.inconclusive);
  });

  it('lists every plain-English term translation from the canonical spec', () => {
    const body = buildNarrationContractBody();
    expect(body).toContain('## Plain-English translations');
    for (const { term, plain } of PAQAD_TERM_TRANSLATIONS) {
      expect(body).toContain(term);
      expect(body).toContain(plain);
    }
  });

  it('stays legible with the status glyphs stripped', () => {
    const stripped = buildNarrationContractBody().replace(/[🟢🔴🟡⚪]/gu, '');
    for (const word of ['good', 'failed', 'needs a look', 'skipped']) {
      expect(stripped).toContain(word);
    }
  });

  it('AC-46: tells the orchestrator to dispatch one expert subagent per seat in parallel, then the chief', () => {
    const body = buildNarrationContractBody();
    expect(body).toContain(
      'dispatch one `paqad-expert` subagent per seated role, all in parallel, in one message',
    );
    expect(body).toContain('Then dispatch one `paqad-chief-architect` subagent');
    expect(body.indexOf('paqad-expert')).toBeLessThan(
      body.indexOf('Then dispatch one `paqad-chief-architect`'),
    );
    expect(body).toContain('On a host with no subagents');
    const router = readFileSync(join(process.cwd(), 'runtime/AGENT-ROUTER.md'), 'utf8');
    expect(router).toContain('dispatch one `paqad-expert` subagent per seated role');
  });

  it('is a pure builder — repeated calls return identical content', () => {
    expect(buildNarrationContractBody()).toBe(buildNarrationContractBody());
    expect(buildNarrationContractDocument()).toBe(buildNarrationContractDocument());
  });

  it('wraps the body with the managed header in document form', () => {
    const doc = buildNarrationContractDocument();
    expect(doc.startsWith(MANAGED_HEADER)).toBe(true);
    expect(doc).toBe(`${MANAGED_HEADER}\n\n${buildNarrationContractBody()}`);
  });
});
