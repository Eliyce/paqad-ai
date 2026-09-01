import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const reconcileDoneUnits = vi.fn();
const writeCanonicalSiteMap = vi.fn(() => 'docs/site-map/app-map.yaml');
const readCanonicalSiteMap = vi.fn();
const hashSourceFiles = vi.fn();

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
// Mock the fs-touching read/write/recover/reconcile of the progress store but keep the real,
// pure pieces (summarizeProgress and the unit creators/mutators): `status` must be proven to
// read only, and `draft` must be proven to advance real unit state.
vi.mock('@/site-map/progress-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/site-map/progress-store.js')>()),
  readProgress,
  saveProgress,
  recoverInFlight,
  reconcileDoneUnits,
}));
// Mock only the fs-touching canonical reader/writer; keep the real, pure buildSiteMapDraft,
// deriveDraftUnits and mergeSiteMapDraft so `draft` is proven to build and merge a real
// skeleton off the gathered extraction. `canonicalAppMapPath` stays real (a pure join).
vi.mock('@/site-map/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/site-map/store.js')>()),
  writeCanonicalSiteMap,
  readCanonicalSiteMap,
}));
// The staleness hash is fs-touching; `draft` stamps it on every completed unit.
vi.mock('@/document/staleness.js', () => ({ hashSourceFiles }));

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
    reconcileDoneUnits.mockReset();
    readCanonicalSiteMap.mockReset();
    hashSourceFiles.mockReset();
    writeCanonicalSiteMap.mockClear();
    writeCanonicalSiteMap.mockReturnValue('docs/site-map/app-map.yaml');
    // Draft-flow defaults: no stored map, no progress yet, nothing recovered or skipped.
    readCanonicalSiteMap.mockReturnValue(null);
    readProgress.mockResolvedValue(null);
    saveProgress.mockResolvedValue(undefined);
    recoverInFlight.mockResolvedValue([]);
    reconcileDoneUnits.mockResolvedValue({ skipped: [], reset: [] });
    hashSourceFiles.mockResolvedValue('sha1:abc1234');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('sitemap');
  });

  describe('S8c: the command is discoverable and every verb reads plainly', () => {
    const VERBS = ['run', 'draft', 'inventory', 'status', 'questions', 'answer', 'journey'];

    it('is no longer hidden, so it shows in the program help (S8c, AC-1)', () => {
      // A hidden command is registered but omitted from help output; unhiding it in S8c
      // means the top-level help now lists `sitemap` for a human to discover.
      expect(createProgram().helpInformation()).toContain('sitemap');
    });

    it('sitemap --help lists every verb (S8c, AC-2)', () => {
      const help = createSitemapCommand().helpInformation();
      for (const verb of VERBS) {
        expect(help).toContain(verb);
      }
    });

    it('every verb description is one plain sentence with no jargon (S8c, AC-3)', () => {
      const byName = new Map(
        createSitemapCommand().commands.map((c) => [c.name(), c.description()]),
      );
      // Tokens deliberately reworded away in S8c, plus the em dash a plain sentence avoids.
      const jargon = [
        '—',
        'closed-list',
        'provenance',
        'one-step creation',
        'skeleton from the extracted',
      ];
      for (const verb of VERBS) {
        const description = byName.get(verb);
        expect(description, `verb "${verb}" is missing`).toBeTruthy();
        const text = description as string;
        // No jargon token and no em dash.
        for (const token of jargon) {
          expect(text, `verb "${verb}" description still contains "${token}"`).not.toContain(token);
        }
        // One sentence: no mid-string sentence break (a period followed by more words).
        expect(text, `verb "${verb}" description is more than one sentence`).not.toMatch(/\.\s+\S/);
      }
    });
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

  describe('draft (S8a + S8b)', () => {
    let root: string;

    beforeEach(() => {
      // A real empty tmp root so the never-clobber existence probe is exercised for real
      // (no app-map.yaml on disk unless a test writes one).
      root = mkdtempSync(join(tmpdir(), 'paqad-sitemap-draft-cli-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    function surface(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        raw_id: 'node-cli-a',
        kind: 'cli-command',
        label: 'A',
        evidence: [{ file: 'a.ts', line: 1 }],
        ...overrides,
      };
    }

    function gathered(surfaces: Array<Record<string, unknown>>): void {
      gatherSiteMapReport.mockResolvedValue({
        extraction: { surfaces },
        report: { app: { name: 'paqad-ai', kind: 'cli', frameworks: ['commander'] } },
      });
    }

    interface SavedProgress {
      inventory: { screens: number; groups: string[] };
      units: Record<
        string,
        { state: string; source_files: string[]; source_hash: string | null; label: string }
      >;
    }

    /** The progress object handed to every saveProgress call (mutated in place by draft). */
    function savedProgress(): SavedProgress {
      expect(saveProgress).toHaveBeenCalled();
      return saveProgress.mock.calls.at(-1)![1] as SavedProgress;
    }

    it('draft: first run seeds the store from the inventory and ends every unit done (S8b, AC-3)', async () => {
      gathered([
        surface(),
        surface({
          raw_id: 'node-cli-b',
          label: 'B',
          module: 'Billing',
          evidence: [{ file: 'b.ts', line: 2 }],
        }),
      ]);
      const out = await invoke(['draft', '--project-root', root]);
      expect(process.exitCode).toBe(0);
      expect(createSiteMapGatherer).toHaveBeenCalledWith(root);
      expect(recoverInFlight).toHaveBeenCalled();
      expect(reconcileDoneUnits).toHaveBeenCalled();
      const progress = savedProgress();
      expect(progress.inventory).toEqual({ screens: 2, groups: ['Billing'] });
      expect(Object.keys(progress.units).sort()).toEqual(['group:billing', 'group:ungrouped']);
      for (const unit of Object.values(progress.units)) {
        expect(unit.state).toBe('done');
        expect(unit.source_hash).toBe('sha1:abc1234');
      }
      expect(progress.units['group:billing'].source_files).toEqual(['b.ts']);
      expect(progress.units['group:ungrouped'].source_files).toEqual(['a.ts']);
      // One canonical write per unit, each a merge of the accumulated map.
      expect(writeCanonicalSiteMap).toHaveBeenCalledTimes(2);
      const [, finalMap] = writeCanonicalSiteMap.mock.calls.at(-1)! as [
        string,
        { surfaces: Array<{ id: string }> },
      ];
      expect(finalMap.surfaces.map((s) => s.id).sort()).toEqual(['node-cli-a', 'node-cli-b']);
      expect(out.join('\n')).toContain(
        'drafted 2 new surface(s) into docs/site-map/app-map.yaml (kept 0 existing, skipped 0 unchanged group(s))',
      );
    });

    it('draft: re-running merges — authored entries and vanished surfaces survive, only missing entries are added (S8b, AC-1/AC-2)', async () => {
      const authored = {
        id: 'node-cli-a',
        kind: 'cli-command',
        label: 'Curated label',
        note: 'hand-written note',
        evidence: [{ file: 'a.ts', line: 1 }],
      };
      const vanished = { id: 'node-cli-legacy', kind: 'cli-command', label: 'Legacy' };
      readCanonicalSiteMap.mockReturnValue({
        schema_version: 1,
        app: { name: 'paqad-ai', kind: 'cli' },
        surfaces: [authored, vanished],
      });
      gathered([surface(), surface({ raw_id: 'node-cli-new', label: 'New' })]);
      const out = await invoke(['draft', '--project-root', root]);
      expect(process.exitCode).toBe(0);
      const [, finalMap] = writeCanonicalSiteMap.mock.calls.at(-1)! as [
        string,
        { surfaces: Array<{ id: string; label: string; note?: string }> },
      ];
      // The authored entry is untouched, the vanished one still present, the new one appended.
      expect(finalMap.surfaces.map((s) => s.id)).toEqual([
        'node-cli-a',
        'node-cli-legacy',
        'node-cli-new',
      ]);
      expect(finalMap.surfaces[0]).toEqual(authored);
      expect(out.join('\n')).toContain(
        'drafted 1 new surface(s) into docs/site-map/app-map.yaml (kept 2 existing, skipped 0 unchanged group(s))',
      );
    });

    it('draft: a done unit with an unchanged hash is skipped without any map write (S8b, AC-4)', async () => {
      readCanonicalSiteMap.mockReturnValue({
        schema_version: 1,
        app: { name: 'paqad-ai', kind: 'cli' },
        surfaces: [{ id: 'node-cli-a', kind: 'cli-command', label: 'A' }],
      });
      readProgress.mockResolvedValue({
        schema_version: '1',
        inventory: { screens: 1, groups: [] },
        units: {
          'group:ungrouped': {
            id: 'group:ungrouped',
            kind: 'group',
            label: 'Ungrouped surfaces',
            state: 'done',
            started_at: null,
            completed_at: '2026-08-30T00:00:00.000Z',
            artifact: null,
            source_files: ['a.ts'],
            source_hash: 'sha1:abc1234',
            error: null,
          },
        },
      });
      reconcileDoneUnits.mockResolvedValue({ skipped: ['group:ungrouped'], reset: [] });
      gathered([surface()]);
      const out = await invoke(['draft', '--project-root', root]);
      expect(process.exitCode).toBe(0);
      expect(writeCanonicalSiteMap).not.toHaveBeenCalled();
      const progress = savedProgress();
      expect(progress.units['group:ungrouped'].state).toBe('done');
      // The staleness inputs were refreshed from the current extraction before reconciling.
      expect(progress.units['group:ungrouped'].source_files).toEqual(['a.ts']);
      expect(out.join('\n')).toContain('nothing to redraw: 1 unchanged group(s)');
      expect(out.join('\n')).toContain('kept 1 existing surface(s)');
    });

    it('draft: an interrupted run leaves exactly one unit writing (S8b, AC-5)', async () => {
      gathered([
        surface({ raw_id: 'a', module: 'Alpha', evidence: [{ file: 'alpha.ts' }] }),
        surface({ raw_id: 'b', module: 'Beta', evidence: [{ file: 'beta.ts' }] }),
      ]);
      writeCanonicalSiteMap
        .mockReturnValueOnce('docs/site-map/app-map.yaml')
        .mockImplementationOnce(() => {
          throw new Error('disk gone');
        });
      const out = await invoke(['draft', '--project-root', root]);
      expect(process.exitCode).toBe(2);
      expect(out.join('\n')).toContain('sitemap draft failed: disk gone');
      const progress = savedProgress();
      const states = Object.values(progress.units).map((unit) => unit.state);
      expect(states.filter((state) => state === 'writing')).toHaveLength(1);
      expect(states.filter((state) => state === 'done')).toHaveLength(1);
    });

    it('draft: refuses when app-map.yaml exists but is not a readable map (S8b, AC-1 guard)', async () => {
      mkdirSync(join(root, 'docs', 'site-map'), { recursive: true });
      writeFileSync(join(root, 'docs', 'site-map', 'app-map.yaml'), '{{{ not yaml', 'utf8');
      readCanonicalSiteMap.mockReturnValue(null);
      const out = await invoke(['draft', '--project-root', root]);
      expect(process.exitCode).toBe(2);
      expect(out.join('\n')).toContain('sitemap draft refused');
      expect(gatherSiteMapReport).not.toHaveBeenCalled();
      expect(writeCanonicalSiteMap).not.toHaveBeenCalled();
      expect(saveProgress).not.toHaveBeenCalled();
    });

    it('draft: a stored unit whose group vanished merges nothing and converges to done (S8b)', async () => {
      readProgress.mockResolvedValue({
        schema_version: '1',
        inventory: { screens: 0, groups: ['Ghost'] },
        units: {
          'group:ghost': {
            id: 'group:ghost',
            kind: 'group',
            label: 'Ghost',
            state: 'not_started',
            started_at: null,
            completed_at: null,
            artifact: null,
            source_files: ['ghost.ts'],
            source_hash: null,
            error: null,
          },
        },
      });
      gathered([surface()]);
      const out = await invoke(['draft', '--project-root', root]);
      expect(process.exitCode).toBe(0);
      const progress = savedProgress();
      expect(progress.units['group:ghost'].state).toBe('done');
      expect(progress.units['group:ungrouped'].state).toBe('done');
      // The ghost unit's write merged no surface; only the real one was appended.
      expect(out.join('\n')).toContain('drafted 1 new surface(s)');
    });

    it('draft: an empty extraction still writes the empty skeleton on first run (S8a parity)', async () => {
      gathered([]);
      const out = await invoke(['draft', '--project-root', root]);
      expect(process.exitCode).toBe(0);
      expect(writeCanonicalSiteMap).toHaveBeenCalledTimes(1);
      const [, mapArg] = writeCanonicalSiteMap.mock.calls[0] as [string, { surfaces: unknown[] }];
      expect(mapArg.surfaces).toHaveLength(0);
      expect(out.join('\n')).toContain('drafted 0 new surface(s)');
    });

    it('draft: an unexpected gather error exits 2 (S8a)', async () => {
      gatherSiteMapReport.mockRejectedValue(new Error('scan blew up'));
      const out = await invoke(['draft', '--project-root', root]);
      expect(process.exitCode).toBe(2);
      expect(out.join('\n')).toContain('sitemap draft failed: scan blew up');
      expect(writeCanonicalSiteMap).not.toHaveBeenCalled();
    });
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
