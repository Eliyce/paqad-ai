// Issue #581 — cross-cutting checks over the bundles a whole fixture run leaves behind, one
// run per config case (see bundle-run.fixture.ts):
//   AC-3  nothing the pipeline or freeze wrote is left in .paqad/tmp
//   AC-4  every JSON document and JSONL row carries the one header, doc_type paqad.<stem>,
//         change = the folder ULID, and no retired time key appears anywhere
//   AC-5  issue, title and slug live only in feature.json
//   AC-6  adapter, branch and lane live only in feature.json, never on a row
//   AC-7  (M3) each expert finding is stored once, synthesis refers by id, only two .md files
//   AC-8  (M3) a brief rebuilt from the frozen bundle hashes to the roster's brief_hash
//   AC-9  spec.md's body hashes to spec_hash; no provenance, run_dir or specification.md
//   AC-10 (pipeline on) every FR/AC/INV id has one trace source: a ticket section or a finding
//   AC-11 (M2, M3) the enforcement block is stored once, never on a spec-step row

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';

import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ENVELOPE_HEADER_KEYS,
  fromAiBomProperties,
  readHeaderScript,
  splitFrontMatter,
} from '@/feature-evidence/envelope.js';
import { parseFeatureDirName } from '@/feature-evidence/paths.js';
import { validateEnvelopeHeader } from '@/feature-evidence/schema.js';
import { renderExpertBrief } from '@/spec-pipeline/experts/brief.js';
import { readExperts, readGrounding, readLabel, readRequest } from '@/spec-pipeline/run-store.js';
import { SPEC_STEP_KIND } from '@/stage-evidence/types.js';

import {
  bundlePath,
  EXPERT_FINDING,
  expertsRan,
  ORACLE_CASES,
  pipelineOn,
  runBundleFixture,
  type BundleRun,
  type OracleCase,
} from './bundle-run.fixture.js';

const E2E_TIMEOUT = 90_000;

const BANNED_TIME_KEYS = [
  'ts',
  'created_at',
  'captured_at',
  'generated_at',
  'time_verified',
  'resolved_at',
];
const IDENTITY_KEYS = ['issue', 'title', 'slug'];
const SESSION_CONSTANT_KEYS = ['adapter', 'branch', 'lane'];

/** One parsed JSON value from the bundle: a whole document or one JSONL row. */
interface BundleValue {
  file: string;
  /** `<file>` for a document, `<file>:<line>` for a row. */
  where: string;
  value: Record<string, unknown>;
  row: boolean;
}

function readValues(run: BundleRun): BundleValue[] {
  const dir = bundlePath(run);
  const values: BundleValue[] = [];
  for (const file of readdirSync(dir).sort()) {
    const text = () => readFileSync(join(dir, file), 'utf8');
    if (file.endsWith('.json')) {
      values.push({ file, where: file, value: JSON.parse(text()), row: false });
    } else if (file.endsWith('.jsonl')) {
      text()
        .split('\n')
        .filter((line) => line.length > 0)
        .forEach((line, index) => {
          values.push({ file, where: `${file}:${index + 1}`, value: JSON.parse(line), row: true });
        });
    }
  }
  return values;
}

/** Every key path in a JSON value, e.g. `pipeline.enforcement`, `steps[0].id`. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keyPaths(item, `${prefix}[${index}]`));
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...keyPaths(child, path)];
  });
}

function lastKey(path: string): string {
  return path
    .split('.')
    .pop()!
    .replace(/\[\d+\]$/, '');
}

/** Every object anywhere in a value, with its key path. */
function objectsIn(
  value: unknown,
  prefix = '',
): Array<{ path: string; object: Record<string, unknown> }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => objectsIn(item, `${prefix}[${index}]`));
  }
  if (typeof value !== 'object' || value === null) return [];
  const object = value as Record<string, unknown>;
  return [
    { path: prefix, object },
    ...Object.entries(object).flatMap(([key, child]) =>
      objectsIn(child, prefix ? `${prefix}.${key}` : key),
    ),
  ];
}

const runs = new Map<OracleCase, BundleRun>();
beforeAll(async () => {
  for (const caseId of ORACLE_CASES) runs.set(caseId, await runBundleFixture(caseId));
}, 6 * E2E_TIMEOUT);
afterAll(() => {
  for (const run of runs.values()) rmSync(run.root, { recursive: true, force: true });
});

