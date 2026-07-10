import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { listFeatureDirs } from '@/feature-evidence/delivery.js';
import { featureFilePath } from '@/feature-evidence/paths.js';

/**
 * Issue #146 — the functionality inventory behind `/api/inventory`.
 *
 * Classifies every paqad functionality exactly once per the management rule
 * (spec section 2): web-managed settings are editable on the dashboard,
 * prompt-managed work is status-only, evidence is view and export only, and
 * safe operations are web-triggered jobs. The dashboard's area pages and
 * ownership badges are driven entirely by this report, so the
 * classification here is the single place the three-way split lives.
 */

export type InventoryClass = 'web' | 'prompt' | 'evidence' | 'operation';
export type InventoryOwner = 'you' | 'paqad' | 'shared';
export type DashboardArea =
  'pulse' | 'approvals' | 'trust' | 'build' | 'automation' | 'knowledge' | 'setup';

export interface InventoryItemState {
  /** True when the source of truth exists on disk. */
  exists: boolean;
  /** One short sentence describing the live state. */
  detail: string;
  /** Optional count behind the detail (files, entries, pending items). */
  count?: number;
}

export interface InventoryItem {
  key: string;
  /** Display name, benefit-led where the spec provides one. */
  name: string;
  /** The why-sentence rendered under the card title (spec section 9 voice). */
  why: string;
  class: InventoryClass;
  managedBy: InventoryOwner;
  area: DashboardArea;
  /** Hash route of the area page that renders this item. */
  route: string;
  /** Project-relative source of truth (posix). */
  source: string;
  state: InventoryItemState;
}

export interface InventoryReport {
  schemaVersion: 1;
  generatedAt: string;
  items: InventoryItem[];
}

export interface InventoryOptions {
  /** Override for the user-level paqad home (defaults to ~/.paqad-ai). */
  paqadHome?: string;
  now?: number;
}

function countFilesRecursive(dir: string, extensions: string[]): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        total += 1;
      }
    }
  }
  return total;
}

function countEntries(dir: string, suffix?: string): number {
  if (!existsSync(dir)) return 0;
  try {
    const entries = readdirSync(dir);
    return suffix === undefined
      ? entries.filter((name) => !name.startsWith('.')).length
      : entries.filter((name) => name.endsWith(suffix)).length;
  } catch {
    return 0;
  }
}

/**
 * Count feature bundles that carry a `specification.json` (issue #343 A3). The frozen spec
 * moved out of the retired `.paqad/specs` dir into each feature bundle, so the dashboard's
 * "specs" tile now reflects the bundle model. Best-effort: a missing feature-evidence dir
 * counts as zero.
 */
function countFeatureSpecs(projectRoot: string): number {
  let count = 0;
  for (const dirName of listFeatureDirs(projectRoot)) {
    if (existsSync(join(projectRoot, featureFilePath(dirName, 'specification')))) count += 1;
  }
  return count;
}

