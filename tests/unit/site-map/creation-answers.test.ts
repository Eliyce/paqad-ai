import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SiteMapSchemaError,
  buildCandidateQuestions,
  canonicalAnswersPath,
  emptyCreationAnswers,
  provenanceOf,
  readCreationAnswers,
  recordAnswers,
  reconcileQuestions,
  stampAnswerProvenance,
  writeCreationAnswers,
} from '@/site-map/index.js';
import {
  SITE_MAP_ANSWERS_SCHEMA_VERSION,
  type CandidateQuestion,
  type SiteMapAnswer,
  type SiteMapAnswersFile,
} from '@/core/types/site-map-answers.js';
import type { AppMap } from '@/core/types/site-map.js';

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

  describe('buildCandidateQuestions', () => {
    function mapWith(overrides: Partial<AppMap> = {}): AppMap {
      return {
        schema_version: 1,
        app: { name: 'Demo', kind: 'web' },
        surfaces: [],
        ...overrides,
      };
    }

    it('asks nothing for a map with no ambiguity to resolve', () => {
      const map = mapWith({
        surfaces: [{ id: 's1', kind: 'page', label: 'Home', area: 'core' }],
        guards: [{ id: 'g1', kind: 'auth-state', label: 'Signed in' }],
        actors: [{ id: 'user', label: 'User', satisfies: ['g1'] }],
        journeys: [{ id: 'j1', label: 'Sign in', status: 'confirmed' }],
      });
      expect(buildCandidateQuestions(map)).toEqual([]);
    });

    it('asks a grouping question for ungrouped surfaces, with deduped sorted anchors', () => {
      const map = mapWith({
        surfaces: [
          {
            id: 's1',
            kind: 'page',
            label: 'Home',
            evidence: [
              { file: 'src/b.ts', line: 2 },
              { file: 'src/a.ts', line: 1 },
            ],
          },
          { id: 's2', kind: 'page', label: 'About', evidence: { file: 'src/a.ts', line: 1 } },
          { id: 's3', kind: 'page', label: 'Grouped', area: 'core' },
        ],
      });
      const [question] = buildCandidateQuestions(map);
      expect(question.category).toBe('grouping');
      expect(question.question_id).toBe('grouping:ungrouped-surfaces');
      expect(question.question).toContain('2 surface(s)');
      expect(question.anchors).toEqual(['src/a.ts:1', 'src/b.ts:2']);
      expect(question.recommended_default.answer).toBe('group-by-module');
    });

    it('drops the anchor line when an ungrouped surface cites no evidence', () => {
      const map = mapWith({ surfaces: [{ id: 's1', kind: 'page', label: 'Home' }] });
      const [question] = buildCandidateQuestions(map);
      expect(question.anchors).toEqual([]);
    });

    it('asks an actors-roles question when guards exist but no actors are named', () => {
      const map = mapWith({
        surfaces: [{ id: 's1', kind: 'page', label: 'Home', area: 'core' }],
        guards: [
          { id: 'g1', kind: 'role', label: 'Admin', evidence: { file: 'src/g.ts', line: 3 } },
        ],
      });
      const questions = buildCandidateQuestions(map);
      expect(questions).toHaveLength(1);
      expect(questions[0].category).toBe('actors-roles');
      expect(questions[0].anchors).toEqual(['src/g.ts:3']);
    });

    it('does not ask about actors when actors are already named', () => {
      const map = mapWith({
        surfaces: [{ id: 's1', kind: 'page', label: 'Home', area: 'core' }],
        guards: [{ id: 'g1', kind: 'role', label: 'Admin' }],
        actors: [{ id: 'admin', label: 'Admin' }],
      });
      expect(buildCandidateQuestions(map)).toEqual([]);
    });

    it('asks a journey-priority question for proposed journeys, with no anchors', () => {
      const map = mapWith({
        surfaces: [{ id: 's1', kind: 'page', label: 'Home', area: 'core' }],
        journeys: [
          { id: 'j1', label: 'Onboard', status: 'proposed' },
          { id: 'j2', label: 'Checkout', status: 'confirmed' },
        ],
      });
      const questions = buildCandidateQuestions(map);
      expect(questions).toHaveLength(1);
      expect(questions[0].category).toBe('journey-priority');
      expect(questions[0].question).toContain('1 journey(s)');
      expect(questions[0].anchors).toEqual([]);
    });

    it('asks a labels-language question only for surfaces still showing their i18n key', () => {
      const map = mapWith({
        surfaces: [
          // key with no resolved labels catalog -> asked
          {
            id: 's1',
            kind: 'page',
            label: 'home.title',
            label_key: 'home.title',
            area: 'core',
            evidence: { file: 'src/h.ts', line: 4 },
          },
          // labels present but label still equals the key -> asked
          {
            id: 's2',
            kind: 'page',
            label: 'about.title',
            label_key: 'about.title',
            labels: { en: 'About' },
            area: 'core',
          },
          // labels present and label already resolved -> not asked
          {
            id: 's3',
            kind: 'page',
            label: 'Contact',
            label_key: 'contact.title',
            labels: { en: 'Contact' },
            area: 'core',
          },
          // no key at all -> not asked
          { id: 's4', kind: 'page', label: 'Plain', area: 'core' },
        ],
      });
      const questions = buildCandidateQuestions(map);
      expect(questions).toHaveLength(1);
      expect(questions[0].category).toBe('labels-language');
      expect(questions[0].question).toContain('2 surface(s)');
      expect(questions[0].anchors).toEqual(['src/h.ts:4']);
    });

    it('returns all four categories in a fixed order for a fresh map', () => {
      const map = mapWith({
        surfaces: [{ id: 's1', kind: 'page', label: 'k', label_key: 'k' }],
        guards: [{ id: 'g1', kind: 'role', label: 'Admin' }],
        journeys: [{ id: 'j1', label: 'Onboard', status: 'proposed' }],
      });
      expect(buildCandidateQuestions(map).map((q) => q.category)).toEqual([
        'grouping',
        'actors-roles',
        'journey-priority',
        'labels-language',
      ]);
    });
  });

  describe('stampAnswerProvenance', () => {
    function mapWith(surfaces: AppMap['surfaces']): AppMap {
      return { schema_version: 1, app: { name: 'Demo', kind: 'web' }, surfaces };
    }

    function answer(overrides: Partial<SiteMapAnswer> = {}): SiteMapAnswer {
      return {
        question_id: 'grouping:ungrouped-surfaces',
        category: 'grouping',
        question: 'How should these surfaces be grouped?',
        answer: 'group-by-module',
        decided_by: 'human',
        anchors: ['src/a.ts:1'],
        ...overrides,
      };
    }

    it('leaves the map untouched (same reference) when there are no answers', () => {
      const map = mapWith([
        { id: 's1', kind: 'page', label: 'Home', evidence: { file: 'src/a.ts', line: 1 } },
      ]);
      const result = stampAnswerProvenance(map, []);
      expect(result.changed).toBe(false);
      expect(result.map).toBe(map);
    });

    it('stamps a human answer as human/high on the surface it settled, without mutating the input', () => {
      const map = mapWith([
        { id: 's1', kind: 'page', label: 'Home', evidence: { file: 'src/a.ts', line: 1 } },
      ]);
      const result = stampAnswerProvenance(map, [answer()]);
      expect(result.changed).toBe(true);
      expect(result.map.surfaces[0].derivation).toBe('human');
      expect(result.map.surfaces[0].confidence).toBe('high');
      // the input map object is untouched
      expect(map.surfaces[0].derivation).toBeUndefined();
    });

    it('stamps a default answer as agent/low, so a defaulted decision reads as not user-confirmed', () => {
      const map = mapWith([
        { id: 's1', kind: 'page', label: 'k', evidence: { file: 'src/h.ts', line: 4 } },
      ]);
      const result = stampAnswerProvenance(map, [
        answer({ category: 'labels-language', decided_by: 'default', anchors: ['src/h.ts:4'] }),
      ]);
      expect(result.changed).toBe(true);
      expect(result.map.surfaces[0].derivation).toBe('agent');
      expect(result.map.surfaces[0].confidence).toBe('low');
    });

    it('stamps nothing for irrelevant answers (wrong category, empty anchors, or no coverage)', () => {
      const map = mapWith([
        // has evidence, but no answer legitimately covers it
        { id: 's1', kind: 'page', label: 'Home', evidence: { file: 'src/a.ts', line: 1 } },
        // has no evidence at all, so nothing can anchor to it
        { id: 's2', kind: 'page', label: 'Blank' },
      ]);
      const result = stampAnswerProvenance(map, [
        // a guard-shaped category never bleeds onto a surface, even on a shared anchor
        answer({
          question_id: 'actors-roles:x',
          category: 'actors-roles',
          anchors: ['src/a.ts:1'],
        }),
        // a journey-priority answer carries no anchors, so it settles no element
        answer({ question_id: 'journey-priority:x', category: 'journey-priority', anchors: [] }),
        // a grouping answer about different code does not cover this surface
        answer({ anchors: ['src/other.ts:9'] }),
      ]);
      expect(result.changed).toBe(false);
      expect(result.map).toBe(map);
    });

    it('never downgrades a stronger static fact to a default guess (monotonic)', () => {
      const map = mapWith([
        {
          id: 's1',
          kind: 'page',
          label: 'Home',
          derivation: 'static',
          confidence: 'high',
          evidence: { file: 'src/a.ts', line: 1 },
        },
      ]);
      const result = stampAnswerProvenance(map, [answer({ decided_by: 'default' })]);
      expect(result.changed).toBe(false);
      expect(result.map.surfaces[0].derivation).toBe('static');
      expect(result.map.surfaces[0].confidence).toBe('high');
    });

    it('raises confidence within the same derivation, then is idempotent on a second pass', () => {
      const map = mapWith([
        {
          id: 's1',
          kind: 'page',
          label: 'Home',
          derivation: 'human',
          confidence: 'low',
          evidence: { file: 'src/a.ts', line: 1 },
        },
      ]);
      const first = stampAnswerProvenance(map, [answer()]);
      expect(first.changed).toBe(true);
      expect(first.map.surfaces[0].confidence).toBe('high');

      const second = stampAnswerProvenance(first.map, [answer()]);
      expect(second.changed).toBe(false);
      expect(second.map).toBe(first.map);
    });

    it('fills a missing confidence when the derivation already matches', () => {
      const map = mapWith([
        {
          id: 's1',
          kind: 'page',
          label: 'k',
          derivation: 'agent',
          evidence: { file: 'src/h.ts', line: 4 },
        },
      ]);
      const result = stampAnswerProvenance(map, [
        answer({ category: 'labels-language', decided_by: 'default', anchors: ['src/h.ts:4'] }),
      ]);
      expect(result.changed).toBe(true);
      expect(result.map.surfaces[0].confidence).toBe('low');
    });

    it('picks the strongest matching answer regardless of order (human beats default)', () => {
      const surface = mapWith([
        { id: 's1', kind: 'page', label: 'Home', evidence: { file: 'src/a.ts', line: 1 } },
      ]);
      const humanAns = answer({ question_id: 'grouping:h', decided_by: 'human' });
      const defaultAns = answer({ question_id: 'grouping:d', decided_by: 'default' });

      // default first, then upgraded to human
      const a = stampAnswerProvenance(surface, [defaultAns, humanAns]);
      expect(a.map.surfaces[0].derivation).toBe('human');
      // human first, default does not weaken it
      const b = stampAnswerProvenance(surface, [humanAns, defaultAns]);
      expect(b.map.surfaces[0].derivation).toBe('human');
    });

    it('keeps the untouched surfaces as their original objects when only one changes', () => {
      const map = mapWith([
        { id: 's1', kind: 'page', label: 'Home', evidence: { file: 'src/a.ts', line: 1 } },
        { id: 's2', kind: 'page', label: 'Other', area: 'core' },
      ]);
      const result = stampAnswerProvenance(map, [answer()]);
      expect(result.changed).toBe(true);
      expect(result.map.surfaces[1]).toBe(map.surfaces[1]);
    });
  });
});
