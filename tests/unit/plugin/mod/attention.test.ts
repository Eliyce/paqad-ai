import { describe, expect, it } from 'vitest';
import { waitingOnHuman } from '../../../../runtime/claude-plugin/mod/attention.ts';
import { IDLE_LIVE } from '../../../../runtime/claude-plugin/mod/live.ts';
import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  FULL_ORD_501,
  GRADUATED_ORD_482,
  INCONCLUSIVE,
  NEEDS_ATTENTION,
  PAUSED,
  STOPPED,
  fileText,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

type Raw = Record<string, unknown>;

const parse = (raw: Raw) => parseSnapshot(fileText(raw))!;

describe('waitingOnHuman — the one definition of needs you', () => {
  it('is true for a pending decision, a question on screen and a permission a person answers', () => {
    expect(waitingOnHuman(parse(GRADUATED_ORD_482))).toBe(true);
    expect(waitingOnHuman(parse(FULL_ORD_501), { ...IDLE_LIVE, waitingOn: 'question' })).toBe(true);
    expect(waitingOnHuman(null, { ...IDLE_LIVE, waitingOn: 'permission' })).toBe(true);
  });

  it('is false for a rule stop, a fail verdict, open flags, inconclusive or a paused change', () => {
    for (const raw of [STOPPED, NEEDS_ATTENTION, FULL_ORD_501, INCONCLUSIVE, PAUSED]) {
      expect(waitingOnHuman(parse(raw))).toBe(false);
    }
    expect(waitingOnHuman(null)).toBe(false);
  });
});
