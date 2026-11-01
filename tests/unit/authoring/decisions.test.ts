import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_PERMISSION_ALLOW,
  AGENT_PERMISSION_REMOVE,
  agentPermissionContext,
  raiseAgentPermissionDecision,
  readAuthoringDecision,
} from '@/authoring/decisions.js';
import { readContractDecisions, resolvePendingDecision } from '@/decisions/authoring.js';

const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-permission-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('raiseAgentPermissionDecision', () => {
  it('raises one packet per agent listing every power with allow and remove options', () => {
    const root = project();
    const id = raiseAgentPermissionDecision(root, {
      agent: 'db-reader',
      powers: ['network', 'bypassPermissions', 'network'],
      fileHash: 'sha256-abc',
      change: 'change-1',
    });
    const rows = readContractDecisions(root).filter((row) => row.packet.id === id);
    expect(rows).toHaveLength(1);
    const packet = rows[0]!.packet as unknown as Record<string, unknown>;
    expect(packet.category).toBe('authoring.agent_permission');
    expect(packet.title).toBe(
      'The agent db-reader asks for these powers: bypassPermissions, network. Allow these powers?',
    );
    expect(packet.context).toBe(
      agentPermissionContext(['network', 'bypassPermissions'], 'sha256-abc'),
    );
    expect(packet.context).toBe('Powers: bypassPermissions, network. File hash: sha256-abc.');
    const options = packet.options as { option_key: string; label: string }[];
    expect(options.map((entry) => [entry.option_key, entry.label])).toEqual([
      [AGENT_PERMISSION_ALLOW, 'Allow these powers'],
      [AGENT_PERMISSION_REMOVE, 'Remove them'],
    ]);
    expect(packet.recommendation).toBe(AGENT_PERMISSION_REMOVE);
  });

  it('reads back as resolved with the chosen option once answered', () => {
    const root = project();
    const id = raiseAgentPermissionDecision(root, {
      agent: 'db-reader',
      powers: ['WebFetch'],
      fileHash: 'sha256-def',
    });
    expect(readAuthoringDecision(root, id)?.status).toBe('pending');
    resolvePendingDecision(root, id, AGENT_PERMISSION_ALLOW, 'needed for the docs lookup');
    const record = readAuthoringDecision(root, id);
    expect(record?.status).toBe('resolved');
    expect(record?.chosen).toBe(AGENT_PERMISSION_ALLOW);
    expect(record?.category).toBe('authoring.agent_permission');
  });
});
