import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runSiteMapAudit = vi.fn();
const gatherSiteMapReport = vi.fn();
const runJourneyCuration = vi.fn();
const createSiteMapGatherer = vi.fn(() => ({}) as never);
const deriveCreationQuestions = vi.fn();
const recordCreationAnswers = vi.fn();
const readProgress = vi.fn();
const saveProgress = vi.fn();
const recoverInFlight = vi.fn();
const writeCanonicalSiteMap = vi.fn(() => 'docs/site-map/app-map.yaml');

// Mock the two fs-touching run entry points but keep the real pure inventory helpers
// (deriveSiteMapInventory / describeSiteMapInventory).
vi.mock('@/site-map/run.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/site-map/run.js')>()),
  runSiteMapAudit,
  gatherSiteMapReport,
}));
vi.mock('@/site-map/journey-curation.js', () => ({ runJourneyCuration }));
vi.mock('@/site-map/gatherer.js', () => ({ createSiteMapGatherer }));
// Mock the two fs-touching composers but keep the real parseCreationDecisions.
vi.mock('@/site-map/creation-flow.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/site-map/creation-flow.js')>()),
  deriveCreationQuestions,
  recordCreationAnswers,
}));
// Mock the fs-touching read/write of the progress store but keep the real, pure summarizeProgress:
// `status` must be proven to read only, never write.
vi.mock('@/site-map/progress-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/site-map/progress-store.js')>()),
  readProgress,
  saveProgress,
  recoverInFlight,
}));
// Mock only the fs-touching canonical writer; keep the real, pure buildSiteMapDraft so `draft`
// is proven to build a real skeleton off the gathered extraction.
vi.mock('@/site-map/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/site-map/store.js')>()),
  writeCanonicalSiteMap,
}));

const { createSitemapCommand } = await import('@/cli/commands/sitemap.js');
const { createProgram } = await import('@/cli/program.js');

async function invoke(args: string[]): Promise<string[]> {
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: string) => out.push(String(line)));
  await createSitemapCommand().parseAsync(args, { from: 'user' });
  return out;
}