describe.each(ORACLE_CASES)('the %s bundle', (caseId) => {
  const run = (): BundleRun => runs.get(caseId)!;
  const ulid = (): string => parseFeatureDirName(run().dir)!.ulid;

  it('AC-4: every JSON document and row carries the one header, in order', () => {
    const values = readValues(run());
    expect(values.length).toBeGreaterThan(0);
    for (const { file, where, value } of values) {
      const stem = file.replace(/\.jsonl?$/, '');
      if (file === 'receipt.json') {
        // The DSSE receipt carries the header in its top-level `paqad` block.
        const block = value.paqad as Record<string, unknown>;
        expect(validateEnvelopeHeader(block), where).toEqual([]);
        expect(block.doc_type, where).toBe('paqad.receipt');
        expect(block.change, where).toBe(ulid());
        continue;
      }
      if (file === 'ai-bom.json') {
        // CycloneDX carries it as `paqad:<field>` metadata properties.
        const header = fromAiBomProperties(
          (value.metadata as { properties?: Array<{ name: string; value: string }> }).properties,
        );
        expect(validateEnvelopeHeader(header), where).toEqual([]);
        expect(header?.doc_type, where).toBe('paqad.ai-bom');
        expect(header?.change, where).toBe(ulid());
        continue;
      }
      expect(validateEnvelopeHeader(value), where).toEqual([]);
      expect(Object.keys(value).slice(0, ENVELOPE_HEADER_KEYS.length), where).toEqual([
        ...ENVELOPE_HEADER_KEYS,
      ]);
      expect(value.doc_type, where).toBe(`paqad.${stem}`);
      expect(value.change, where).toBe(ulid());
    }
  });

  it('AC-4: the text files carry the header too (front matter and the report tag)', () => {
    const dir = bundlePath(run());
    const markdown = readdirSync(dir).filter((file) => file.endsWith('.md'));
    expect(markdown).toContain('spec.md');
    for (const file of markdown) {
      const { header } = splitFrontMatter(readFileSync(join(dir, file), 'utf8'));
      expect(header?.doc_type, file).toBe(`paqad.${file.replace(/\.md$/, '')}`);
      expect(header?.change, file).toBe(ulid());
    }
    if (existsSync(join(dir, 'report.html'))) {
      const header = readHeaderScript(readFileSync(join(dir, 'report.html'), 'utf8'));
      expect(header?.doc_type).toBe('paqad.report');
      expect(header?.change).toBe(ulid());
    }
  });

  it('AC-4: no retired time key appears anywhere in the bundle JSON', () => {
    for (const { where, value } of readValues(run())) {
      const banned = keyPaths(value).filter((path) => BANNED_TIME_KEYS.includes(lastKey(path)));
      expect(banned, where).toEqual([]);
    }
  });

  it('AC-5 and AC-6: identity and session constants live only in feature.json', () => {
    const values = readValues(run());
    const feature = values.find((entry) => entry.file === 'feature.json')!.value;
    for (const key of [...IDENTITY_KEYS, ...SESSION_CONSTANT_KEYS]) {
      expect(feature, `feature.json ${key}`).toHaveProperty(key);
    }
    for (const { file, where, value } of values) {
      if (file === 'feature.json') continue;
      const carried = keyPaths(value).filter(
        (path) =>
          [...IDENTITY_KEYS, ...SESSION_CONSTANT_KEYS].includes(lastKey(path)) &&
          // A loaded rule's own title is the rule's name, not the change identity.
          !(file === 'rules-loaded.json' && /^applicable_rules\[\d+\]\.title$/.test(path)),
      );
      expect(carried, where).toEqual([]);
    }
    // Rows carry each writer's own session id instead (AC-26 keeps that).
    const rows = values.filter((entry) => entry.file === 'stage-evidence.jsonl');
    expect(rows.every((entry) => typeof entry.value.session_id === 'string')).toBe(true);
  });

  it('AC-9: spec.md is the one spec source and specification.json points at it', () => {
    const dir = bundlePath(run());
    const spec = JSON.parse(readFileSync(join(dir, 'specification.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const { body } = splitFrontMatter(readFileSync(join(dir, 'spec.md'), 'utf8'));
    expect(createHash('sha256').update(body).digest('hex')).toBe(spec.spec_hash);
    expect(spec.spec_file).toBe('spec.md');
    expect(spec).not.toHaveProperty('provenance');
    expect(spec).not.toHaveProperty('run_dir');
    expect(existsSync(join(dir, 'specification.md'))).toBe(false);
    expect(existsSync(join(dir, 'context-efficiency.jsonl'))).toBe(false);
  });

  it('AC-3: nothing the run handed in or staged is left in .paqad/tmp', () => {
    const tmp = join(run().root, '.paqad', 'tmp');
    const left = existsSync(tmp) ? readdirSync(tmp) : [];
    expect(left).toEqual([]);
  });

  it.runIf(pipelineOn(caseId))(
    'AC-10: every FR, AC and INV id has one trace source from the ticket or a finding',
    () => {
      const dir = bundlePath(run());
      const spec = JSON.parse(readFileSync(join(dir, 'specification.json'), 'utf8')) as {
        behaviour: string[];
        acceptance_criteria: Array<{ criterion_id: string }>;
        invariants: Array<{ invariant_id: string }>;
        trace: Record<string, string>;
      };
      const findingIds = expertsRan(caseId)
        ? (
            JSON.parse(readFileSync(join(dir, 'experts.json'), 'utf8')) as {
              findings: Array<{ id: string }>;
            }
          ).findings.map((finding) => finding.id)
        : [];
      const ids = [
        ...spec.behaviour.map((line) => /^(?:- )?((?:FR|NFR)-\d+)/.exec(line)?.[1] ?? line),
        ...spec.acceptance_criteria.map((criterion) => criterion.criterion_id),
        ...spec.invariants.map((invariant) => invariant.invariant_id),
      ];
      expect(ids).toEqual(['FR-1', 'AC-1', 'INV-1']);
      expect(Object.keys(spec.trace).sort()).toEqual([...ids].sort());
      for (const id of ids) {
        const source = spec.trace[id]!;
        expect(
          source.startsWith('ticket:') || findingIds.includes(source),
          `${id} -> ${source}`,
        ).toBe(true);
      }
    },
  );

  it.runIf(pipelineOn(caseId))(
    'AC-11: the enforcement block is stored once, in specification.json pipeline',
    () => {
      const hits = readValues(run()).flatMap(({ where, value }) =>
        keyPaths(value)
          .filter((path) => lastKey(path) === 'enforcement')
          .map((path) => `${where}#${path}`),
      );
      expect(hits).toEqual(['specification.json#pipeline.enforcement']);
      const stepRows = readValues(run()).filter(
        (entry) => entry.file === 'stage-evidence.jsonl' && entry.value.kind === SPEC_STEP_KIND,
      );
      expect(stepRows.length).toBeGreaterThan(0);
      expect(stepRows.every((entry) => !('enforcement' in entry.value))).toBe(true);
    },
  );

  it.runIf(expertsRan(caseId))(
    'AC-7: each finding is stored once, synthesis refers by id, no brief files',
    () => {
      const dir = bundlePath(run());
      const stored = readValues(run()).flatMap(({ where, value }) =>
        objectsIn(value)
          .filter(({ object }) => typeof object.id === 'string' && /^EX-/.test(object.id))
          .map(({ path, object }) => ({ at: `${where}#${path}`, id: object.id as string })),
      );
      expect(stored).toEqual([{ at: 'experts.json#findings[0]', id: EXPERT_FINDING }]);
      const experts = JSON.parse(readFileSync(join(dir, 'experts.json'), 'utf8')) as {
        synthesis: { accepted: unknown[]; declined: unknown[] };
      };
      expect(experts.synthesis.accepted).toEqual([EXPERT_FINDING]);
      expect(
        [...experts.synthesis.accepted, ...experts.synthesis.declined].every(
          (entry) => typeof entry === 'string',
        ),
      ).toBe(true);
      expect(existsSync(join(dir, 'briefs'))).toBe(false);
      expect(
        readdirSync(dir)
          .filter((file) => file.endsWith('.md'))
          .sort(),
      ).toEqual(['request.md', 'spec.md']);
    },
  );

  it.runIf(expertsRan(caseId))(
    'AC-8: a brief rebuilt from the frozen bundle matches the roster brief_hash',
    () => {
      const { root, dir } = run();
      const entry = readExperts(root, dir)!.roster[0]!;
      // After freeze the staging dir is gone: grounding now comes from specification.json.
      expect(existsSync(join(root, '.paqad', 'tmp', 'spec-pipeline'))).toBe(false);
      const brief = renderExpertBrief({
        need: { role: entry.role, reason: entry.reason },
        request: readRequest(root, dir),
        grounding: readGrounding(root, dir)!,
        label: readLabel(root, dir)!,
        granted: entry.budget_tokens,
      });
      expect(brief.hash).toBe(entry.brief_hash);
    },
  );
});
