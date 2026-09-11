import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_VISUAL_EVIDENCE_MODE,
  VISUAL_EVIDENCE_MODES,
  resolveVisualEvidenceMode,
} from '@/verification/repository/visual-evidence-mode.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-vem-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

describe('resolveVisualEvidenceMode', () => {
  it('defaults to warn', () => {
    expect(DEFAULT_VISUAL_EVIDENCE_MODE).toBe('warn');
    expect(resolveVisualEvidenceMode(tempRoot(), {})).toBe('warn');
    expect(VISUAL_EVIDENCE_MODES).toEqual(['warn', 'strict']);
  });

  it('honours a team floor of strict', () => {
    const root = tempRoot();
    write(root, '.paqad/configs/.config.policy', 'visual_evidence_mode=strict\n');
    expect(resolveVisualEvidenceMode(root, {})).toBe('strict');
  });

  it('lets the env RAISE above the team floor, never lower it', () => {
    const root = tempRoot();
    write(root, '.paqad/configs/.config.policy', 'visual_evidence_mode=warn\n');
    expect(resolveVisualEvidenceMode(root, { PAQAD_VISUAL_EVIDENCE_MODE: 'strict' })).toBe('strict');
    // a team floor of strict cannot be lowered by env
    write(root, '.paqad/configs/.config.policy', 'visual_evidence_mode=strict\n');
    expect(resolveVisualEvidenceMode(root, { PAQAD_VISUAL_EVIDENCE_MODE: 'warn' })).toBe('strict');
  });

  it('lets a local .config RAISE the default', () => {
    const root = tempRoot();
    write(root, '.paqad/.config', 'visual_evidence_mode=strict\n');
    expect(resolveVisualEvidenceMode(root, {})).toBe('strict');
  });
});
