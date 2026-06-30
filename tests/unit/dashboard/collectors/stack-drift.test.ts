import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectStackDrift } from '@/dashboard/collectors/stack-drift';

const NOW = Date.UTC(2026, 4, 26);

function writeDrift(root: string, body: unknown): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/stack-drift.json'), JSON.stringify(body));
}

describe('collectStackDrift', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-drift-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when nothing exists', () => {
    const { section } = collectStackDrift(root, NOW);
    expect(section.band).toBe('unknown');
  });

  it('scores green when no drift is detected', () => {
    writeDrift(root, {
      generated_at: new Date(NOW - 86_400_000).toISOString(),
      status: 'no-drift',
      material_changes: [],
    });
    const { section, attention } = collectStackDrift(root, NOW);
    expect(section.score).toBe(100);
    expect(section.band).toBe('green');
    expect(attention).toEqual([]);
  });

  it('deducts 15 per material change', () => {
    writeDrift(root, {
      generated_at: new Date(NOW - 86_400_000).toISOString(),
      status: 'drift-detected',
      material_changes: [
        { type: 'framework-added', key: 'react' },
        { type: 'trait-added', key: 'tailwind' },
      ],
    });
    const { section, attention } = collectStackDrift(root, NOW);
    expect(section.score).toBe(70);
    expect(section.band).toBe('amber');
    expect(attention[0]?.severity).toBe('warn');
  });

  it('escalates to critical at 3+ changes and adds a staleness penalty', () => {
    writeDrift(root, {
      generated_at: new Date(NOW - 120 * 86_400_000).toISOString(),
      status: 'drift-detected',
      material_changes: Array.from({ length: 4 }, (_, i) => ({
        type: 'framework-added',
        key: `f${i}`,
      })),
    });
    const { section, attention } = collectStackDrift(root, NOW);
    // 100 - 4*15 - 20 (stale > 90d) = 20.
    expect(section.score).toBe(20);
    expect(section.band).toBe('red');
    expect(attention[0]?.severity).toBe('critical');
  });

  it('treats a malformed drift report as no report (unknown)', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/stack-drift.json'), '{bad json');
    const { section } = collectStackDrift(root, NOW);
    expect(section.band).toBe('unknown');
  });

  it('points at the missing drift report when a snapshot exists but no drift', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/stack-snapshot.json'), '{}');
    const { section } = collectStackDrift(root, NOW);
    expect(section.band).toBe('unknown');
    expect(section.summary).toMatch(/No stack-drift\.json/);
  });

  it('uses the singular noun for a single material change', () => {
    writeDrift(root, {
      generated_at: new Date(NOW - 86_400_000).toISOString(),
      status: 'drift-detected',
      material_changes: [{ type: 'framework-added', key: 'react' }],
    });
    const { attention } = collectStackDrift(root, NOW);
    expect(attention[0]?.message).toMatch(/1 change\)/); // singular, no trailing 's'
  });
});
