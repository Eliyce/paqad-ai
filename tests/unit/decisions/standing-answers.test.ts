import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  answerPendingDecision,
  createPendingDecision,
  type CreateDecisionInput,
} from '@/decisions/authoring.js';
import { NO_STANDING_ANSWER_CATEGORIES } from '@/decisions/earlier-answers.js';
import { readAnyDecisionPacket } from '@/decisions/packet-shape.js';
import {
  addStandingAnswer,
  findStandingAnswer,
  isStandingFileReadable,
  listStandingAnswers,
  removeStandingAnswer,
  STANDING_FILE_UNREADABLE,
} from '@/decisions/standing-answers.js';
import { readDecisionAuditEvents } from '@/planning/index.js';
import { DecisionStore } from '@/planning/decision-store.js';

import { pendingStorePacket } from '../../shared/store-packet.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-standing-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const QUESTION = 'keep the old file and remove the new file';

function input(overrides: Partial<CreateDecisionInput> = {}): CreateDecisionInput {
  return {
    category: 'workflow-or-tool',
    title: QUESTION,
    context: 'Two files clash.',
    options: [
      { option_key: 'yes', label: 'Yes please' },
      { option_key: 'no', label: 'No thanks' },
    ],
    ...overrides,
  };
}

function ruleFor(overrides: Partial<CreateDecisionInput> = {}, chosen = 'yes'): string {
  const created = createPendingDecision(root, input(overrides));
  const { rule } = answerPendingDecision(root, created.id, chosen, 'Keep it simple', {
    always: true,
  });
  return rule!.id;
}

function pendingCount(): number {
  const dir = join(root, PATHS.DECISIONS_PENDING_DIR);
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).length : 0;
}

function standingFile(): string {
  return join(root, PATHS.DECISIONS_STANDING_ANSWERS);
}

function writeStanding(text: string): void {
  mkdirSync(dirname(standingFile()), { recursive: true });
  writeFileSync(standingFile(), text);
}

describe('AC-12 AC-39 a matching rule answers the question', () => {
  it('writes straight to resolved, says standing-answer everywhere and returns reused', () => {
    const ruleId = ruleFor();
    const result = createPendingDecision(root, input());
    expect(result.reused).toEqual({ rule: ruleId, chosen: 'yes', label: 'Yes please' });
    expect(pendingCount()).toBe(0);
    const stored = JSON.parse(readFileSync(result.path, 'utf8'));
    expect(result.path).toContain(PATHS.DECISIONS_RESOLVED_DIR);
    expect(stored.human_response.responded_by).toBe('standing-answer');
    expect(stored.responded_by).toBe('standing-answer');
    expect(stored.rationale).toContain(ruleId);
    expect(stored).not.toHaveProperty('earlier_check');

    const read = readAnyDecisionPacket(stored);
    expect(read?.human_response?.responded_by).toBe('standing-answer');
    const legacy = { ...stored };
    delete legacy.decision_id;
    delete legacy.fingerprint;
    delete legacy.human_response;
    expect(readAnyDecisionPacket(legacy)?.human_response?.responded_by).toBe('standing-answer');

    const audit = readDecisionAuditEvents(root).filter((event) => event.decision_id === result.id);
    expect(audit.map((event) => event.responded_by)).toContain('standing-answer');
    expect(audit.map((event) => event.responded_by)).not.toContain('human');

    expect(audit.map((event) => event.event)).toEqual(['decision-resolved-by-rule']);
    expect(audit[0]?.provider).toBe('standing-answer');
    expect(audit[0]?.chosen_option_key).toBe('yes');
  });

  it('AC-39 a packet answered by a rule leaves the index unchanged', () => {
    ruleFor();
    createPendingDecision(root, input());
    expect(existsSync(join(root, PATHS.DECISIONS_INDEX))).toBe(false);
    new DecisionStore(root).initialize();
    const before = readFileSync(join(root, PATHS.DECISIONS_INDEX), 'utf8');
    createPendingDecision(root, input());
    expect(readFileSync(join(root, PATHS.DECISIONS_INDEX), 'utf8')).toBe(before);
  });

  it('a later rule for the same question replaces the earlier one', () => {
    const first = ruleFor();
    rmSync(join(root, PATHS.DECISIONS_RESOLVED_DIR), { recursive: true });
    const created = createPendingDecision(root, { ...input(), askAnyway: true });
    const { rule } = answerPendingDecision(root, created.id, 'no', '', { always: true });
    const rules = listStandingAnswers(root);
    expect(rules.map((entry) => entry.id)).toEqual([rule!.id]);
    expect(rules[0]?.id).not.toBe(first);
    expect(rules[0]).toMatchObject({
      category: 'workflow-or-tool',
      question: QUESTION,
      chosen: 'no',
      from_decision: created.id,
    });
    expect(rules[0]?.fingerprint).toMatch(/^sha256:/u);
    expect(createPendingDecision(root, input()).reused?.chosen).toBe('no');
  });

  it('keeps rules for other questions when one is replaced', () => {
    const other = ruleFor({ title: 'a wholly different matter entirely', context: 'x' });
    ruleFor();
    expect(listStandingAnswers(root).map((rule) => rule.id)).toContain(other);
  });
});