describe('paqad-ai sitemap command', () => {
  beforeEach(() => {
    runSiteMapAudit.mockReset();
    gatherSiteMapReport.mockReset();
    runJourneyCuration.mockReset();
    createSiteMapGatherer.mockClear();
    deriveCreationQuestions.mockReset();
    recordCreationAnswers.mockReset();
    readProgress.mockReset();
    saveProgress.mockReset();
    recoverInFlight.mockReset();
    writeCanonicalSiteMap.mockClear();
    writeCanonicalSiteMap.mockReturnValue('docs/site-map/app-map.yaml');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('sitemap');
  });

  it('run: reports findings, prints blocked checks + baseline, and exits 1 (AC-8)', async () => {
    runSiteMapAudit.mockResolvedValue({
      report_id: 'SITEMAP-x',
      report_path: 'docs/site-map/x.md',
      sidecar_path: 'docs/site-map/x.json',
      bundle_dir: '.paqad/site-map/runs/x',
      finding_count: 2,
      blocked_checks: [
        { check: 'web-surfaces', reason: 'no extractor', install_hint: 'hand-author' },
      ],
      baseline_created: true,
      trust_restamp: { status: 'stamped', path: 'docs/site-map/app-map.yaml' },
      verdict: 'attention',
      exit_code: 1,
    });
    const out = await invoke(['run', '--project-root', '/tmp/app']);
    expect(process.exitCode).toBe(1);
    expect(createSiteMapGatherer).toHaveBeenCalledWith('/tmp/app');
    expect(out.join('\n')).toContain('worth a look');
    expect(out.join('\n')).toContain('Needs your attention');
    expect(out.join('\n')).toContain('web-surfaces skipped');
    expect(out.join('\n')).toContain(
      'Stamped earned trust and freshness into docs/site-map/app-map.yaml',
    );
    expect(out.join('\n')).toContain('Baseline recorded');
    expect(out.join('\n')).toContain('"verdict":"attention"');
    expect(out.join('\n')).toContain('"findings":2');
  });

  it('run: a matching map exits 0 and honours --quiet (AC-8)', async () => {
    runSiteMapAudit.mockResolvedValue({
      report_id: 'SITEMAP-y',
      report_path: 'docs/site-map/y.md',
      sidecar_path: 'docs/site-map/y.json',
      bundle_dir: '.paqad/site-map/runs/y',
      finding_count: 0,
      blocked_checks: [],
      baseline_created: false,
      trust_restamp: { status: 'no-map' },
      verdict: 'safe',
      exit_code: 0,
    });
    const out = await invoke(['run', '--quiet']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('the map matches the code');
    expect(out.join('\n')).toContain('Safe to merge');
    // no-map means nothing was stamped, so no stamped line is printed.
    expect(out.join('\n')).not.toContain('Stamped earned trust');
    expect(out.join('\n')).not.toContain('"findings"');
  });

  it('run: an absent or link-less map reads Inconclusive, not clean, and exits 0 (S2, D4)', async () => {
    runSiteMapAudit.mockResolvedValue({
      report_id: 'SITEMAP-z',
      bundle_dir: '.paqad/site-map/runs/z',
      finding_count: 0,
      blocked_checks: [
        {
          check: 'map-present',
          reason: 'no site map has been authored at docs/site-map/app-map.yaml yet',
          install_hint: 'Author the site map at docs/site-map/app-map.yaml',
        },
      ],
      baseline_created: true,
      trust_restamp: { status: 'no-map' },
      verdict: 'inconclusive',
      exit_code: 0,
    });
    const out = await invoke(['run']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('Inconclusive');
    expect(out.join('\n')).not.toContain('Safe to merge');
    expect(out.join('\n')).toContain('map-present skipped');
    expect(out.join('\n')).toContain('"verdict":"inconclusive"');
  });

  it('run: an unexpected error exits 2 (AC-8)', async () => {
    runSiteMapAudit.mockRejectedValue(new Error('boom'));
    const out = await invoke(['run']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('sitemap run failed: boom');
  });

  it('inventory is a registered subcommand (S4)', () => {
    const names = createSitemapCommand().commands.map((c) => c.name());
    expect(names).toContain('inventory');
  });

  it('inventory: gathers read-only, prints the sentence + JSON line, exits 0 (S4, AC-2/AC-3)', async () => {
    gatherSiteMapReport.mockResolvedValue({
      extraction: {
        surfaces: [
          { module: 'Billing', guards: ['web', 'auth'] },
          { module: 'Auth', guards: ['web'] },
        ],
      },
    });
    const out = await invoke(['inventory', '--project-root', '/tmp/app']);
    expect(process.exitCode).toBe(0);
    expect(createSiteMapGatherer).toHaveBeenCalledWith('/tmp/app');
    // `inventory` never persists — it must not drive the writing run.
    expect(runSiteMapAudit).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain('Found 2 screens across 2 groups.');
    expect(out.join('\n')).toContain('"screens":2');
    expect(out.join('\n')).toContain('"groups":["Auth","Billing"]');
    expect(out.join('\n')).toContain('"guards":2');
  });

  it('inventory: --quiet suppresses the JSON line', async () => {
    gatherSiteMapReport.mockResolvedValue({ extraction: { surfaces: [] } });
    const out = await invoke(['inventory', '--quiet']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('Found 0 screens across 0 groups.');
    expect(out.join('\n')).not.toContain('"screens"');
  });

  it('inventory: an unexpected error exits 2 (S4)', async () => {
    gatherSiteMapReport.mockRejectedValue(new Error('scan blew up'));
    const out = await invoke(['inventory']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('sitemap inventory failed: scan blew up');
  });

  it('draft is a registered subcommand (S8a)', () => {
    const names = createSitemapCommand().commands.map((c) => c.name());
    expect(names).toContain('draft');
  });

  it('draft: gathers, writes the skeleton, prints the count + path, exits 0 (S8a, AC-1)', async () => {
    gatherSiteMapReport.mockResolvedValue({
      extraction: {
        surfaces: [
          {
            raw_id: 'node-cli-a',
            kind: 'cli-command',
            label: 'A',
            evidence: [{ file: 'a.ts', line: 1 }],
          },
        ],
      },
      report: { app: { name: 'paqad-ai', kind: 'cli', frameworks: ['commander'] } },
    });
    const out = await invoke(['draft', '--project-root', '/tmp/app']);
    expect(process.exitCode).toBe(0);
    expect(createSiteMapGatherer).toHaveBeenCalledWith('/tmp/app');
    // The writer is driven with the projectRoot and a real skeleton built off the extraction.
    expect(writeCanonicalSiteMap).toHaveBeenCalledTimes(1);
    const [rootArg, mapArg] = writeCanonicalSiteMap.mock.calls[0] as [
      string,
      { surfaces: unknown[] },
    ];
    expect(rootArg).toBe('/tmp/app');
    expect(mapArg.surfaces).toHaveLength(1);
    expect(out.join('\n')).toContain('drafted 1 surface(s) into docs/site-map/app-map.yaml');
  });

  it('draft: a schema-invalid draft (writer throws) exits 2 (S8a, AC-4)', async () => {
    gatherSiteMapReport.mockResolvedValue({
      extraction: { surfaces: [] },
      report: { app: { name: 'paqad-ai', kind: 'cli', frameworks: [] } },
    });
    writeCanonicalSiteMap.mockImplementation(() => {
      throw new Error('canonical app-map failed schema validation');
    });
    const out = await invoke(['draft']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain(
      'sitemap draft failed: canonical app-map failed schema validation',
    );
  });

  it('draft: an unexpected gather error exits 2 (S8a)', async () => {
    gatherSiteMapReport.mockRejectedValue(new Error('scan blew up'));
    const out = await invoke(['draft']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('sitemap draft failed: scan blew up');
    expect(writeCanonicalSiteMap).not.toHaveBeenCalled();
  });

  it('status is a registered subcommand (S5b)', () => {
    const names = createSitemapCommand().commands.map((c) => c.name());
    expect(names).toContain('status');
  });

  it('status: a populated file prints the counts, the next unit, JSON, and exits 0 (S5b, AC-1)', async () => {
    readProgress.mockResolvedValue({
      units: {
        'group:a': { id: 'group:a', label: 'Billing', state: 'done' },
        'group:b': { id: 'group:b', label: 'Auth', state: 'writing' },
        'group:c': { id: 'group:c', label: 'Checkout', state: 'not_started' },
      },
    });
    const out = await invoke(['status', '--project-root', '/tmp/app']);
    expect(process.exitCode).toBe(0);
    expect(readProgress).toHaveBeenCalledWith('/tmp/app');
    expect(out.join('\n')).toContain('1 of 3 done, 1 writing, 0 failed, 1 to go');
    expect(out.join('\n')).toContain('Next up: group:c (Checkout).');
    expect(out.join('\n')).toContain('"status":"ready"');
    expect(out.join('\n')).toContain('"remaining":1');
    expect(out.join('\n')).toContain('"next":{"id":"group:c","label":"Checkout"}');
    // A readout never writes, and never runs crash recovery (AC-4).
    expect(saveProgress).not.toHaveBeenCalled();
    expect(recoverInFlight).not.toHaveBeenCalled();
  });

  it('status: no progress file says it would start from the beginning, JSON none, exits 0 (S5b, AC-2)', async () => {
    readProgress.mockResolvedValue(null);
    const out = await invoke(['status']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('no progress recorded yet');
    expect(out.join('\n')).toContain('start from the beginning');
    expect(out.join('\n')).toContain('"status":"none"');
    expect(saveProgress).not.toHaveBeenCalled();
    expect(recoverInFlight).not.toHaveBeenCalled();
  });

  it('status: a writing unit is reported as writing and is NOT reset by status (S5b, AC-3/AC-4)', async () => {
    readProgress.mockResolvedValue({
      units: {
        'journey:checkout': { id: 'journey:checkout', label: 'Checkout, guest', state: 'writing' },
      },
    });
    const out = await invoke(['status']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('0 of 1 done, 1 writing, 0 failed, 0 to go');
    // No not_started unit remains, so there is nothing to do next.
    expect(out.join('\n')).toContain('Nothing left to do.');
    expect(out.join('\n')).toContain('"writing":1');
    expect(out.join('\n')).toContain('"next":null');
    expect(saveProgress).not.toHaveBeenCalled();
    expect(recoverInFlight).not.toHaveBeenCalled();
  });

  it('retest is retired: the subcommand no longer exists (ART-3)', async () => {
    const names = createSitemapCommand().commands.map((c) => c.name());
    expect(names).not.toContain('retest');
    expect(names).toEqual(expect.arrayContaining(['run', 'journey']));
  });

  it('journey confirm: reports success and exits 0', async () => {
    runJourneyCuration.mockReturnValue({
      ok: true,
      id: 'checkout',
      action: 'confirm',
      status: 'confirmed',
    });
    const out = await invoke(['journey', 'confirm', 'checkout', '--project-root', '/tmp/app']);
    expect(process.exitCode).toBe(0);
    expect(runJourneyCuration).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/tmp/app', id: 'checkout', action: 'confirm' }),
    );
    expect(out.join('\n')).toContain('confirmed');
  });

  it('journey reject: reports removal and exits 0', async () => {
    runJourneyCuration.mockReturnValue({
      ok: true,
      id: 'abandoned',
      action: 'reject',
      status: 'removed',
    });
    const out = await invoke(['journey', 'reject', 'abandoned']);
    expect(process.exitCode).toBe(0);
    expect(out.join('\n')).toContain('rejected');
  });

  it('journey confirm: a refused transition exits 1', async () => {
    runJourneyCuration.mockReturnValue({
      ok: false,
      reason: 'journey "x" is locked, not proposed',
    });
    const out = await invoke(['journey', 'confirm', 'x']);
    expect(process.exitCode).toBe(1);
    expect(out.join('\n')).toContain('not proposed');
  });

  it('journey confirm: an unexpected error exits 2', async () => {
    runJourneyCuration.mockImplementation(() => {
      throw new Error('splat');
    });
    const out = await invoke(['journey', 'confirm', 'x']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('journey confirm failed: splat');
  });

  it('questions + answer are registered subcommands (C6a)', () => {
    const names = createSitemapCommand().commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['questions', 'answer']));
  });

  it('questions: no authored map prints the empty JSON payload', async () => {
    deriveCreationQuestions.mockReturnValue({ status: 'no-map' });
    const out = await invoke(['questions', '--project-root', '/tmp/app']);
    expect(deriveCreationQuestions).toHaveBeenCalledWith('/tmp/app');
    expect(out.join('\n')).toContain('nothing to ask');
    expect(out.join('\n')).toContain('"status":"no-map"');
  });

  it('questions: lists the open questions as a machine-readable payload', async () => {
    deriveCreationQuestions.mockReturnValue({
      status: 'ready',
      reconciliation: {
        to_ask: [
          {
            question_id: 'grouping:ungrouped-surfaces',
            category: 'grouping',
            question: 'How should they be grouped?',
            anchors: ['src/cli/index.ts:1'],
            recommended_default: { answer: 'group-by-module', reason: 'by module' },
          },
        ],
        reused: [],
        reopened: [],
      },
    });
    const out = await invoke(['questions']);
    expect(out.join('\n')).toContain('1 question(s) need your call');
    expect(out.join('\n')).toContain('"question_id":"grouping:ungrouped-surfaces"');
    expect(out.join('\n')).toContain('"reused_count":0');
  });

  it('questions: a fully-decided map says nothing is left to ask', async () => {
    deriveCreationQuestions.mockReturnValue({
      status: 'ready',
      reconciliation: { to_ask: [], reused: [], reopened: [] },
    });
    const out = await invoke(['questions']);
    expect(out.join('\n')).toContain('fully decided');
    expect(out.join('\n')).toContain('"status":"ready"');
  });

  it('questions: an unexpected error exits 2', async () => {
    deriveCreationQuestions.mockImplementation(() => {
      throw new Error('kaboom');
    });
    const out = await invoke(['questions']);
    expect(process.exitCode).toBe(2);
    expect(out.join('\n')).toContain('sitemap questions failed: kaboom');
  });

  describe('answer', () => {
    let dir: string;
    let inputFile: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'paqad-sitemap-cli-'));
      inputFile = join(dir, 'decisions.json');
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('records the decisions, printing skipped ids and the stamp line', async () => {
      writeFileSync(
        inputFile,
        JSON.stringify([
          {
            question_id: 'grouping:ungrouped-surfaces',
            answer: 'group-by-module',
            decided_by: 'human',
          },
        ]),
      );
      recordCreationAnswers.mockReturnValue({
        status: 'recorded',
        recorded: 1,
        unknown: ['labels-language:gone'],
        answers_path: '/tmp/app/docs/site-map/answers.yaml',
        stamped: true,
        map_path: '/tmp/app/docs/site-map/app-map.yaml',
      });
      const out = await invoke(['answer', '--input', inputFile, '--project-root', '/tmp/app']);
      expect(process.exitCode).toBe(0);
      expect(recordCreationAnswers).toHaveBeenCalledWith('/tmp/app', [
        {
          question_id: 'grouping:ungrouped-surfaces',
          answer: 'group-by-module',
          decided_by: 'human',
        },
      ]);
      expect(out.join('\n')).toContain('recorded 1 answer(s)');
      expect(out.join('\n')).toContain('Skipped 1 answer(s)');
      expect(out.join('\n')).toContain('Stamped who-decided provenance onto');
    });

    it('a no-map result exits 1', async () => {
      writeFileSync(
        inputFile,
        JSON.stringify([{ question_id: 'q', answer: 'a', decided_by: 'human' }]),
      );
      recordCreationAnswers.mockReturnValue({ status: 'no-map' });
      const out = await invoke(['answer', '--input', inputFile]);
      expect(process.exitCode).toBe(1);
      expect(out.join('\n')).toContain('no authored map to record answers against');
    });

    it('a clean record prints neither the skip nor the stamp line', async () => {
      writeFileSync(
        inputFile,
        JSON.stringify([{ question_id: 'q', answer: 'a', decided_by: 'human' }]),
      );
      recordCreationAnswers.mockReturnValue({
        status: 'recorded',
        recorded: 1,
        unknown: [],
        answers_path: '/tmp/app/docs/site-map/answers.yaml',
        stamped: false,
        map_path: null,
      });
      const out = await invoke(['answer', '--input', inputFile]);
      expect(process.exitCode).toBe(0);
      expect(out.join('\n')).not.toContain('Skipped');
      expect(out.join('\n')).not.toContain('Stamped who-decided');
    });

    it('a malformed input file exits 2 via the real parser', async () => {
      writeFileSync(inputFile, 'not json');
      const out = await invoke(['answer', '--input', inputFile]);
      expect(process.exitCode).toBe(2);
      expect(out.join('\n')).toContain('sitemap answer failed: decisions input is not valid JSON');
      expect(recordCreationAnswers).not.toHaveBeenCalled();
    });
  });
});
