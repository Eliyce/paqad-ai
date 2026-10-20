export type EnforcementFloor = 'block' | 'warn' | 'observe' | 'unbindable';

export type CapabilitySeam = 'pre-mutation' | 'completion';

export interface CapabilityPayload {
  toolName?: string;
  targetPath?: string;
  transcriptPath?: string;
  sessionId?: string;
  targetPaths?: string[];
  adapter?: string;
}

export interface CapabilityDescriptor {
  id: 'stages' | 'rule-scripts' | 'rules-loaded' | 'decision-pause' | 'narration' | 'delivery';
  title: string;
  modeKey: string | null;
  enforcementFloor: EnforcementFloor;
  seam: readonly CapabilitySeam[];
  ledgerDocType: string | null;
  policySchemaVersion: number;
  recordSchemaVersion: number;
}

export const CAPABILITY_REGISTRY: readonly CapabilityDescriptor[] = Object.freeze([
  {
    id: 'stages',
    title: 'Feature-development stages',
    modeKey: 'stages_mode',
    enforcementFloor: 'block',
    seam: ['pre-mutation', 'completion'],
    ledgerDocType: 'stage-evidence',
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'rule-scripts',
    title: 'Scripted-rule enforcement',
    modeKey: 'rule_compliance',
    enforcementFloor: 'block',
    seam: ['pre-mutation', 'completion'],
    ledgerDocType: null,
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'rules-loaded',
    title: 'Rule loading',
    modeKey: null,
    enforcementFloor: 'block',
    seam: ['pre-mutation'],
    ledgerDocType: null,
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'decision-pause',
    title: 'Decision Pause Contract',
    modeKey: null,
    enforcementFloor: 'block',
    seam: ['pre-mutation', 'completion'],
    ledgerDocType: 'decision-evidence',
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'narration',
    title: 'Narration contract',
    modeKey: null,
    enforcementFloor: 'unbindable',
    seam: [],
    ledgerDocType: null,
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
  {
    id: 'delivery',
    title: 'Delivery policy',
    modeKey: null,
    enforcementFloor: 'warn',
    seam: ['completion'],
    ledgerDocType: 'delivery-evidence',
    policySchemaVersion: 1,
    recordSchemaVersion: 1,
  },
]);

export function getCapability(id: CapabilityDescriptor['id']): CapabilityDescriptor {
  const found = CAPABILITY_REGISTRY.find((capability) => capability.id === id);
  if (!found) {
    throw new Error(`Unknown capability id: ${id}`);
  }
  return found;
}

export function capabilitiesForSeam(seam: CapabilitySeam): readonly CapabilityDescriptor[] {
  return CAPABILITY_REGISTRY.filter((capability) => capability.seam.includes(seam));
}