describe('AC-13 ask anyway and removal', () => {
  it('opens a pending packet with askAnyway, and again after the rule is removed', () => {
    const ruleId = ruleFor();
    expect(createPendingDecision(root, { ...input(), askAnyway: true }).reused).toBeUndefined();
    expect(pendingCount()).toBe(1);
    expect(removeStandingAnswer(root, ruleId).id).toBe(ruleId);
    expect(createPendingDecision(root, input()).reused).toBeUndefined();
    expect(pendingCount()).toBe(2);
  });
});

describe('AC-17 a store-format open ignores the rule', () => {
  it('still opens a pending pause', () => {
    ruleFor();
    new DecisionStore(root).writePending(
      pendingStorePacket({ category: 'workflow-or-tool', question: QUESTION }),
    );
    expect(pendingCount()).toBe(1);
  });
});

describe('AC-25 damage to the file never skips a person', () => {
  it('opens as pending on a corrupt or missing file', () => {
    expect(createPendingDecision(root, input()).reused).toBeUndefined();
    writeStanding('{ not json');
    expect(createPendingDecision(root, input()).reused).toBeUndefined();
    writeStanding('{"rules":"nope"}');
    expect(createPendingDecision(root, input()).reused).toBeUndefined();
    writeStanding('{"rules":[{"id":"R-1"},null,7]}');
    expect(createPendingDecision(root, input()).reused).toBeUndefined();
  });

  it('refuses --always on a corrupt file and does not overwrite it', () => {
    const { id } = createPendingDecision(root, input());
    writeStanding('{ not json');
    expect(isStandingFileReadable(root)).toBe(false);
    expect(() => answerPendingDecision(root, id, 'yes', '', { always: true })).toThrow(
      STANDING_FILE_UNREADABLE,
    );
    expect(readFileSync(standingFile(), 'utf8')).toBe('{ not json');
    expect(pendingCount()).toBe(1);
    expect(() => listStandingAnswers(root)).toThrow(STANDING_FILE_UNREADABLE);
    expect(() => removeStandingAnswer(root, 'R-1')).toThrow(STANDING_FILE_UNREADABLE);
  });

  it('refuses an unknown id on remove and changes nothing', () => {
    ruleFor();
    const before = readFileSync(standingFile(), 'utf8');
    expect(() => removeStandingAnswer(root, 'R-unknown')).toThrow('R-unknown');
    expect(readFileSync(standingFile(), 'utf8')).toBe(before);
  });
});

describe('INV-7 AC-35 what counts as the same question', () => {
  it('AC-35 a question with the same words reversed opens as pending', () => {
    ruleFor();
    const reversed = createPendingDecision(
      root,
      input({ title: 'keep the new file and remove the old file' }),
    );
    expect(reversed.reused).toBeUndefined();
  });

  it('folds case and spacing but nothing else', () => {
    ruleFor();
    const folded = createPendingDecision(
      root,
      input({ title: '  KEEP the old   file and remove the new file ' }),
    );
    expect(folded.reused).toBeDefined();
  });

  it('INV-7 ignores a rule whose chosen key is not on the packet now', () => {
    const rule = {
      category: 'workflow-or-tool',
      question: QUESTION,
      optionKeys: ['yes', 'no'],
    };
    const added = addStandingAnswer(root, { ...rule, chosen: 'yes', fromDecision: 'D-1' });
    const raw = JSON.parse(readFileSync(standingFile(), 'utf8'));
    raw.rules[0].chosen = 'gone';
    writeStanding(JSON.stringify(raw));
    expect(findStandingAnswer(root, rule)).toBeNull();
    expect(added.id).toMatch(/^R-/u);
  });

  it('never matches a question with no fingerprint', () => {
    const question = { category: 'scope', question: QUESTION, optionKeys: ['yes', 'no'] };
    expect(findStandingAnswer(root, question)).toBeNull();
    expect(() =>
      addStandingAnswer(root, { ...question, chosen: 'yes', fromDecision: 'D-9' }),
    ).toThrow('D-9');
    expect(
      findStandingAnswer(root, { ...question, category: 'ux-pattern', optionKeys: ['only'] }),
    ).toBeNull();
    expect(
      findStandingAnswer(root, {
        ...question,
        category: 'ux-pattern',
        optionKeys: ['a', 'b', 'c', 'd', 'e', 'f'],
      }),
    ).toBeNull();
  });
});

