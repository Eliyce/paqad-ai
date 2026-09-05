import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkPlainLanguage } from '@/spec-pipeline/plain-language.js';
import type { PipelineQuestion } from '@/spec-pipeline/types.js';

import { runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/requirement-enrichment';
const sh = (n: string) => join(SKILL, 'scripts', n);

/** A well-formed FR-4 two-layer question batch (the skill's output shape). */
const validBatch = JSON.stringify({
  questions: [
    {
      business_text:
        'Today, an export includes the archived invoices too. Keep including them, or leave them out?',
      why_it_matters: 'It changes what every downstream reader sees in the exported file.',
      options: [
        'Keep the archived invoices in the export',
        'Leave the archived invoices out of the export',
      ],
      grounded_in: 'docs/modules/exports/overview.md',
      technical_note: 'archived == status:archived rows in the export serializer',
    },
    {
      business_text: "When the export can't be delivered, what should happen?",
      why_it_matters: 'It decides whether a stuck export fails loudly or waits.',
      options: [
        'Keep trying quietly for an hour, then notify someone',
        'Fail straight away and tell the user',
      ],
      grounded_in: null,
    },
  ],
});

describe('requirement-enrichment', () => {
  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid FR-4 question batch', () => {
      const r = runScript(path, [], { input: validBatch });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/ok/);
    });

    it('fails when the top level is not an object with questions[]', () => {
      const noQuestions = runScript(path, [], { input: '{"foo":[]}' });
      expect(noQuestions.status).toBe(1);
      expect(noQuestions.stderr).toMatch(/questions\[\]/);

      const notObject = runScript(path, [], { input: '[]' });
      expect(notObject.status).toBe(1);
    });

    it('fails on invalid JSON', () => {
      const r = runScript(path, [], { input: '{not json' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/invalid JSON/);
    });

    it('fails when a question is missing a required field', () => {
      const noWhy = JSON.stringify({
        questions: [{ business_text: 'x', options: ['a', 'b'], grounded_in: null }],
      });
      const r = runScript(path, [], { input: noWhy });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/why_it_matters/);
    });

    it('fails when options has fewer than two entries or grounded_in is absent', () => {
      const oneOption = JSON.stringify({
        questions: [
          { business_text: 'x', why_it_matters: 'y', options: ['only one'], grounded_in: null },
        ],
      });
      expect(runScript(path, [], { input: oneOption }).stderr).toMatch(/options/);

      const noGrounded = JSON.stringify({
        questions: [{ business_text: 'x', why_it_matters: 'y', options: ['a', 'b'] }],
      });
      expect(runScript(path, [], { input: noGrounded }).stderr).toMatch(/grounded_in/);
    });

    it('exits 2 on missing input file', () => {
      expect(runScript(path, ['/no/such/file']).status).toBe(2);
    });
  });

  describe('emitted questions obey the plain-language contract', () => {
    // Realistic S0 grounding terms (glossary + module-doc headings) for the area.
    const terms = ['archived invoices', 'export', 'downstream reader', 'exported file'];
    const prompt =
      "let users export invoices and decide what happens when an export can't be delivered";

    it('a sample emitted question passes checkPlainLanguage against the grounding terms (AC-1/AC-4)', () => {
      const batch = JSON.parse(validBatch) as { questions: PipelineQuestion[] };
      for (const question of batch.questions) {
        const result = checkPlainLanguage(question, { terms, prompt });
        expect(result.ok, `flagged: ${result.flagged.join(', ')}`).toBe(true);
      }
      // AC-1: the documented term is used, not a from-the-model synonym.
      expect(batch.questions[0]!.business_text).toContain('archived invoices');
      expect(batch.questions[0]!.business_text).not.toMatch(/soft-deleted/i);
    });

    it('mechanism phrasing in options is caught by checkPlainLanguage (AC-2)', () => {
      const mechanism: PipelineQuestion = {
        business_text: "When the export can't be delivered, what should happen?",
        why_it_matters: 'It decides how a stuck export behaves.',
        options: ['Use exponential backoff', 'Fail straight away and tell the user'],
        grounded_in: null,
      };
      const result = checkPlainLanguage(mechanism, { terms, prompt });
      expect(result.ok).toBe(false);
      expect(result.flagged).toContain('exponential backoff');
    });
  });

  describe('assets', () => {
    it('operational-checklist.txt is non-empty unique vocabulary', async () => {
      const fs = await import('node:fs');
      const text = fs.readFileSync(join(SKILL, 'assets/operational-checklist.txt'), 'utf8');
      const tokens = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(/\s+/, 1)[0]);
      expect(tokens.length).toBeGreaterThan(5);
      expect(new Set(tokens).size).toBe(tokens.length);
    });
  });
});