function countLines(file: string): number {
  if (!existsSync(file)) return 0;
  try {
    const content = readFileSync(file, 'utf8');
    return content.split('\n').filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

function parseYamlFile(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = YAML.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function presence(
  exists: boolean,
  presentDetail: string,
  missingDetail: string,
): InventoryItemState {
  return { exists, detail: exists ? presentDetail : missingDetail };
}

function counted(
  count: number,
  singular: string,
  plural: string,
  zero: string,
): InventoryItemState {
  if (count === 0) return { exists: false, detail: zero, count };
  return {
    exists: true,
    detail: `${count} ${count === 1 ? singular : plural}`,
    count,
  };
}

export function buildInventory(
  projectRoot: string,
  options: InventoryOptions = {},
): InventoryReport {
  const paqadHome = options.paqadHome ?? join(homedir(), '.paqad-ai');
  const at = (relative: string): string => join(projectRoot, relative);

  const profile = parseYamlFile(at(PATHS.PROJECT_PROFILE));
  const activeCapabilities = Array.isArray(profile?.active_capabilities)
    ? (profile.active_capabilities as string[])
    : [];
  const intelligence = (profile?.intelligence ?? null) as { rag_enabled?: unknown } | null;

  const moduleMap = parseYamlFile(at(PATHS.MODULE_MAP));
  const moduleCount = Array.isArray(moduleMap?.modules) ? moduleMap.modules.length : 0;

  const pendingPauses = countEntries(at(PATHS.DECISIONS_PENDING_DIR), '.json');
  const moduleProposals = countEntries(at(PATHS.PROSPECTIVE_DECISIONS_DIR), '.json');

  const providerEntries = [
    PATHS.CLAUDE_MD,
    PATHS.AGENTS_MD,
    PATHS.ANTIGRAVITY_MD,
    PATHS.GEMINI_MD,
  ].filter((entry) => existsSync(at(entry)));

  const packCount =
    countEntries(join(paqadHome, 'packs')) + countEntries(at(join('.paqad', 'packs')));
  const patternCount = countFilesRecursive(join(paqadHome, 'patterns'), ['.json', '.md', '.yaml']);

  const driftReport = (() => {
    if (!existsSync(at(PATHS.MODULE_MAP_DRIFT))) return null;
    try {
      return JSON.parse(readFileSync(at(PATHS.MODULE_MAP_DRIFT), 'utf8')) as {
        findings?: unknown[];
      };
    } catch {
      return null;
    }
  })();

  const items: InventoryItem[] = [
    // ── Web-managed (spec section 3A) ────────────────────────────────────
    {
      key: 'instructions',
      name: 'Canonical instructions',
      why: 'One source of truth every agent reads first.',
      class: 'web',
      managedBy: 'you',
      area: 'knowledge',
      route: '#/knowledge',
      source: PATHS.INSTRUCTIONS_DIR,
      state: counted(
        countFilesRecursive(at(PATHS.INSTRUCTIONS_DIR), ['.md', '.yml', '.yaml']),
        'file',
        'files',
        'No instruction files yet',
      ),
    },
    {
      key: 'workflows',
      name: 'Workflow definitions',
      why: 'Each prompt like create documentation routes to a guided process.',
      class: 'web',
      managedBy: 'you',
      area: 'automation',
      route: '#/automation',
      source: PATHS.WORKFLOWS_DIR,
      state: counted(
        countEntries(at(PATHS.WORKFLOWS_DIR), '.yaml') +
          countEntries(at(PATHS.WORKFLOWS_DIR), '.yml'),
        'workflow file',
        'workflow files',
        'No workflow files yet',
      ),
    },
    {
      key: 'delivery-policy',
      name: 'Delivery policy',
      why: 'What ships on its own, what waits for you.',
      class: 'web',
      managedBy: 'you',
      area: 'automation',
      route: '#/automation',
      source: `${PATHS.WORKFLOWS_DIR}/delivery-policy.yaml`,
      state: presence(
        existsSync(at(join(PATHS.WORKFLOWS_DIR, 'delivery-policy.yaml'))),
        'Policy file present',
        'Using framework defaults',
      ),
    },
    {
      key: 'module-map',
      name: 'Module map',
      why: 'What exists in your codebase, kept truthful automatically.',
      class: 'web',
      managedBy: 'shared',
      area: 'build',
      route: '#/build',
      source: PATHS.MODULE_MAP,
      state: counted(moduleCount, 'module', 'modules', 'No module map yet'),
    },
    {
      key: 'profile',
      name: 'Project profile',
      why: 'The central configuration every workflow reads.',
      class: 'web',
      managedBy: 'you',
      area: 'setup',
      route: '#/setup',
      source: PATHS.PROJECT_PROFILE,
      state: presence(profile !== null, 'Profile present', 'No profile yet'),
    },
    {
      key: 'capabilities',
      name: 'Capabilities',
      why: 'Switch feature areas on and off.',
      class: 'web',
      managedBy: 'you',
      area: 'setup',
      route: '#/setup',
      source: PATHS.PROJECT_PROFILE,
      state: counted(
        activeCapabilities.length,
        'capability active',
        'capabilities active',
        'None active',
      ),
    },
    {
      key: 'packs',
      name: 'Stack packs',
      why: 'Stack-specific rules and patterns for your frameworks.',
      class: 'web',
      managedBy: 'you',
      area: 'setup',
      route: '#/setup',
      source: '~/.paqad-ai/packs',
      state: counted(packCount, 'pack installed', 'packs installed', 'No packs installed'),
    },
    {
      key: 'providers',
      name: 'Provider adapters',
      why: 'The same governance for every AI tool you use.',
      class: 'web',
      managedBy: 'you',
      area: 'setup',
      route: '#/setup',
      source: PATHS.CLAUDE_MD,
      state: counted(
        providerEntries.length,
        'entry file present',
        'entry files present',
        'No entry files yet',
      ),
    },
    {
      key: 'rag',
      name: 'RAG configuration',
      why: 'Your AI finds the right code by meaning, not filename.',
      class: 'web',
      managedBy: 'shared',
      area: 'knowledge',
      route: '#/knowledge',
      source: PATHS.VECTORS_DIR,
      state: presence(
        intelligence?.rag_enabled === true && existsSync(at(PATHS.VECTORS_DIR)),
        'Enabled with an index',
        intelligence?.rag_enabled === true ? 'Enabled, index not built' : 'Disabled',
      ),
    },
    {
      key: 'design-tokens',
      name: 'Design tokens',
      why: 'The AI builds UI that matches your brand.',
      class: 'web',
      managedBy: 'shared',
      area: 'knowledge',
      route: '#/knowledge',
      source: PATHS.DESIGN_TOKENS_FILE,
      state: presence(
        existsSync(at(PATHS.DESIGN_TOKENS_FILE)),
        'Token source present',
        'Not seeded yet',
      ),
    },
    {
      key: 'patterns',
      name: 'Defect pattern library',
      why: 'Mistakes from past projects, remembered so they never repeat.',
      class: 'web',
      managedBy: 'shared',
      area: 'build',
      route: '#/build',
      source: '~/.paqad-ai/patterns',
      state: counted(patternCount, 'pattern stored', 'patterns stored', 'No patterns yet'),
    },
    {
      key: 'approvals',
      name: 'Decisions and approvals',
      why: 'Nothing risky proceeds without you.',
      class: 'web',
      managedBy: 'shared',
      area: 'approvals',
      route: '#/approvals',
      source: PATHS.DECISIONS_DIR,
      state: counted(
        pendingPauses + moduleProposals,
        'item waiting on you',
        'items waiting on you',
        'Nothing needs you',
      ),
    },

    // ── Prompt-managed (spec section 3B) ─────────────────────────────────
    {
      key: 'workflow-runs',
      name: 'Workflow execution',
      why: 'The actual work happens in the conversation.',
      class: 'prompt',
      managedBy: 'paqad',
      area: 'automation',
      route: '#/automation',
      source: PATHS.WORKFLOW_RUNS_DIR,
      state: counted(
        countEntries(at(PATHS.WORKFLOW_RUNS_DIR)),
        'run recorded',
        'runs recorded',
        'No runs yet',
      ),
    },
    {
      key: 'specs',
      name: 'Spec authoring',
      why: 'Specs drive obligations and plans.',
      class: 'prompt',
      managedBy: 'paqad',
      area: 'automation',
      route: '#/automation',
      source: PATHS.FEATURE_EVIDENCE_DIR,
      state: counted(countFeatureSpecs(projectRoot), 'spec', 'specs', 'No specs yet'),
    },
    {
      key: 'module-proposals',
      name: 'Module decision extraction',
      why: 'New modules proposed from prompts land in your inbox.',
      class: 'prompt',
      managedBy: 'paqad',
      area: 'approvals',
      route: '#/approvals',
      source: PATHS.PROSPECTIVE_DECISIONS_DIR,
      state: counted(
        moduleProposals,
        'proposal recorded',
        'proposals recorded',
        'No proposals yet',
      ),
    },
    {
      key: 'session',
      name: 'Session handoff and context budget',
      why: 'Work continues across sessions.',
      class: 'prompt',
      managedBy: 'paqad',
      area: 'automation',
      route: '#/automation',
      source: PATHS.HANDOFF,
      state: presence(existsSync(at(PATHS.HANDOFF)), 'Handoff recorded', 'No handoff yet'),
    },

    // ── Evidence (spec section 3C) ───────────────────────────────────────
    {
      key: 'evidence-ledger',
      name: 'Evidence ledger',
      why: 'A permanent record no one can quietly rewrite.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'trust',
      route: '#/trust',
      source: PATHS.EVIDENCE_LEDGER,
      state: counted(countLines(at(PATHS.EVIDENCE_LEDGER)), 'entry', 'entries', 'No entries yet'),
    },
    {
      key: 'receipts',
      name: 'Receipts',
      why: 'Who wrote it, who vouched for it, sealed.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'trust',
      route: '#/trust',
      source: PATHS.EVIDENCE_RECEIPT_CHAIN,
      state: counted(
        countLines(at(PATHS.EVIDENCE_RECEIPT_CHAIN)),
        'receipt',
        'receipts',
        'No receipts yet',
      ),
    },
    {
      key: 'ai-bom',
      name: 'AI bill of materials',
      why: 'Exactly which AI models touched your code.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'trust',
      route: '#/trust',
      source: PATHS.EVIDENCE_AI_BOM,
      state: presence(existsSync(at(PATHS.EVIDENCE_AI_BOM)), 'Document present', 'No document yet'),
    },
    {
      key: 'audit-log',
      name: 'Audit log',
      why: 'Every framework update and every web edit, recorded.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'trust',
      route: '#/trust',
      source: PATHS.AUDIT_LOG,
      state: counted(countLines(at(PATHS.AUDIT_LOG)), 'entry', 'entries', 'No entries yet'),
    },
    {
      key: 'module-events',
      name: 'Module events',
      why: 'Who changed which module, when.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'build',
      route: '#/build',
      source: PATHS.MODULE_MAP_EVENTS_LOG,
      state: counted(
        countLines(at(PATHS.MODULE_MAP_EVENTS_LOG)),
        'event',
        'events',
        'No events yet',
      ),
    },
    {
      key: 'module-map-drift',
      name: 'Module map drift report',
      why: 'Where docs and reality diverge.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'build',
      route: '#/build',
      source: PATHS.MODULE_MAP_DRIFT,
      state:
        driftReport === null
          ? { exists: false, detail: 'No reconcile run yet' }
          : counted(
              Array.isArray(driftReport.findings) ? driftReport.findings.length : 0,
              'finding',
              'findings',
              'No drift found',
            ),
    },
    {
      key: 'module-health',
      name: 'Module health',
      why: 'Test status and coverage per module.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'build',
      route: '#/build',
      source: PATHS.PLANNING_MODULE_HEALTH_DIR,
      state: counted(
        countEntries(at(PATHS.PLANNING_MODULE_HEALTH_DIR)),
        'module tracked',
        'modules tracked',
        'No health data yet',
      ),
    },
    {
      key: 'stack-snapshot',
      name: 'Stack snapshot and drift',
      why: 'Your real stack, and when it shifts.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'build',
      route: '#/build',
      source: PATHS.STACK_SNAPSHOT,
      state: presence(existsSync(at(PATHS.STACK_SNAPSHOT)), 'Snapshot present', 'No snapshot yet'),
    },
    {
      key: 'compliance',
      name: 'Compliance reports',
      why: 'Spec obligations covered by tests.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'build',
      route: '#/build',
      source: PATHS.TRACEABILITY_MAP,
      state: presence(
        existsSync(at(PATHS.TRACEABILITY_MAP)),
        'Map present',
        'No compliance run yet',
      ),
    },
    {
      key: 'quality-baseline',
      name: 'Quality baseline',
      why: 'Quality can improve, never silently slip.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'build',
      route: '#/build',
      source: PATHS.QUALITY_BASELINE,
      state: presence(
        existsSync(at(PATHS.QUALITY_BASELINE)),
        'Baseline recorded',
        'No baseline yet',
      ),
    },
    {
      key: 'pentest',
      name: 'Pentest findings and retests',
      why: 'Security posture over time.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'build',
      route: '#/build',
      source: PATHS.PENTEST_RUNS_DIR,
      state: counted(
        countEntries(at(PATHS.PENTEST_RUNS_DIR)),
        'run',
        'runs',
        'No pentest runs yet',
      ),
    },
    {
      key: 'rule-compliance',
      name: 'Rule compliance results',
      why: 'Project rules enforced on changes.',
      class: 'evidence',
      managedBy: 'paqad',
      area: 'build',
      route: '#/build',
      source: PATHS.RULE_SCRIPTS_REPORT,
      state: presence(existsSync(at(PATHS.RULE_SCRIPTS_REPORT)), 'Report present', 'No report yet'),
    },

    // ── Safe operations (spec section 3D) ────────────────────────────────
    {
      key: 'operations',
      name: 'Safe operations',
      why: 'One-click maintenance through the same code paths as the CLI.',
      class: 'operation',
      managedBy: 'shared',
      area: 'setup',
      route: '#/setup',
      source: '.paqad',
      state: {
        exists: true,
        detail: 'Reconcile, refresh, rebuild, doctor and update run as audited jobs',
        count: 10,
      },
    },
  ];

  return {
    schemaVersion: 1,
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    items,
  };
}
