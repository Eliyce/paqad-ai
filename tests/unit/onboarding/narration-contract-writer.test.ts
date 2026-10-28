import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MANAGED_HEADER } from '@/onboarding/decision-pause-contract-writer.js';
import {
  buildNarrationContractBody,
  buildNarrationContractDocument,
  RESUME_HANDOVER_TOKENS,
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

  it('AC-47: resumes the planning agent as the specification stage on the full lane', () => {
    const body = buildNarrationContractBody();
    expect(body).toContain(
      '**Planning and specification in one agent (full lane).** When `paqad-planning` returns `completed`, do not dispatch `paqad-specification`. Resume the same agent with: "Planning is done. Continue as the specification stage for the same change. Run `paqad-ai stage brief specification` and follow it." When it returns after `experts record`, dispatch the expert seats and the chief in parallel as below, then resume the same agent again with: "The High Table has ruled. Continue the specification stage from the questions step." Follow the resume protocol below; its fresh-dispatch exit applies here the same way.',
    );
    expect(body).toContain(
      'then resume that same agent (the resume protocol above) to carry on from the questions step.',
    );
    expect(body).not.toContain('then dispatch the specification stage again');
  });

  it('AC-47: writes the resume protocol once, with one 150000-token threshold', () => {
    const body = buildNarrationContractBody();
    const protocol =
      "**The resume protocol.** On Claude Code resume a stage agent with `SendMessage` and its agent id; on Codex use `send_input`. A resumed agent keeps its whole conversation, so it does not re-read what it already read, and it gets no new stage brief: when it moves to another stage, the resume message tells it to run `paqad-ai stage brief <stage>`. Dispatch a fresh agent instead only when the host cannot resume, refuses the resume or reports the agent gone, or when that agent's latest completion row (its newest `stage-agent` row with `event_status: completed` for that `agent_id`, never a sum of its rows) shows `tokens_not_recarried` above 150000. A fresh dispatch hands over in its prompt the files changed so far, the decisions made and what is left. Hosts with no resume (Cursor, Gemini CLI, Copilot, Windsurf, Junie and the rest) keep the fresh-dispatch flow: every stage in a new agent, and a stage that paused dispatched again after `paqad-ai decision resolve`.";
    expect(RESUME_HANDOVER_TOKENS).toBe(150000);
    expect(body).toContain(protocol);
    expect(body.split('**The resume protocol.**')).toHaveLength(2);
    expect(body.match(/150000/g)).toHaveLength(1);
    const router = readFileSync(join(process.cwd(), 'runtime/AGENT-ROUTER.md'), 'utf8');
    expect(router).toContain(protocol);
  });

  it('AC-48: runs development as one agent per change, resumed for each next task', () => {
    const body = buildNarrationContractBody();
    const paragraph =
      '**One development agent per change.** Development runs as ONE `paqad-development` agent per change. Dispatch it once with the whole plan. For anything development does after that (the next plan step, a fix after a paused decision, review fixes, acceptance-criteria test mapping, a fix after red checks), resume that same agent, naming what to do next. Follow the resume protocol below; its fresh-dispatch exit applies here the same way.';
    expect(body).toContain(paragraph);
    expect(body.indexOf(paragraph)).toBeLessThan(body.indexOf('**The resume protocol.**'));
    const router = readFileSync(join(process.cwd(), 'runtime/AGENT-ROUTER.md'), 'utf8');
    expect(router).toContain(paragraph);
  });

  it('AC-50: resumes the paused agent after decision resolve, never re-dispatching the same stage', () => {
    const body = buildNarrationContractBody();
    const paused = body.split('\n').find((line) => line.startsWith('3. On `paused: D-<id>`'))!;
    expect(paused).toContain(
      'resolve it with `paqad-ai decision resolve`, then resume the paused agent with the answer (the resume protocol below).',
    );
    expect(body).not.toContain('re-dispatch the SAME stage');
    const router = readFileSync(join(process.cwd(), 'runtime/AGENT-ROUTER.md'), 'utf8');
    expect(router).not.toContain('re-dispatch the SAME stage');
    expect(router).toContain(paused);
  });

  it('AC-49: never tells a host without resume to call SendMessage or send_input', () => {
    const body = buildNarrationContractBody();
    const noResume = body.slice(body.indexOf('Hosts with no resume'));
    const sentence = noResume.slice(0, noResume.indexOf('\n'));
    for (const host of ['Cursor', 'Gemini CLI', 'Copilot', 'Windsurf', 'Junie']) {
      expect(sentence).toContain(host);
    }
    expect(sentence).toContain('keep the fresh-dispatch flow');
    expect(sentence).not.toMatch(/SendMessage|send_input/);
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
