import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import * as deltaDetector from '@/pipeline/delta-detector.js';
import * as ruleTriggerMatcher from '@/pipeline/rule-trigger-matcher.js';
import * as scopeResolver from '@/pipeline/scope-resolver.js';
import { ModuleResolver } from '@/pipeline/module-resolver.js';
import { resolvePromptRoute } from '@/pipeline/prompt-lane.js';
import {
  PreClassifier,
  isQuestionRoute,
  hasCodeNegation,
  isCreateArtifactAsk,
  isAboutWorkPrompt,
} from '@/pipeline/pre-classifier.js';

describe('PreClassifier', () => {
  it('resolves deterministic workflow, modules, and context metadata', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [{ path: 'src/api/users', source: 'explicit-path', confidence: 1 }],
      source: 'explicit-path',
    });

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'Implement api users feature',
      profile: {
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
    });

    expect(result.resolved.workflow).toBe('feature-development');
    expect(result.resolved.affected_modules).toEqual(['src/api/users']);
    expect(result.resolved.context_budget_hint).toBe('minimal');
    expect(result.resolution_map.workflow).toBe('deterministic');
  });

  it('tracks unresolved workflow when no pattern matches', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'do the thing',
    });

    expect(result.unresolved).toContain('workflow');
  });

  it('falls back on timeout', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockImplementation(
      () => new Promise(() => undefined),
    );

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'implement feature',
    });

    expect(result.evidence).toContain('timeout');
    expect(result.unresolved).toContain('affected_modules');
  });

  it('marks scope as unresolved and uses default when resolveScope rejects', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [{ path: 'src/api/users', source: 'explicit-path', confidence: 1 }],
      source: 'explicit-path',
    });
    vi.spyOn(scopeResolver, 'resolveScope').mockRejectedValue(new Error('scope failure'));

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'implement feature',
    });

    expect(result.unresolved).toContain('scope');
    expect(result.resolved.scope).toBe('single-module');
    expect(result.resolution_map.scope).toBe('default');
  });

  it('marks delta_candidate as unresolved when detectDeltaCandidate rejects', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [{ path: 'src/api/users', source: 'explicit-path', confidence: 1 }],
      source: 'explicit-path',
    });
    vi.spyOn(deltaDetector, 'detectDeltaCandidate').mockRejectedValue(new Error('delta failure'));

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'implement feature',
    });

    expect(result.unresolved).toContain('delta_candidate');
    expect(result.resolved.delta_candidate).toBe(false);
  });

  it('marks matched_rule_triggers as unresolved when matchRuleTriggers rejects', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [{ path: 'src/api/users', source: 'explicit-path', confidence: 1 }],
      source: 'explicit-path',
    });
    vi.spyOn(ruleTriggerMatcher, 'matchRuleTriggers').mockRejectedValue(
      new Error('rule trigger failure'),
    );

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'implement feature',
    });

    expect(result.unresolved).toContain('matched_rule_triggers');
    expect(result.resolved.matched_rule_triggers).toEqual([]);
  });

  it('routes module-documentation prompts to module-documentation, not documentation-update', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const variants = [
      'generate module docs',
      'create module documentation',
      'generate module documentation',
      'create per module docs',
    ];

    for (const request of variants) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" should resolve to module-documentation`).toBe(
        'module-documentation',
      );
    }
  });

  it('still routes plain documentation prompts to documentation-update', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const result = await new PreClassifier(process.cwd()).classify({
      request: 'create documentation for this project',
    });

    expect(result.resolved.workflow).toBe('documentation-update');
  });

  // Issue #576 (Finding 5) — interrogative questions about the codebase resolve to
  // project-question; greetings stay unresolved (→ no-workflow); imperative code requests keep
  // their code workflow.
  it('routes interrogative codebase questions to project-question (#576 AC-8)', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const questions = [
      'How This project is setup technically?',
      'How I can run this project locally?',
      'How is an order sent to the backend, I want an example request and response',
      'Where is the cart validated?',
    ];
    for (const request of questions) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" → project-question`).toBe('project-question');
    }

    // Greetings/thanks carry no interrogative lead → unresolved (→ no-workflow downstream).
    for (const greeting of ['hi', 'thanks']) {
      const result = await new PreClassifier(process.cwd()).classify({ request: greeting });
      expect(result.unresolved, `"${greeting}" stays unresolved`).toContain('workflow');
    }

    // An imperative code request still wins its workflow (not stolen by the question fallback).
    const fix = await new PreClassifier(process.cwd()).classify({
      request: 'Fix the typo in the order mapper',
    });
    expect(fix.resolved.workflow).toBe('bug-fix');
  });

  it('routes health prompts to codebase-health while pentest phrasings stay pentest (#355 AC-6)', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const healthPrompts = [
      "can you check my project's health?",
      'run a codebase health audit',
      'find dead code in this repo',
    ];
    for (const request of healthPrompts) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" → codebase-health`).toBe('codebase-health');
    }

    const retest = await new PreClassifier(process.cwd()).classify({
      request: 'run a health retest',
    });
    expect(retest.resolved.workflow).toBe('health-retest');

    const pentest = await new PreClassifier(process.cwd()).classify({
      request: 'run a pentest of the app',
    });
    expect(pentest.resolved.workflow).toBe('pentest');
  });

  it('routes map-authoring prompts to site-map and its retest above the base (S9)', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

    const sitePrompts = ['create a site map for the app', 'generate sitemap', 'draw a journey map'];
    for (const request of sitePrompts) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" → site-map`).toBe('site-map');
    }

    const retest = await new PreClassifier(process.cwd()).classify({
      request: 'retest the site map',
    });
    expect(retest.resolved.workflow).toBe('site-map-retest');
  });
});

