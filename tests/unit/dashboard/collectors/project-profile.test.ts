import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { collectProjectProfile } from '@/dashboard/collectors/project-profile';

function writeProfile(root: string, body: unknown): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(body));
}

describe('collectProjectProfile', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-profile-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when the profile is missing', () => {
    const { section, projectName } = collectProjectProfile(root);
    expect(section.band).toBe('unknown');
    expect(section.score).toBeNull();
    expect(projectName).toBeNull();
    expect(section.summary).toMatch(/paqad-ai onboard/);
  });

  it('returns red when the file is unparseable', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/project-profile.yaml'), ': : : not yaml');
    const { section } = collectProjectProfile(root);
    expect(section.band).toBe('red');
    expect(section.score).toBe(0);
    expect(section.metrics.some((m) => m.label === 'parse')).toBe(true);
  });

  it('scores fully-onboarded projects as green', () => {
    writeProfile(root, {
      project: { name: 'demo', id: 'demo', description: '' },
      commands: { install: 'pnpm i', test: 'pnpm test', build: 'pnpm build' },
      intelligence: { rag_enabled: true },
      mcp: { servers: [{ name: 'a' }, { name: 'b' }] },
      routing: { domain: 'coding' },
    });
    const { section, projectName } = collectProjectProfile(root);
    expect(section.band).toBe('green');
    expect(section.score).toBe(100);
    expect(projectName).toBe('demo');
    expect(section.summary).toMatch(/RAG on/);
    expect(section.summary).toMatch(/2 MCP server/);
  });

  it('reports missing required fields', () => {
    writeProfile(root, {
      project: { name: 'demo' }, // missing id
      commands: { install: 'x' }, // missing test, build
      routing: {}, // missing domain
    });
    const { section } = collectProjectProfile(root);
    expect(section.band).toBe('red');
    expect(section.score).toBeLessThan(50);
    const missing = (section.details?.missingFields as string[]) ?? [];
    expect(missing).toContain('project.id');
    expect(missing).toContain('commands.test');
    expect(missing).toContain('commands.build');
    expect(missing).toContain('routing.domain');
  });
});
