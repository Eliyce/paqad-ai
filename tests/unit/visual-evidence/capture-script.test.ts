import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveCaption,
  listCaptureScriptIds,
  loadCaptureScripts,
} from '@/visual-evidence/capture-script.js';

let root: string;
const roots: string[] = [];

function journeysDir(): string {
  return join(root, 'docs', 'site-map', 'journeys');
}

function writeJourney(id: string, status: string, steps: Array<{ surface: string; action?: string; expect?: string }>): void {
  const doc = {
    schema_version: 1,
    id,
    label: `Journey ${id}`,
    actor: 'developer',
    goal: 'do a thing',
    entry: steps[0]?.surface ?? 'home',
    status,
    steps,
    ends: { success: 'done' },
  };
  writeFileSync(join(journeysDir(), `${id}.journey.yaml`), JSON.stringify(doc), 'utf8');
}

function writeCapture(id: string, body: unknown): void {
  writeFileSync(join(journeysDir(), `${id}.capture.yaml`), JSON.stringify(body), 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-cap-'));
  roots.push(root);
  mkdirSync(journeysDir(), { recursive: true });
});
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('loadCaptureScripts', () => {
  it('loads a valid capture script against a confirmed journey', () => {
    writeJourney('checkout', 'confirmed', [
      { surface: 'cart', action: 'Open the cart', expect: 'Items listed' },
      { surface: 'pay', action: 'Pay' },
    ]);
    writeCapture('checkout', {
      schema_version: 1,
      journey: 'checkout',
      setup: [{ goto: '/login', actions: [{ selector: '#email', do: 'fill', value: '$VE_USER' }] }],
      steps: [
        { journey_step: 1, goto: '/cart' },
        { journey_step: 2, actions: [{ selector: '#pay', do: 'click' }] },
      ],
    });
    const { scripts, errors } = loadCaptureScripts(root);
    expect(errors).toEqual([]);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.script.journey).toBe('checkout');
    expect(scripts[0]!.journey.status).toBe('confirmed');
  });

  it('rejects a capture script pointing at a proposed journey', () => {
    writeJourney('draft', 'proposed', [{ surface: 'a', action: 'A' }]);
    writeCapture('draft', { schema_version: 1, journey: 'draft', steps: [{ journey_step: 1 }] });
    const { scripts, errors } = loadCaptureScripts(root);
    expect(scripts).toEqual([]);
    expect(errors[0]!.errors.join(' ')).toContain('proposed');
  });

  it('rejects an unknown journey reference', () => {
    writeCapture('ghost', { schema_version: 1, journey: 'ghost', steps: [{ journey_step: 1 }] });
    const { errors } = loadCaptureScripts(root);
    expect(errors[0]!.errors.join(' ')).toContain('does not resolve');
  });

  it('rejects a journey_step outside the journey range', () => {
    writeJourney('c', 'confirmed', [{ surface: 'a', action: 'A' }]);
    writeCapture('c', { schema_version: 1, journey: 'c', steps: [{ journey_step: 5 }] });
    const { errors } = loadCaptureScripts(root);
    expect(errors[0]!.errors.join(' ')).toContain('journey_step 5 does not exist');
  });

  it('rejects out-of-order steps', () => {
    writeJourney('c', 'confirmed', [
      { surface: 'a', action: 'A' },
      { surface: 'b', action: 'B' },
    ]);
    writeCapture('c', {
      schema_version: 1,
      journey: 'c',
      steps: [{ journey_step: 2 }, { journey_step: 1 }],
    });
    const { errors } = loadCaptureScripts(root);
    expect(errors[0]!.errors.join(' ')).toContain('ascending');
  });

  it('rejects a filename that does not match the journey id', () => {
    writeJourney('right', 'confirmed', [{ surface: 'a', action: 'A' }]);
    writeCapture('wrong', { schema_version: 1, journey: 'right', steps: [{ journey_step: 1 }] });
    const { errors } = loadCaptureScripts(root);
    expect(errors[0]!.errors.join(' ')).toContain('must equal the sibling file id');
  });

  it('enforces value-requiredness per verb', () => {
    writeJourney('c', 'confirmed', [{ surface: 'a', action: 'A' }]);
    writeCapture('c', {
      schema_version: 1,
      journey: 'c',
      steps: [
        {
          journey_step: 1,
          actions: [
            { selector: '#x', do: 'fill' },
            { selector: '#y', do: 'wait_for', value: 'nope' },
          ],
        },
      ],
    });
    const { errors } = loadCaptureScripts(root);
    const joined = errors[0]!.errors.join(' ');
    expect(joined).toContain('`fill` requires a value');
    expect(joined).toContain('"visible" or "hidden"');
  });

  it('reports a schema-invalid capture script', () => {
    writeJourney('c', 'confirmed', [{ surface: 'a', action: 'A' }]);
    writeCapture('c', { schema_version: 2, journey: 'c', steps: [] });
    const { errors } = loadCaptureScripts(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.errors.length).toBeGreaterThan(0);
  });

  it('reports a capture file that is not valid YAML', () => {
    writeFileSync(join(journeysDir(), 'broken.capture.yaml'), ': : not yaml : :', 'utf8');
    const { errors } = loadCaptureScripts(root);
    expect(errors.some((e) => e.file.endsWith('broken.capture.yaml'))).toBe(true);
  });

  it('returns nothing when the journeys dir is absent', () => {
    rmSync(journeysDir(), { recursive: true, force: true });
    expect(loadCaptureScripts(root)).toEqual({ scripts: [], errors: [] });
    expect(listCaptureScriptIds(root)).toEqual([]);
  });
});

describe('deriveCaption', () => {
  const journey = {
    steps: [
      { surface: 'a', action: 'Open the goal picker', expect: 'The savings goal is selected' },
      { surface: 'b', action: 'Confirm' },
      { surface: 'c' },
    ],
  } as never;

  it('joins action and expect when both are present', () => {
    expect(deriveCaption(journey, 1)).toBe('Open the goal picker. The savings goal is selected');
  });

  it('uses the action alone when there is no expect', () => {
    expect(deriveCaption(journey, 2)).toBe('Confirm');
  });

  it('is empty when the step has no action', () => {
    expect(deriveCaption(journey, 3)).toBe('');
  });
});
