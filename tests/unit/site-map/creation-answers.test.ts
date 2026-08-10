import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SiteMapSchemaError,
  canonicalAnswersPath,
  emptyCreationAnswers,
  provenanceOf,
  readCreationAnswers,
  recordAnswers,
  reconcileQuestions,
  writeCreationAnswers,
} from '@/site-map/index.js';
import {
  SITE_MAP_ANSWERS_SCHEMA_VERSION,
  type CandidateQuestion,
  type SiteMapAnswer,
  type SiteMapAnswersFile,
} from '@/core/types/site-map-answers.js';

function humanAnswer(overrides: Partial<SiteMapAnswer> = {}): SiteMapAnswer {
  return {
    question_id: 'app-kind',
    category: 'app-kind',
    question: 'Is this a service or a CLI?',
    answer: 'cli',
    decided_by: 'human',
    anchors: ['src/cli/index.ts:1'],
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateQuestion> = {}): CandidateQuestion {
  return {
    question_id: 'app-kind',
    category: 'app-kind',
    question: 'Is this a service or a CLI?',
    anchors: ['src/cli/index.ts:1'],
    recommended_default: { answer: 'service', reason: 'it exposes an HTTP server' },
    ...overrides,
  };
}

describe('site-map creation answers', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-answers-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('store', () => {
    it('canonicalAnswersPath sits under docs/site-map', () => {
      expect(canonicalAnswersPath(root)).toBe(join(root, 'docs/site-map/answers.yaml'));
    });

    it('emptyCreationAnswers is a valid, writable, empty document', () => {
      const empty = emptyCreationAnswers();
      expect(empty).toEqual({
        schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION,
        generated_by: 'paqad-ai',
        answers: [],
      });
      const path = writeCreationAnswers(root, empty);
      expect(path).toBe(canonicalAnswersPath(root));
      expect(readCreationAnswers(root)).toEqual(empty);
    });

    it('round-trips a written answers file', () => {
      const file: SiteMapAnswersFile = {
        schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION,
        generated_by: 'paqad-ai',
        answers: [humanAnswer()],
      };
      writeCreationAnswers(root, file);
      expect(readCreationAnswers(root)).toEqual(file);
    });

    it('reads a missing file as absent (null)', () => {
      expect(readCreationAnswers(root)).toBeNull();
    });

    it('reads a corrupt file as absent (null)', () => {
      writeCreationAnswers(root, emptyCreationAnswers()); // creates docs/site-map/
      writeFileSync(canonicalAnswersPath(root), ':\n  - not: [valid', 'utf8');
      expect(readCreationAnswers(root)).toBeNull();
    });

    it('reads a schema-invalid file as absent (null)', () => {
      writeCreationAnswers(root, emptyCreationAnswers());
      writeFileSync(canonicalAnswersPath(root), YAML.stringify({ schema_version: 2 }), 'utf8');
      expect(readCreationAnswers(root)).toBeNull();
    });

    it('refuses to write a schema-invalid file', () => {
      const bad = { schema_version: 1, generated_by: 'someone-else', answers: [] } as never;
      expect(() => writeCreationAnswers(root, bad)).toThrow(SiteMapSchemaError);
    });

    it('persists as readable YAML on disk', () => {
      writeCreationAnswers(root, {
        schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION,
        generated_by: 'paqad-ai',
        answers: [humanAnswer()],
      });
      const raw = readFileSync(canonicalAnswersPath(root), 'utf8');
      expect(raw).toContain('question_id: app-kind');
    });
  });

  describe('reconcileQuestions', () => {
    it('asks a question that was never answered (no persisted file)', () => {
      const result = reconcileQuestions([candidate()], null);
      expect(result.to_ask).toHaveLength(1);
      expect(result.reused).toHaveLength(0);
      expect(result.reopened).toHaveLength(0);
    });

    it('reuses a persisted human answer whose anchors are unchanged (order-independent)', () => {
      const persisted: SiteMapAnswersFile = {
        schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION,
        generated_by: 'paqad-ai',
        answers: [humanAnswer({ anchors: ['b:2', 'a:1'] })],
      };
      const result = reconcileQuestions([candidate({ anchors: ['a:1', 'b:2'] })], persisted);
      expect(result.to_ask).toHaveLength(0);
      expect(result.reused.map((a) => a.question_id)).toEqual(['app-kind']);
      expect(result.reopened).toHaveLength(0);
    });

    it('reopens a human answer whose anchors changed (different content)', () => {
      const persisted: SiteMapAnswersFile = {
        schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION,
        generated_by: 'paqad-ai',
        answers: [humanAnswer({ anchors: ['src/cli/index.ts:1'] })],
      };
      const result = reconcileQuestions(
        [candidate({ anchors: ['src/cli/index.ts:42'] })],
        persisted,
      );
      expect(result.to_ask.map((q) => q.question_id)).toEqual(['app-kind']);
      expect(result.reused).toHaveLength(0);
      expect(result.reopened).toEqual(['app-kind']);
    });

    it('reopens a human answer whose anchor count changed (different length)', () => {
      const persisted: SiteMapAnswersFile = {
        schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION,
        generated_by: 'paqad-ai',
        answers: [humanAnswer({ anchors: ['a:1'] })],
      };
      const result = reconcileQuestions([candidate({ anchors: ['a:1', 'b:2'] })], persisted);
      expect(result.reopened).toEqual(['app-kind']);
      expect(result.to_ask).toHaveLength(1);
    });

    it('never reuses a persisted default; it re-offers the question', () => {
      const persisted: SiteMapAnswersFile = {
        schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION,
        generated_by: 'paqad-ai',
        answers: [humanAnswer({ decided_by: 'default' })],
      };
      const result = reconcileQuestions([candidate()], persisted);
      expect(result.to_ask).toHaveLength(1);
      expect(result.reused).toHaveLength(0);
      expect(result.reopened).toHaveLength(0);
    });
  });

  describe('recordAnswers', () => {
    it('starts a fresh set from no prior answers', () => {
      const file = recordAnswers(null, [humanAnswer()]);
      expect(file.schema_version).toBe(SITE_MAP_ANSWERS_SCHEMA_VERSION);
      expect(file.generated_by).toBe('paqad-ai');
      expect(file.answers.map((a) => a.question_id)).toEqual(['app-kind']);
    });

    it('upserts by question_id (newest wins) and sorts by id', () => {
      const prior: SiteMapAnswersFile = {
        schema_version: SITE_MAP_ANSWERS_SCHEMA_VERSION,
        generated_by: 'paqad-ai',
        answers: [humanAnswer({ question_id: 'grouping', category: 'grouping', answer: 'old' })],
      };
      const file = recordAnswers(prior, [
        humanAnswer({ question_id: 'grouping', category: 'grouping', answer: 'new' }),
        humanAnswer({ question_id: 'app-kind' }),
      ]);
      expect(file.answers.map((a) => a.question_id)).toEqual(['app-kind', 'grouping']);
      expect(file.answers.find((a) => a.question_id === 'grouping')?.answer).toBe('new');
    });

    it('normalizes anchors so re-recording is idempotent', () => {
      const first = recordAnswers(null, [humanAnswer({ anchors: ['b:2', 'a:1'] })]);
      const second = recordAnswers(first, []);
      expect(first.answers[0].anchors).toEqual(['a:1', 'b:2']);
      expect(second).toEqual(first);
    });
  });

  describe('provenanceOf', () => {
    it('maps a human answer to normal confidence and human derivation', () => {
      expect(provenanceOf(humanAnswer())).toEqual({ derivation: 'human', confidence: 'high' });
    });

    it('maps a default answer to reduced confidence and agent derivation', () => {
      expect(provenanceOf(humanAnswer({ decided_by: 'default' }))).toEqual({
        derivation: 'agent',
        confidence: 'low',
      });
    });
  });
});
