import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  containment,
  expertCollisionLine,
  expertCollisions,
  findSubsetOverlaps,
  lensFocus,
} from '@/authoring/overlap.js';
import { expertRosterProfiles, LENS_ROOT } from '@/authoring/stages/agent-evidence.js';

const ROOT = process.cwd();

describe('expert collisions (FR-36, FR-67)', () => {
  it("today's roster has no collision on Owns phrases or lens focus", () => {
    const profiles = expertRosterProfiles(ROOT);
    expect(profiles.length).toBe(15);
    expect(profiles.every((profile) => profile.lens !== undefined)).toBe(true);
    expect(expertCollisions(profiles, 0.4)).toEqual([]);
  });

  it('AC-13: two lenses with Jaccard 0.4 or more are a collision naming both roles', () => {
    const lens = readFileSync(join(ROOT, LENS_ROOT, 'db-expert.md'), 'utf8');
    const found = expertCollisions(
      [
        { role: 'db-expert', owns: 'Will the schema hold?', lens },
        { role: 'db-twin', owns: 'Who pays for the invoices?', lens },
      ],
      0.4,
    );
    expect(found).toEqual([{ role: 'db-twin', owner: 'db-expert', on: 'lens', score: 1 }]);
    expect(expertCollisionLine(found[0]!)).toContain(
      'The expert db-twin collides with db-expert on its lens',
    );
  });

  it('AC-26: a new expert whose Owns phrase collides names the owning role', () => {
    const found = expertCollisions(expertRosterProfiles(ROOT), 0.4, {
      role: 'agent-builder',
      owns: 'Should this agent exist, and how is it briefed, limited and stopped?',
    });
    expect(found.map((entry) => [entry.owner, entry.on])).toEqual([['agent-orchestrator', 'owns']]);
  });

  it('an edited expert is not compared with itself', () => {
    const profiles = expertRosterProfiles(ROOT);
    const self = profiles.find((profile) => profile.role === 'qa-engineer')!;
    expect(expertCollisions(profiles, 0.4, self)).toEqual([]);
  });

  it('reads the lens focus section and scores containment', () => {
    expect(lensFocus('# L\n\n## What you look for\n\n- a\n\n## Other\n\n- b\n').trim()).toBe('- a');
    expect(lensFocus('no sections')).toBe('no sections');
    expect(containment('review migration', 'we review every migration')).toBe(1);
    expect(containment('', 'x')).toBe(0);
    expect(
      findSubsetOverlaps({ name: 'a', job: 'review migration', tools: ['Read'] }, [
        { kind: 'agent', name: 'b', description: 'review migration', path: 'p', scope: 'project' },
      ]),
    ).toEqual([]);
  });
});