// Issue #580 — questions beat substring keywords; whole-word code-change matching.
describe('PreClassifier · prompt router (#580)', () => {
  const mockNoModules = () =>
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });

  it('routes the 8 reproduction prompts to project-question (AC-1)', async () => {
    mockNoModules();
    const prompts = [
      'What does the address field store?',
      'Can you explain the debug output?',
      'Why does the prefix get dropped?',
      'Where is the rebuild step?',
      'Was the fix on our side or theirs?',
      'Explain why this bug happened, no code changes please',
      'Do not code, just tell me how the cleanup job works',
      'Create a GitHub issue for this bug.',
    ];
    for (const request of prompts) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" → project-question`).toBe('project-question');
    }
  });

  it('keeps genuine code requests on feature-development / bug-fix / cleanup (AC-2)', async () => {
    mockNoModules();
    const expected: Array<[string, string]> = [
      ['fix the typo in the header', 'bug-fix'],
      ['add a logout button', 'feature-development'],
      ['implement the export endpoint', 'feature-development'],
      ['clean up the unused imports in the billing module', 'cleanup'],
      ['build the settings page', 'feature-development'],
      ['Can you add a logout button?', 'feature-development'],
      ['Could you fix the failing test?', 'bug-fix'],
    ];
    for (const [request, workflow] of expected) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" → ${workflow}`).toBe(workflow);
    }
  });

  it('matches code keywords on whole words, not substrings (AC-8)', async () => {
    mockNoModules();
    // These embed a keyword inside another word — they must NOT resolve to a code workflow.
    const notCode = [
      'the address field',
      'the debug output',
      'the prefix value',
      'the rebuild step',
    ];
    for (const request of notCode) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.unresolved, `"${request}" is not a code change`).toContain('workflow');
    }
    // A real inflection SHOULD match.
    const added = await new PreClassifier(process.cwd()).classify({
      request: 'added a new column to the orders table',
    });
    expect(added.resolved.workflow).toBe('feature-development');
  });
});

describe('isQuestionRoute / hasCodeNegation / isCreateArtifactAsk (#580 helpers)', () => {
  it('detects questions but not polite code requests', () => {
    expect(isQuestionRoute('Why does the prefix get dropped?')).toBe(true);
    expect(isQuestionRoute('Where is the rebuild step?')).toBe(true);
    expect(isQuestionRoute('Was the fix on our side or theirs?')).toBe(true);
    expect(isQuestionRoute('explain how the cart works')).toBe(true);
    // Polite code requests are NOT questions.
    expect(isQuestionRoute('Can you add a logout button?')).toBe(false);
    expect(isQuestionRoute('Could you fix the failing test?')).toBe(false);
    // Imperatives and greetings are not questions.
    expect(isQuestionRoute('do the thing')).toBe(false);
    expect(isQuestionRoute('add a logout button')).toBe(false);
    expect(isQuestionRoute('hi')).toBe(false);
  });

  it('detects explicit do-not-code negations', () => {
    expect(hasCodeNegation('explain why this bug happened, no code changes please')).toBe(true);
    expect(hasCodeNegation('do not code, just tell me how it works')).toBe(true);
    expect(hasCodeNegation('tell me without changing anything')).toBe(true);
    expect(hasCodeNegation('fix the bug')).toBe(false);
  });

  it('detects file-an-issue asks unless they also implement', () => {
    expect(isCreateArtifactAsk('create a github issue for this bug')).toBe(true);
    expect(isCreateArtifactAsk('open a ticket for the flaky test')).toBe(true);
    expect(isCreateArtifactAsk('write up the postmortem')).toBe(true);
    expect(isCreateArtifactAsk('file an issue and implement the fix')).toBe(false);
    expect(isCreateArtifactAsk('add a logout button')).toBe(false);
  });
});

