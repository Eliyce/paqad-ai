import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cloudSetupNote } from '@/adapters/claude/team-setup.js';
import { readCanonicalSiteMap, readJourney } from '@/site-map/store.js';

const REPO = resolve(__dirname, '../../..');
const JOURNEY = 'docs/site-map/journeys/team-bootstrap-first-session.journey.yaml';
const BUSINESS = 'docs/modules/adapter-onboarding/features/claude-code/business.md';
const CLOUD_TAIL = 'paqad-ai install && paqad-ai join --no-rag --non-interactive';
const PINNED_INSTALL = /npm i(?:nstall)? -g paqad-ai@(?:<version>|<team version>|\d+\.\d+\.\d+)$/u;

function docsUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'rca' ? [] : docsUnder(path);
    return /\.(?:md|ya?ml)$/u.test(name) ? [path] : [];
  });
}

function cloudCommands(text: string): string[] {
  const found: string[] = [];
  let at = text.indexOf(CLOUD_TAIL);
  while (at >= 0) {
    const lineStart = text.lastIndexOf('\n', at) + 1;
    found.push(text.slice(lineStart, at + CLOUD_TAIL.length));
    at = text.indexOf(CLOUD_TAIL, at + 1);
  }
  return found;
}

function installPart(command: string): string {
  const head = command.slice(0, command.lastIndexOf(' && paqad-ai install'));
  const start = head.lastIndexOf('npm i');
  return start < 0 ? head : head.slice(start);
}

describe('AC-33: every documented cloud setup command installs an exact version', () => {
  const files = [join(REPO, 'README.md'), ...docsUnder(join(REPO, 'docs'))];

  it('README, the docs and the journey carry the command and pin it', () => {
    const seen: string[] = [];
    for (const file of files) {
      for (const command of cloudCommands(readFileSync(file, 'utf8'))) {
        seen.push(relative(REPO, file).split(sep).join('/'));
        expect(installPart(command), relative(REPO, file)).toMatch(PINNED_INSTALL);
      }
    }
    expect(seen).toEqual(expect.arrayContaining(['README.md', JOURNEY, BUSINESS]));
  });

  it('no doc installs the bare package name before the cloud setup', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, relative(REPO, file)).not.toMatch(/npm i(?:nstall)? -g paqad-ai &&/u);
    }
  });

  it('the onboard and update note prints the exact installed version', () => {
    const note = cloudSetupNote(REPO);
    const [command] = cloudCommands(note);
    expect(installPart(command ?? '')).toMatch(/npm i -g paqad-ai@\d+\.\d+\.\d+/u);
  });
});

describe('AC-52: the journey and the Claude Code business doc describe the plugin and the cloud commands', () => {
  for (const file of [JOURNEY, BUSINESS]) {
    it(`${file} names both routes and no committed launcher or agents`, () => {
      const text = readFileSync(join(REPO, file), 'utf8');
      expect(text).toMatch(/plugin/u);
      expect(text).toContain(`npm i -g paqad-ai@<version> && ${CLOUD_TAIL}`);
      expect(text).not.toMatch(/committed launcher|launcher picks|team-plugin/u);
      expect(text).not.toMatch(/commits[^\n]*\.claude\/agents\/paqad-\*\.md/u);
      expect(text).not.toMatch(/commits[^\n]*\.paqad\/hook\.mjs/u);
    });
  }
});

describe('AC-53: the first-session journey follows the plugin and cloud setup answer', () => {
  const journey = readJourney(REPO, 'team-bootstrap-first-session');

  it('passes the site-map journey check and every step names a known surface', () => {
    expect(journey).not.toBeNull();
    const surfaces = new Set((readCanonicalSiteMap(REPO)?.surfaces ?? []).map((s) => s.id));
    for (const step of journey?.steps ?? []) expect(surfaces.has(step.surface)).toBe(true);
    expect(surfaces.has(journey?.entry ?? '')).toBe(true);
  });

  it('keeps the entry, success and abandoned ends true for the new routes', () => {
    expect(journey?.entry).toBe('node-cli-update');
    expect(journey?.ends?.success).toMatch(/first prompt runs with stages enforced/u);
    expect(journey?.ends?.abandoned).toMatch(/no paqad stage agents/u);
    const actions = (journey?.steps ?? []).map((step) => step.action ?? '').join('\n');
    expect(actions).not.toMatch(/launcher/u);
    expect(actions).toMatch(/accepts the paqad plugin/u);
  });
});

describe('AC-54: the cloud branch of the first-session journey', () => {
  it('lists the setup commands, the 13 agents at start, then the first prompt dispatching planning', () => {
    const steps = (readJourney(REPO, 'team-bootstrap-first-session')?.steps ?? []).filter(
      (step) => step.variant?.group === 'cloud',
    );
    expect(steps).toHaveLength(3);
    expect(steps[0]?.action).toContain(`npm i -g paqad-ai@<version> && ${CLOUD_TAIL}`);
    expect(steps[1]?.expect).toMatch(/13 paqad stage agents are already in `~\/\.claude\/agents`/u);
    expect(steps[2]?.expect).toMatch(/dispatches `paqad-planning`/u);
  });
});
