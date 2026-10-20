import { describe, expect, it } from 'vitest';

import {
  auditTurnNarration,
  isAgentNarratableStage,
  unnarratedAdvisory,
} from '@/stage-evidence/narration-audit.js';
import { STAGE_NARRATION } from '@/stage-evidence/narration.js';

function assistantText(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function hookAttachment(line: string): string {
  return JSON.stringify({
    type: 'attachment',
    attachment: {
      type: 'hook_success',
      hookName: 'PreToolUse:Write',
      stdout: `${JSON.stringify({ systemMessage: line })}\n`,
    },
  });
}

describe('isAgentNarratableStage', () => {
  it('is true only for agent-authored provenance (live-mark, redo)', () => {
    expect(isAgentNarratableStage('live-mark')).toBe(true);
    expect(isAgentNarratableStage('redo')).toBe(true);
  });

  it('is false for hook/backstop-inferred and ambiguous provenance', () => {
    expect(isAgentNarratableStage('inferred-git')).toBe(false);
    expect(isAgentNarratableStage('inferred-artifact')).toBe(false);
    expect(isAgentNarratableStage(null)).toBe(false);
  });
});

describe('auditTurnNarration', () => {
  it('reports nothing when every recorded stage was spoken in visible text', () => {
    const transcript = [
      assistantText(`▸ paqad · ${STAGE_NARRATION.planning}`),
      assistantText(`▸ paqad · ${STAGE_NARRATION.development}`),
    ].join('\n');

    expect(
      auditTurnNarration({ transcriptText: transcript, recorded: ['planning', 'development'] }),
    ).toEqual([]);
  });

  it('AC-4: reports a recorded stage the agent never spoke', () => {
    const transcript = assistantText(`▸ paqad · ${STAGE_NARRATION.planning}`);

    expect(
      auditTurnNarration({ transcriptText: transcript, recorded: ['planning', 'review'] }),
    ).toEqual(['review']);
  });

  it('AC-6/INV-2: a line carried ONLY by a hook attachment does not count as narration', () => {
    const transcript = [
      hookAttachment(`▸ paqad · ${STAGE_NARRATION.development}`),
      assistantText('Done. Here is the summary of what changed.'),
    ].join('\n');

    expect(auditTurnNarration({ transcriptText: transcript, recorded: ['development'] })).toEqual([
      'development',
    ]);
  });

  it('accepts an agent that phrases the line its own way but names the stage', () => {
    const transcript = assistantText('**▸ paqad** · starting review of the diff');

    expect(auditTurnNarration({ transcriptText: transcript, recorded: ['review'] })).toEqual([]);
  });

  it('does not accept the stage name without the branded prefix', () => {
    const transcript = assistantText('I am going to review the change now.');

    expect(auditTurnNarration({ transcriptText: transcript, recorded: ['review'] })).toEqual([
      'review',
    ]);
  });

  it('returns findings in canonical stage order, not the order recorded', () => {
    expect(
      auditTurnNarration({
        transcriptText: assistantText('no narration here'),
        recorded: ['review', 'planning', 'development'],
      }),
    ).toEqual(['planning', 'development', 'review']);
  });

  it('reports nothing when no stages were recorded', () => {
    expect(auditTurnNarration({ transcriptText: assistantText('hello'), recorded: [] })).toEqual(
      [],
    );
  });

  it('ignores unknown stage ids rather than reporting them as unnarrated', () => {
    expect(
      auditTurnNarration({ transcriptText: assistantText('hello'), recorded: ['not-a-stage'] }),
    ).toEqual([]);
  });

  it('INV-3: an empty transcript is "cannot tell", not "said nothing"', () => {
    expect(auditTurnNarration({ transcriptText: '', recorded: ['planning'] })).toEqual([]);
  });

  it('INV-3: malformed JSONL lines are skipped rather than throwing', () => {
    const transcript = [
      'not json at all',
      '{"broken": ',
      assistantText(`▸ paqad · ${STAGE_NARRATION.planning}`),
    ].join('\n');

    expect(() =>
      auditTurnNarration({ transcriptText: transcript, recorded: ['planning'] }),
    ).not.toThrow();
    expect(auditTurnNarration({ transcriptText: transcript, recorded: ['planning'] })).toEqual([]);
  });

  it('reads a plain-text transcript for hosts that write one', () => {
    expect(
      auditTurnNarration({
        transcriptText: `▸ paqad · ${STAGE_NARRATION.checks}`,
        recorded: ['checks'],
      }),
    ).toEqual([]);
  });
});

describe('unnarratedAdvisory', () => {
  it('is empty when nothing was silent, so a caller can treat it as "no advisory"', () => {
    expect(unnarratedAdvisory([])).toBe('');
  });

  it('names the silent stages and asks for the receipt in the final message', () => {
    const advisory = unnarratedAdvisory(['planning', 'review']);

    expect(advisory).toContain('planning, review');
    expect(advisory).toContain('final message');
    expect(advisory).toContain('▸ paqad');
  });

  it('reads naturally for a single silent stage', () => {
    expect(unnarratedAdvisory(['review'])).toContain('a stage you never said out loud');
  });
});
