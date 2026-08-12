import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildCandidateQuestions,
  canonicalAnswersPath,
  deriveCreationQuestions,
  parseCreationDecisions,
  recordAnswers,
  recordCreationAnswers,
  writeCanonicalSiteMap,
  writeCreationAnswers,
} from '@/site-map/index.js';
import { SITE_MAP_SCHEMA_VERSION, type AppMap } from '@/core/types/site-map.js';
import type { SiteMapAnswer, SiteMapAnswersFile } from '@/core/types/site-map-answers.js';

/** A map with one ungrouped, evidenced surface — triggers exactly the `grouping` question. */
function groupingMap(line = 1): AppMap {
  return {
    schema_version: SITE_MAP_SCHEMA_VERSION,
    app: { name: 'tiny', kind: 'cli' },
    surfaces: [
      {
        id: 'cli.root',
        kind: 'cli-command',
        label: 'Root command',
        evidence: { file: 'src/cli/index.ts', line },
      },
    ],
  };
}

/** A map whose only open question is `journey-priority` (surfaces grouped, no guards/keyed labels). */
function journeyMap(): AppMap {
  return {
    schema_version: SITE_MAP_SCHEMA_VERSION,
    app: { name: 'tiny', kind: 'cli' },
    areas: [{ id: 'main', label: 'Main' }],
    surfaces: [{ id: 'cli.root', kind: 'cli-command', label: 'Root command', area: 'main' }],
    journeys: [{ id: 'onboard', label: 'Onboard', actor: 'dev', status: 'proposed' }],
  };
}

/** A fully-decided map (grouped surface, no guards, no proposed journeys, no keyed labels). */
function settledMap(): AppMap {
  return {
    schema_version: SITE_MAP_SCHEMA_VERSION,
    app: { name: 'tiny', kind: 'cli' },
    areas: [{ id: 'main', label: 'Main' }],
    surfaces: [{ id: 'cli.root', kind: 'cli-command', label: 'Root command', area: 'main' }],
  };
}

function readMap(root: string): AppMap {
  return YAML.parse(readFileSync(join(root, 'docs/site-map/app-map.yaml'), 'utf8')) as AppMap;
}

