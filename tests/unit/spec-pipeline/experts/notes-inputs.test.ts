import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkFindingVoice, validateQuestion } from '@/spec-pipeline/experts/notes.js';
import type { ExpertFinding } from '@/spec-pipeline/experts/types.js';
import type { VocabularyEntry } from '@/spec-pipeline/types.js';

function finding(target: string): ExpertFinding {
  return { target, claim: 'c' };
}

function word(term: string, kind: VocabularyEntry['kind']): VocabularyEntry {
  return { term, kind, source: 'docs' };
}

describe('checkFindingVoice', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-notes-voice-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function sources(vocabulary: VocabularyEntry[], indexPresent = false) {
    return {
      vocabulary,
      requestText: 'Let members export Invoices',
      projectRoot: root,
      indexPresent,
    };
  }

  it('accepts new things, the request itself, known words, request text and real paths', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/billing.ts'), 'x');

    expect(checkFindingVoice(finding('new export screen'), sources([])).ok).toBe(true);
    expect(checkFindingVoice(finding('this request'), sources([])).ok).toBe(true);
    expect(checkFindingVoice(finding('Member'), sources([word('member', 'role')])).ok).toBe(true);
    expect(checkFindingVoice(finding('invoices'), sources([])).ok).toBe(true);
    expect(checkFindingVoice(finding('`src/billing.ts`'), sources([])).ok).toBe(true);
  });

  it('names the closest business and technical words when the target is unknown', () => {
    const result = checkFindingVoice(
      finding('subscription renewal'),
      sources(
        [
          word('ab', 'glossary'),
          word('Subscription', 'glossary'),
          word('renewal_jobs table', 'technical'),
        ],
        true,
      ),
    );
    expect(result).toEqual({
      ok: false,
      hint: 'target "subscription renewal" is not a name this project uses; the docs say "Subscription" (glossary) and the schema page names "renewal_jobs table"',
    });
  });

  it('says there is no close match when nothing is near', () => {
    expect(checkFindingVoice(finding('``'), sources([word('ledger', 'glossary')])).hint).toBe(
      'target "``" is not a name this project uses; no close match',
    );
  });
});

describe('validateQuestion', () => {
  const good = {
    business_text: 'Who can export?',
    why_it_matters: 'Exports hold money data.',
    options: ['Admins', 'Everyone'],
    grounded_in: null,
  };

  it.each([
    ['a string', 'q', 'q[0] must be a question object'],
    ['an array', [], 'q[0] must be a question object'],
    ['no business text', { ...good, business_text: ' ' }, 'q[0] needs a non-empty business_text'],
    ['no reason', { ...good, why_it_matters: 3 }, 'q[0] needs a non-empty why_it_matters'],
    ['no options', { ...good, options: [] }, 'q[0] needs a non-empty options[] of strings'],
    [
      'blank option',
      { ...good, options: ['a', ' '] },
      'q[0] needs a non-empty options[] of strings',
    ],
    [
      'options not a list',
      { ...good, options: 'a' },
      'q[0] needs a non-empty options[] of strings',
    ],
    [
      'a numeric grounding',
      { ...good, grounded_in: 4 },
      'q[0] grounded_in must be a string or null',
    ],
  ])('rejects %s', (_label, raw, error) => {
    expect(validateQuestion(raw, 'q[0]')).toEqual({ ok: false, error });
  });

  it('keeps a technical note and a grounding reference', () => {
    expect(
      validateQuestion({ ...good, grounded_in: 'docs/a.md', technical_note: 'uses RBAC' }, 'q'),
    ).toEqual({
      ok: true,
      question: { ...good, grounded_in: 'docs/a.md', technical_note: 'uses RBAC' },
    });
  });
});