describe('AC-40 a rule in an excluded category is ignored when used', () => {
  it.each(NO_STANDING_ANSWER_CATEGORIES)('%s opens a pending packet', (category) => {
    const allowed = addStandingAnswer(root, {
      category: 'workflow-or-tool',
      question: QUESTION,
      optionKeys: ['yes', 'no'],
      chosen: 'yes',
      fromDecision: 'D-2',
    });
    const raw = JSON.parse(readFileSync(standingFile(), 'utf8'));
    writeStanding(
      JSON.stringify({
        rules: [
          {
            ...raw.rules[0],
            category,
            fingerprint: createFingerprint(category),
          },
        ],
      }),
    );
    expect(allowed.id).toBeTruthy();
    expect(createPendingDecision(root, input({ category })).reused).toBeUndefined();
    expect(pendingCount()).toBe(1);
  });

  function createFingerprint(category: string): string {
    const { path } = createPendingDecision(mkdtempRoot(), input({ category }));
    return JSON.parse(readFileSync(path, 'utf8')).fingerprint as string;
  }

  function mkdtempRoot(): string {
    return mkdtempSync(join(root, 'other-'));
  }
});

describe('AC-10 AC-36 AC-48 what --always refuses', () => {
  it.each(NO_STANDING_ANSWER_CATEGORIES)('AC-10 refuses %s', (category) => {
    const { id } = createPendingDecision(root, input({ category }));
    expect(() => answerPendingDecision(root, id, 'yes', '', { always: true })).toThrow(category);
    expect(pendingCount()).toBe(1);
    expect(existsSync(standingFile())).toBe(false);
  });

  it('AC-10 refuses a stage agent before anything changes', () => {
    const { id } = createPendingDecision(root, input());
    vi.stubEnv('SE_AGENT_ID', 'agent-1');
    expect(() => answerPendingDecision(root, id, 'yes', '', { always: true })).toThrow(
      'A stage agent cannot',
    );
    expect(pendingCount()).toBe(1);
    expect(existsSync(standingFile())).toBe(false);
  });

  it('a blank agent id is not a stage agent', () => {
    const { id } = createPendingDecision(root, input());
    vi.stubEnv('SE_AGENT_ID', '   ');
    expect(answerPendingDecision(root, id, 'yes', '', { always: true }).rule).toBeDefined();
  });

  it('AC-36 a packet with six options opens and resolves, with --always refused', () => {
    const options = ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => ({
      option_key: key,
      label: `Label ${key}`,
    }));
    const { id } = createPendingDecision(root, input({ options }));
    expect(() => answerPendingDecision(root, id, 'a', '', { always: true })).toThrow(
      'no stable fingerprint',
    );
    answerPendingDecision(root, id, 'a');
    expect(existsSync(join(root, PATHS.DECISIONS_INDEX))).toBe(false);
    expect(existsSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`))).toBe(true);
    const next = createPendingDecision(root, input());
    expect(JSON.parse(readFileSync(next.path, 'utf8'))).not.toHaveProperty('earlier_check');
  });

  it('AC-48 a store-format packet is refused', () => {
    const store = new DecisionStore(root);
    const id = 'D-01J0000000000000000000YYYY';
    store.writePending(pendingStorePacket({ decision_id: id }));
    expect(() => answerPendingDecision(root, id, 'a', '', { always: true })).toThrow(
      'rules do not apply',
    );
    expect(store.readPending(id)).not.toBeNull();
    expect(existsSync(standingFile())).toBe(false);
  });

  it('AC-48 a four-option packet in an allowed category adds a rule with no always entry shown', () => {
    const options = ['a', 'b', 'c', 'd'].map((key) => ({ option_key: key, label: `Label ${key}` }));
    const { id } = createPendingDecision(root, input({ options }));
    expect(answerPendingDecision(root, id, 'b', '', { always: true }).rule?.chosen).toBe('b');
  });

  it('leaves the missing-packet message to resolve', () => {
    expect(() =>
      answerPendingDecision(root, 'D-01J0000000000000000000XXXX', 'a', '', { always: true }),
    ).toThrow('not found');
  });
});