describe('site-map creation flow', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-flow-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('deriveCreationQuestions', () => {
    it('returns no-map when no authored map exists', () => {
      expect(deriveCreationQuestions(root)).toEqual({ status: 'no-map' });
    });

    it('asks the map’s open questions when there are no prior answers', () => {
      writeCanonicalSiteMap(root, groupingMap());
      const result = deriveCreationQuestions(root);
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') throw new Error('unreachable');
      expect(result.reconciliation.to_ask.map((q) => q.question_id)).toEqual([
        'grouping:ungrouped-surfaces',
      ]);
      expect(result.reconciliation.reused).toEqual([]);
      expect(result.reconciliation.reopened).toEqual([]);
    });

    it('reuses a settled human answer whose code is unchanged, and asks nothing more', () => {
      writeCanonicalSiteMap(root, groupingMap());
      const candidate = buildCandidateQuestions(groupingMap())[0];
      const answer: SiteMapAnswer = {
        question_id: candidate.question_id,
        category: candidate.category,
        question: candidate.question,
        answer: 'group-by-module',
        decided_by: 'human',
        anchors: candidate.anchors,
      };
      writeCreationAnswers(root, recordAnswers(null, [answer]));

      const result = deriveCreationQuestions(root);
      if (result.status !== 'ready') throw new Error('unreachable');
      expect(result.reconciliation.to_ask).toEqual([]);
      expect(result.reconciliation.reused.map((a) => a.question_id)).toEqual([
        'grouping:ungrouped-surfaces',
      ]);
      expect(result.reconciliation.reopened).toEqual([]);
    });

    it('reopens a settled human answer when its motivating code moved', () => {
      writeCanonicalSiteMap(root, groupingMap(1));
      // Persist a human answer against the OLD anchor (line 1).
      const oldCandidate = buildCandidateQuestions(groupingMap(1))[0];
      writeCreationAnswers(
        root,
        recordAnswers(null, [
          {
            question_id: oldCandidate.question_id,
            category: oldCandidate.category,
            question: oldCandidate.question,
            answer: 'group-by-module',
            decided_by: 'human',
            anchors: oldCandidate.anchors,
          },
        ]),
      );
      // The surface moved to line 9, so the anchors no longer match.
      writeCanonicalSiteMap(root, groupingMap(9));

      const result = deriveCreationQuestions(root);
      if (result.status !== 'ready') throw new Error('unreachable');
      expect(result.reconciliation.to_ask.map((q) => q.question_id)).toEqual([
        'grouping:ungrouped-surfaces',
      ]);
      expect(result.reconciliation.reopened).toEqual(['grouping:ungrouped-surfaces']);
      expect(result.reconciliation.reused).toEqual([]);
    });

    it('asks nothing when the map is fully decided', () => {
      writeCanonicalSiteMap(root, settledMap());
      const result = deriveCreationQuestions(root);
      if (result.status !== 'ready') throw new Error('unreachable');
      expect(result.reconciliation.to_ask).toEqual([]);
    });
  });

  describe('recordCreationAnswers', () => {
    it('returns no-map when no authored map exists', () => {
      expect(recordCreationAnswers(root, [])).toEqual({ status: 'no-map' });
    });

    it('records a human grouping decision and stamps its provenance onto the surface', () => {
      writeCanonicalSiteMap(root, groupingMap());
      const result = recordCreationAnswers(root, [
        {
          question_id: 'grouping:ungrouped-surfaces',
          answer: 'group-by-module',
          decided_by: 'human',
        },
      ]);
      expect(result).toMatchObject({ status: 'recorded', recorded: 1, unknown: [], stamped: true });
      if (result.status !== 'recorded') throw new Error('unreachable');
      expect(result.answers_path).toBe(canonicalAnswersPath(root));
      expect(result.map_path).toBe(join(root, 'docs/site-map/app-map.yaml'));

      // The persisted answer re-derived its anchors from the map, not from the caller.
      const persisted = YAML.parse(
        readFileSync(canonicalAnswersPath(root), 'utf8'),
      ) as SiteMapAnswersFile;
      expect(persisted.answers[0]).toMatchObject({
        question_id: 'grouping:ungrouped-surfaces',
        category: 'grouping',
        decided_by: 'human',
        anchors: ['src/cli/index.ts:1'],
      });
      // The surface now reads as human-confirmed.
      const surface = readMap(root).surfaces[0];
      expect(surface.derivation).toBe('human');
      expect(surface.confidence).toBe('high');
    });

    it('is idempotent: re-recording the same answer rewrites nothing on the map', () => {
      writeCanonicalSiteMap(root, groupingMap());
      const decisions = [
        {
          question_id: 'grouping:ungrouped-surfaces',
          answer: 'group-by-module',
          decided_by: 'human' as const,
        },
      ];
      recordCreationAnswers(root, decisions);
      const second = recordCreationAnswers(root, decisions);
      expect(second).toMatchObject({
        status: 'recorded',
        recorded: 1,
        stamped: false,
        map_path: null,
      });
    });

    it('records a decision that decides no surface, leaving the map untouched', () => {
      writeCanonicalSiteMap(root, journeyMap());
      const result = recordCreationAnswers(root, [
        {
          question_id: 'journey-priority:proposed',
          answer: 'keep-all-proposed',
          decided_by: 'human',
        },
      ]);
      expect(result).toMatchObject({
        status: 'recorded',
        recorded: 1,
        stamped: false,
        map_path: null,
      });
      if (result.status !== 'recorded') throw new Error('unreachable');
      expect(result.answers_path).toBe(canonicalAnswersPath(root));
    });

    it('skips a decision with no current question but records the ones that match', () => {
      writeCanonicalSiteMap(root, groupingMap());
      const result = recordCreationAnswers(root, [
        {
          question_id: 'grouping:ungrouped-surfaces',
          answer: 'group-by-module',
          decided_by: 'human',
        },
        { question_id: 'labels-language:gone', answer: 'whatever', decided_by: 'default' },
      ]);
      expect(result).toMatchObject({
        status: 'recorded',
        recorded: 1,
        unknown: ['labels-language:gone'],
        stamped: true,
      });
    });

    it('writes nothing when every decision is stale', () => {
      writeCanonicalSiteMap(root, groupingMap());
      const result = recordCreationAnswers(root, [
        { question_id: 'grouping:gone', answer: 'x', decided_by: 'human' },
      ]);
      expect(result).toEqual({
        status: 'recorded',
        recorded: 0,
        unknown: ['grouping:gone'],
        answers_path: null,
        stamped: false,
        map_path: null,
      });
    });
  });

  describe('parseCreationDecisions', () => {
    it('parses a valid batch (an optional known category is accepted and dropped)', () => {
      const decisions = parseCreationDecisions(
        JSON.stringify([
          { question_id: 'q1', answer: 'a', decided_by: 'human', category: 'grouping' },
          { question_id: 'q2', answer: 'b', decided_by: 'default' },
        ]),
      );
      expect(decisions).toEqual([
        { question_id: 'q1', answer: 'a', decided_by: 'human' },
        { question_id: 'q2', answer: 'b', decided_by: 'default' },
      ]);
    });

    it('rejects non-JSON', () => {
      expect(() => parseCreationDecisions('not json')).toThrow('not valid JSON');
    });

    it('rejects a non-array top level', () => {
      expect(() => parseCreationDecisions('{}')).toThrow('must be a JSON array');
    });

    it('rejects a non-object entry', () => {
      expect(() => parseCreationDecisions('[3]')).toThrow('decision 0 must be an object');
    });

    it('rejects a null entry', () => {
      expect(() => parseCreationDecisions('[null]')).toThrow('decision 0 must be an object');
    });

    it('rejects a non-string question_id', () => {
      expect(() =>
        parseCreationDecisions('[{"question_id":1,"answer":"a","decided_by":"human"}]'),
      ).toThrow('non-empty "question_id"');
    });

    it('rejects an empty question_id', () => {
      expect(() =>
        parseCreationDecisions('[{"question_id":"","answer":"a","decided_by":"human"}]'),
      ).toThrow('non-empty "question_id"');
    });

    it('rejects a non-string answer', () => {
      expect(() =>
        parseCreationDecisions('[{"question_id":"q","answer":5,"decided_by":"human"}]'),
      ).toThrow('non-empty "answer"');
    });

    it('rejects an empty answer', () => {
      expect(() =>
        parseCreationDecisions('[{"question_id":"q","answer":"","decided_by":"human"}]'),
      ).toThrow('non-empty "answer"');
    });

    it('rejects a non-string decided_by', () => {
      expect(() =>
        parseCreationDecisions('[{"question_id":"q","answer":"a","decided_by":true}]'),
      ).toThrow('"decided_by" must be');
    });

    it('rejects an out-of-range decided_by', () => {
      expect(() =>
        parseCreationDecisions('[{"question_id":"q","answer":"a","decided_by":"robot"}]'),
      ).toThrow('"decided_by" must be');
    });

    it('rejects a non-string category', () => {
      expect(() =>
        parseCreationDecisions(
          '[{"question_id":"q","answer":"a","decided_by":"human","category":7}]',
        ),
      ).toThrow('unknown "category"');
    });

    it('rejects an unknown category', () => {
      expect(() =>
        parseCreationDecisions(
          '[{"question_id":"q","answer":"a","decided_by":"human","category":"nope"}]',
        ),
      ).toThrow('unknown "category"');
    });
  });
});
