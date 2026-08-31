import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildPreflightQuestions,
  canonicalAnswersPath,
  reconcileQuestions,
  recordAnswers,
  recordCreationAnswers,
  validateSiteMapAnswers,
  writeCreationAnswers,
} from '@/site-map/index.js';
import type { SiteMapAnswersFile } from '@/core/types/site-map-answers.js';
import type { PreflightResult } from '@/workflow-preflight/contract.js';

const ROUTE_OPTIONS = [
  { id: 'run', label: 'Let paqad run it', recommended: true },
  { id: 'print', label: 'Print and paste' },
];

/** A preflight result with one command-kind question and one workflow-kind question. */
function preflight(outcome: 'needs-decision' | 'unavailable' = 'needs-decision'): PreflightResult {
  return {
    ok: false,
    requirements: [
      {
        id: 'laravel-route-list',
        label: 'Laravel route list',
        kind: 'command',
        why: 'The real router resolves modular routes.',
        outcome,
        options: ROUTE_OPTIONS,
      },
      {
        id: 'documentation-foundation',
        label: 'Documentation foundation',
        kind: 'workflow',
        why: 'The map needs the documentation foundation first.',
        outcome: 'unavailable',
        options: [{ id: 'create-documentation', label: 'Run it', recommended: true }],
      },
    ],
    questions: [
      {
        id: 'laravel-route-list',
        label: 'Laravel route list',
        why: 'The real router resolves modular routes.',
        outcome,
        options: ROUTE_OPTIONS,
      },
      {
        id: 'documentation-foundation',
        label: 'Documentation foundation',
        why: 'The map needs the documentation foundation first.',
        outcome: 'unavailable',
        options: [{ id: 'create-documentation', label: 'Run it', recommended: true }],
      },
    ],
  };
}

describe('buildPreflightQuestions', () => {
  it('maps only command-kind questions to tool-access candidates, baking the outcome into the id', () => {
    const candidates = buildPreflightQuestions(preflight('needs-decision'));
    expect(candidates.map((c) => c.question_id)).toEqual([
      'tool-access:laravel-route-list:needs-decision',
    ]);
    const [candidate] = candidates;
    expect(candidate?.category).toBe('tool-access');
    expect(candidate?.anchors).toEqual([]);
    expect(candidate?.recommended_default.answer).toBe('run');
  });

  it('falls back to the first option when none is flagged recommended', () => {
    const source = preflight('needs-decision');
    source.questions[0]!.options = [
      { id: 'first', label: 'First' },
      { id: 'second', label: 'Second' },
    ];
    source.requirements[0]!.options = source.questions[0]!.options;
    const [candidate] = buildPreflightQuestions(source);
    expect(candidate?.recommended_default.answer).toBe('first');
  });
});

describe('recordCreationAnswers with a preflight result', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-preflight-answers-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('records a preflight answer on a map-less project through the existing writer (AC-6)', () => {
    const result = recordCreationAnswers(
      root,
      [
        {
          question_id: 'tool-access:laravel-route-list:needs-decision',
          answer: 'run',
          decided_by: 'human',
        },
      ],
      preflight('needs-decision'),
    );

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') throw new Error('unreachable');
    expect(result.recorded).toBe(1);
    expect(result.stamped).toBe(false);
    expect(result.map_path).toBeNull();

    const stored = YAML.parse(
      readFileSync(canonicalAnswersPath(root), 'utf8'),
    ) as SiteMapAnswersFile;
    const answer = stored.answers.find(
      (a) => a.question_id === 'tool-access:laravel-route-list:needs-decision',
    );
    // Category and anchors are re-derived from the candidate, never the agent's input.
    expect(answer?.category).toBe('tool-access');
    expect(answer?.anchors).toEqual([]);
    expect(answer?.decided_by).toBe('human');
  });

  it('reports an unknown id and does not persist it (INV-4)', () => {
    const result = recordCreationAnswers(
      root,
      [{ question_id: 'tool-access:not-a-thing:ok', answer: 'x', decided_by: 'human' }],
      preflight('needs-decision'),
    );
    if (result.status !== 'recorded') throw new Error('unreachable');
    expect(result.unknown).toEqual(['tool-access:not-a-thing:ok']);
    expect(result.recorded).toBe(0);
  });

  it('returns no-map when the map is absent and no preflight result is passed', () => {
    expect(recordCreationAnswers(root, [])).toEqual({ status: 'no-map' });
  });
});

describe('a settled tool-access answer is reused, and a changed probe result reopens it (AC-7)', () => {
  function settled(): SiteMapAnswersFile {
    const [candidate] = buildPreflightQuestions(preflight('needs-decision'));
    return recordAnswers(null, [
      {
        question_id: candidate!.question_id,
        category: candidate!.category,
        question: candidate!.question,
        answer: 'run',
        decided_by: 'human',
        anchors: candidate!.anchors,
      },
    ]);
  }

  it('reuses the settled answer while the probe result is unchanged', () => {
    const reconciliation = reconcileQuestions(
      buildPreflightQuestions(preflight('needs-decision')),
      settled(),
    );
    expect(reconciliation.to_ask).toEqual([]);
    expect(reconciliation.reused.map((a) => a.question_id)).toEqual([
      'tool-access:laravel-route-list:needs-decision',
    ]);
  });

  it('re-asks when the probe result changes (php disappears)', () => {
    const reconciliation = reconcileQuestions(
      buildPreflightQuestions(preflight('unavailable')),
      settled(),
    );
    expect(reconciliation.to_ask.map((c) => c.question_id)).toEqual([
      'tool-access:laravel-route-list:unavailable',
    ]);
    expect(reconciliation.reused).toEqual([]);
  });
});

describe('the tool-access category validates against the answers schema (AC-8)', () => {
  it('accepts a tool-access answer', () => {
    const file: SiteMapAnswersFile = {
      schema_version: 1,
      generated_by: 'paqad-ai',
      answers: [
        {
          question_id: 'tool-access:laravel-route-list:needs-decision',
          category: 'tool-access',
          question: 'How should paqad obtain the route list?',
          answer: 'run',
          decided_by: 'human',
          anchors: [],
        },
      ],
    };
    expect(validateSiteMapAnswers(file).valid).toBe(true);
  });

  it('round-trips a tool-access answer through the writer', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-tool-access-'));
    try {
      const file: SiteMapAnswersFile = {
        schema_version: 1,
        generated_by: 'paqad-ai',
        answers: [
          {
            question_id: 'tool-access:node-cli-program:unavailable',
            category: 'tool-access',
            question: 'How should the run reach the CLI?',
            answer: 'skip-cli',
            decided_by: 'default',
            anchors: [],
          },
        ],
      };
      const path = writeCreationAnswers(root, file);
      const back = YAML.parse(readFileSync(path, 'utf8')) as SiteMapAnswersFile;
      expect(back.answers[0]?.category).toBe('tool-access');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
