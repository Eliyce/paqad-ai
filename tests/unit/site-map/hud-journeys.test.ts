import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateJourney } from '@/site-map/schema.js';
import { readJourney } from '@/site-map/store.js';

const REPO = resolve(__dirname, '../../..');

function journey(id: string) {
  const found = readJourney(REPO, id);
  expect(found, id).not.toBeNull();
  expect(validateJourney(found).valid, id).toBe(true);
  return found!;
}

describe('AC-36: the stored journeys carry the HUD rows and the team install step', () => {
  it('ship-a-change shows the HUD band step after the plan step, and the old steps keep their order', () => {
    const steps = journey('ship-a-change').steps.map((step) => step.surface);
    expect(steps).toEqual([
      'node-cli-plan',
      'node-cli-doctor',
      'node-cli-spec',
      'node-cli-spec',
      'node-cli-skill',
      'node-cli-checks',
      'node-cli-review',
      'node-cli-stage',
      'node-cli-deliver',
    ]);
    const hud = journey('ship-a-change').steps[1]!;
    expect(hud.expect).toContain('Getting ready');
    expect(hud.expect).toContain('never goes blank');
  });

  it('AC-53: team-bootstrap-first-session gets paqad from the plugin or the cloud setup commands', () => {
    const steps = journey('team-bootstrap-first-session').steps;
    expect(steps.map((step) => step.surface)).toEqual([
      'node-cli-update',
      'node-cli-update',
      'node-cli-join',
      'node-cli-install',
      'node-cli-join',
      'node-cli-join',
      'node-cli-join',
    ]);
    expect(steps[1]!.action).toContain('accepts the paqad plugin');
    expect(steps.map((step) => step.action ?? '').join('\n')).not.toContain('in the background');
  });
});
