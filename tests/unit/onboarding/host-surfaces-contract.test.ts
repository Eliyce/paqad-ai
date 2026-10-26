import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildAgentBootstrapDocument,
  buildAgentRouterDocument,
} from '@/onboarding/agent-bootstrap-writer.js';
import {
  DECISION_PREVIEW_SENTENCE,
  buildDecisionPauseContractBody,
} from '@/onboarding/decision-pause-contract-writer.js';
import {
  HOST_SURFACES_PARAGRAPH,
  buildNarrationContractBody,
} from '@/onboarding/narration-contract-writer.js';
import { TemplateEngine } from '@/templates';

const COMMITTED_ROUTER = resolve(process.cwd(), 'runtime/AGENT-ROUTER.md');
const ENTRY_TEMPLATES_DIR = resolve(process.cwd(), 'runtime/templates/agent-configs');

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function readRouter(): string {
  return readFileSync(COMMITTED_ROUTER, 'utf8');
}

describe('host surfaces and decision preview in the router', () => {
  it('router carries the host-surfaces paragraph after Where narration has to go (AC-1)', () => {
    const router = readRouter();
    const whereStart = router.indexOf('**Where narration has to go.**');
    expect(whereStart).toBeGreaterThan(-1);
    const whereEnd = router.indexOf('\n\n', whereStart);
    expect(whereEnd).toBeGreaterThan(whereStart);

    const next = router.slice(whereEnd + 2);
    expect(
      next.startsWith(`${HOST_SURFACES_PARAGRAPH}\n\n**Which channels actually render.**`),
    ).toBe(true);

    const stageList = '(Plan, Spec, Load rules, Build, Review, Checks, Docs)';
    const fastLane =
      'On the fast lane there are no isolated stages, so the task list shows Plan, Build, Checks only.';
    expect(HOST_SURFACES_PARAGRAPH.indexOf(fastLane)).toBeGreaterThan(
      HOST_SURFACES_PARAGRAPH.indexOf(stageList),
    );
    expect(HOST_SURFACES_PARAGRAPH).toContain(
      'Start the end-of-turn summary with the verdict word (Safe to merge, Needs your attention, or Inconclusive).',
    );
    expect(HOST_SURFACES_PARAGRAPH).toContain(
      'While a stage still runs in the background, the summary names the running stage and says nothing is needed from the developer',
    );
    expect(router).toContain(
      'The turn that ends right after a dispatch speaks no verdict word: say which stage is running and that nothing is needed from the developer.',
    );
  });

  it('decision pause step 2 carries the preview sentence (AC-2)', () => {
    const router = readRouter();
    const step2 = router
      .split('\n')
      .find((line) => line.startsWith("2. Present the packet's options to the user"));
    expect(step2).toBeDefined();
    expect(step2!.endsWith(` ${DECISION_PREVIEW_SENTENCE}`)).toBe(true);
    const step3Index = router.indexOf('\n3. When the user answers');
    expect(router.indexOf(step2!)).toBeLessThan(step3Index);
  });

  it('each canonical paragraph appears exactly once and byte-equal in the router (AC-3)', () => {
    const committed = readRouter();
    const built = buildAgentRouterDocument();

    for (const doc of [committed, built]) {
      expect(countOccurrences(doc, HOST_SURFACES_PARAGRAPH)).toBe(1);
      expect(countOccurrences(doc, DECISION_PREVIEW_SENTENCE)).toBe(1);
      expect(countOccurrences(doc, '**Host surfaces (when your host offers them).**')).toBe(1);
      expect(
        countOccurrences(doc, "When the host's question tool supports a preview for each option"),
      ).toBe(1);
    }

    expect(countOccurrences(buildNarrationContractBody(), HOST_SURFACES_PARAGRAPH)).toBe(1);
    expect(countOccurrences(buildDecisionPauseContractBody(), DECISION_PREVIEW_SENTENCE)).toBe(1);
  });

  it('entry files stay lean and unchanged (AC-4)', async () => {
    const engine = new TemplateEngine();
    const templates = readdirSync(ENTRY_TEMPLATES_DIR).filter((file) => file.endsWith('.md.hbs'));
    expect(templates.length).toBeGreaterThan(0);

    for (const file of templates) {
      const raw = readFileSync(join(ENTRY_TEMPLATES_DIR, file), 'utf8');
      const output = await engine.render(join(ENTRY_TEMPLATES_DIR, file), {
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/rules',
        adapter: 'claude-code',
      });

      for (const text of [raw, output]) {
        expect(text).not.toContain(HOST_SURFACES_PARAGRAPH);
        expect(text).not.toContain(DECISION_PREVIEW_SENTENCE);
        expect(text).not.toContain('Host surfaces');
      }
      expect(output).toContain('AGENT-BOOTSTRAP.md');
      expect(output).not.toContain('AGENT-ROUTER.md');
    }

    const bootstrap = buildAgentBootstrapDocument();
    expect(bootstrap).not.toContain(HOST_SURFACES_PARAGRAPH);
    expect(bootstrap).not.toContain(DECISION_PREVIEW_SENTENCE);
  });
});
