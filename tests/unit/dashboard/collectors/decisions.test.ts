import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectDecisions } from '@/dashboard/collectors/decisions';

const NOW = Date.UTC(2026, 4, 26);

function writePacket(
  root: string,
  bucket: string,
  id: string,
  createdAt: string | null,
  title = id,
): void {
  const dir = join(root, '.paqad/decisions', bucket);
  mkdirSync(dir, { recursive: true });
  const body: Record<string, unknown> = { id, title, category: 'scope' };
  if (createdAt !== null) body.created_at = createdAt;
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(body));
}

describe('collectDecisions', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-dec-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when there is no decisions directory', () => {
    const { section, attention } = collectDecisions(root, NOW);
    expect(section.band).toBe('unknown');
    expect(attention).toEqual([]);
  });

  it('scores green when the decisions dir exists but is empty', () => {
    mkdirSync(join(root, '.paqad/decisions'), { recursive: true });
    const { section } = collectDecisions(root, NOW);
    expect(section.band).toBe('green');
    expect(section.score).toBe(100);
    expect(section.summary).toMatch(/Clear/);
  });

  it('penalises ageing pending packets', () => {
    writePacket(root, 'pending', 'D-1', new Date(NOW - 2 * 86_400_000).toISOString());
    writePacket(root, 'pending', 'D-2', new Date(NOW - 5 * 86_400_000).toISOString());
    const { section, attention } = collectDecisions(root, NOW);
    // 20 (≤3d) + 35 (≤7d) = 55 penalty → 45.
    expect(section.score).toBe(45);
    expect(section.band).toBe('red');
    expect(attention.length).toBe(2);
    expect(attention[0]?.message).toMatch(/D-2/);
  });

  it('treats packets older than a week as critical', () => {
    writePacket(root, 'pending', 'D-9', new Date(NOW - 14 * 86_400_000).toISOString());
    const { section, attention } = collectDecisions(root, NOW);
    expect(section.score).toBe(50);
    expect(attention[0]?.severity).toBe('critical');
  });

  it('reports resolved and expired counts in metrics', () => {
    writePacket(root, 'resolved', 'D-3', null);
    writePacket(root, 'resolved', 'D-4', null);
    writePacket(root, 'expired', 'D-5', null);
    const { section } = collectDecisions(root, NOW);
    expect(section.metrics.find((m) => m.label === 'resolved')?.value).toBe('2');
    expect(section.metrics.find((m) => m.label === 'expired')?.value).toBe('1');
  });
});