// Issue #623 — prompts that talk about the work (issues, drafts, reports) are not code changes.
const ABOUT_WORK_FIXTURES: Array<[string, string]> = [
  ['Post it to GitHub as drafted, label bug.', 'project-question'],
  ["Add the RAG points to the rewrite file only. Don't change GitHub yet.", 'project-question'],
  ['So user need to add the plugin, by hand?', 'project-question'],
  ['For automatic user migration, can you add another issue and link', 'project-question'],
  ['Please file remaining, you can recheck and reconfirm', 'project-question'],
  // Controls: real code changes stay feature-development.
  ['fix the null check in src/api/users.ts', 'feature-development'],
  ['add a dark mode toggle to the settings page', 'feature-development'],
];

describe('PreClassifier · talking about work (#623)', () => {
  it.each(ABOUT_WORK_FIXTURES)(
    'routes "%s" through the prompt route to %s (AC-9)',
    async (request, routed) => {
      vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
        modules: [],
        source: 'default',
      });
      const root = mkdtempSync(join(tmpdir(), 'paqad-about-work-'));
      try {
        const result = await resolvePromptRoute(root, request);
        expect(result.routed).toBe(routed);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('resolves the issue fixtures in the pre-classifier itself', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });
    const expected: Array<[string, string]> = [
      ['Post it to GitHub as drafted, label bug.', 'project-question'],
      ["Add the RAG points to the rewrite file only. Don't change GitHub yet.", 'project-question'],
      ['For automatic user migration, can you add another issue and link', 'project-question'],
      ['Please file remaining, you can recheck and reconfirm', 'project-question'],
      ['fix the null check in src/api/users.ts', 'bug-fix'],
      ['add a dark mode toggle to the settings page', 'feature-development'],
    ];
    for (const [request, workflow] of expected) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.resolved.workflow, `"${request}" → ${workflow}`).toBe(workflow);
    }
  });

  it('needs a work noun, a work verb and no source path', () => {
    expect(isAboutWorkPrompt('Post it to GitHub as drafted, label bug.')).toBe(true);
    expect(isAboutWorkPrompt('update the pull request description')).toBe(true);
    expect(isAboutWorkPrompt('add the findings to the report')).toBe(true);
    // No work verb.
    expect(isAboutWorkPrompt('the issue is still open')).toBe(false);
    // No work noun.
    expect(isAboutWorkPrompt('add a dark mode toggle to the settings page')).toBe(false);
    // A source path or a source file keeps it a code change.
    expect(isAboutWorkPrompt('update the issue for src/api/users.ts')).toBe(false);
    expect(isAboutWorkPrompt('link the issue to lib/cart')).toBe(false);
    expect(isAboutWorkPrompt('update the plan in checkout.py')).toBe(false);
    // A strong code verb keeps it a code change.
    expect(isAboutWorkPrompt('fix the typo in the report and update the PR')).toBe(false);
    expect(isAboutWorkPrompt('')).toBe(false);
  });

  it('leaves a work-verb prompt that names code to the code tiers', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });
    // A work verb alone does not claim a prompt that names a source file or a code verb.
    for (const request of ['check src/cart.ts', 'refactor and recheck the cart']) {
      const result = await new PreClassifier(process.cwd()).classify({ request });
      expect(result.unresolved, `"${request}" is left unresolved`).toContain('workflow');
    }
  });

  // Real code requests that mention a work noun must never be claimed as work talk.
  it.each([
    'add a CSV export to the orders report',
    'update the report page header',
    'add a link to the docs page in the footer',
    'check the plan selector renders on mobile',
  ])('does not route the code request "%s" to project-question', async (request) => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });
    expect(isAboutWorkPrompt(request)).toBe(false);
    const result = await new PreClassifier(process.cwd()).classify({ request });
    expect(result.resolved.workflow).not.toBe('project-question');
  });

  it('keeps "add a CSV export to the orders report" on feature-development', async () => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });
    const root = mkdtempSync(join(tmpdir(), 'paqad-about-work-'));
    try {
      const result = await resolvePromptRoute(root, 'add a CSV export to the orders report');
      expect(result.routed).toBe('feature-development');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    'add the findings to this report',
    'add these notes to the draft',
    'add the open questions to our pull request',
    'post the summary and link the ticket',
    'please recheck and confirm the plan',
  ])('keeps the work talk "%s" on project-question', async (request) => {
    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });
    const result = await new PreClassifier(process.cwd()).classify({ request });
    expect(result.resolved.workflow).toBe('project-question');
  });

  it('counts "add ... to" only when a work noun follows "to"', () => {
    expect(isAboutWorkPrompt('add the RAG points to the rewrite file')).toBe(true);
    // A work noun elsewhere, but "to" leads to something else and there is no other work verb.
    expect(isAboutWorkPrompt('add the report totals to the orders summary')).toBe(false);
    // "label bug" names an issue label, so "bug" is not read as a code surface there.
    expect(isAboutWorkPrompt('post the issue, label bug')).toBe(true);
    expect(isAboutWorkPrompt('post the issue about the login bug')).toBe(false);
  });
});
