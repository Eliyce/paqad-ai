// Pure detectors: each takes already-gathered, normalized inputs and returns
// findings without ids (assigned later). No I/O, no network, no shell — so every
// branch is exercised with fixtures. The impure gather layer lives in `gather.ts`.

import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import type { OsvVulnerabilityRecord } from '@/pentest/osv.js';
import type { HealthFinding } from '@/core/types/codebase-health.js';

import { HEALTH_WHY_IT_MATTERS } from './copy.js';

/** A finding before its content-addressed id is assigned. */
export type HealthCandidate = Omit<HealthFinding, 'id'>;

export interface SecretMatch {
  file: string;
  line: number;
  rule: string;
  /** A stable, non-reversible fingerprint of the secret — never the bytes. */
  fingerprint: string;
  source: 'gitleaks' | 'builtin-regex';
}

export interface DuplicationBlock {
  file: string;
  start_line: number;
  end_line: number;
}

export interface DuplicationCluster {
  lines: number;
  blocks: DuplicationBlock[];
  source: 'jscpd' | 'similarity';
}

export interface DeprecationRecord {
  package: string;
  version: string;
  ecosystem: string;
  message: string;
  kind: 'deprecated' | 'abandoned' | 'eol';
}

export interface StaleDocCandidate {
  doc: string;
  reason: string;
  referenced_sources: string[];
}

/** True when a package is corroborated by a second signal (raises confidence). */
export interface ToolCorroboration {
  unusedDependencies?: Set<string>;
  deadFiles?: Set<string>;
}

function reason(category: HealthFinding['category']): string {
  return HEALTH_WHY_IT_MATTERS[category];
}

/** Declared-but-never-imported dependencies (code-knowledge index `imported:false`). */
export function detectUnusedDependencies(
  index: CodeKnowledgeIndex,
  corroboration: ToolCorroboration = {},
): HealthCandidate[] {
  return index.dependencies
    .filter((dependency) => !dependency.imported)
    .map((dependency) => {
      const corroborated = corroboration.unusedDependencies?.has(dependency.name) ?? false;
      return {
        title: `Unused dependency: ${dependency.name}`,
        description: reason('unused-dependency'),
        category: 'unused-dependency' as const,
        severity: 'low' as const,
        tier: 'deterministic' as const,
        confidence: corroborated ? 0.95 : 0.85,
        evidence: [
          `code-knowledge index: ${dependency.name} (${dependency.ecosystem}) is declared but never imported.`,
          corroborated
            ? `Corroborated by knip.`
            : `Source: .paqad/indexes/code-knowledge.json (dependencies[].imported === false).`,
          `Reproduce: npx paqad-ai index build && npx paqad-ai index query ${dependency.name}`,
        ],
        suggestion: {
          action: 'remove' as const,
          detail: `Remove ${dependency.name} from the manifest if nothing imports it, or add an import if it is a runtime-only dependency.`,
        },
        affected_files: [],
        affected_packages: [dependency.name],
        requires_network: false,
        baseline_status: 'unknown' as const,
        status: 'open' as const,
      };
    });
}

/** Orphan files and exported symbols with no production callers (dead code). */
export function detectDeadCode(index: CodeKnowledgeIndex): HealthCandidate[] {
  const findings: HealthCandidate[] = [];

  for (const file of index.files) {
    if (!file.orphan) continue;
    findings.push({
      title: `Dead file: ${file.path}`,
      description: reason('dead-code'),
      category: 'dead-code',
      severity: 'medium',
      tier: 'deterministic',
      confidence: 0.85,
      evidence: [
        `code-knowledge index: ${file.path} is imported by 0 files and is not an entry point.`,
        `Source: .paqad/indexes/code-knowledge.json (files[].orphan === true).`,
        `Reproduce: npx paqad-ai index query ${file.path}`,
      ],
      suggestion: {
        action: 'remove',
        detail: `Delete ${file.path} if it is truly unreachable, or wire it to an entry point if it should be used.`,
      },
      affected_files: [file.path],
      affected_packages: [],
      requires_network: false,
      baseline_status: 'unknown',
      status: 'open',
    });
  }

  for (const symbol of index.symbols) {
    if (!symbol.exported || symbol.caller_count !== 0 || symbol.orphan === false) continue;
    // A symbol in an orphan file is already covered by the file finding above.
    if (index.files.some((file) => file.path === symbol.file && file.orphan)) continue;
    findings.push({
      title: `Unused export: ${symbol.name} (${symbol.file})`,
      description: reason('dead-code'),
      category: 'dead-code',
      severity: 'low',
      tier: 'deterministic',
      confidence: 0.8,
      evidence: [
        `code-knowledge index: exported ${symbol.kind} ${symbol.name} at ${symbol.file}:${symbol.line} has 0 callers in production code.`,
        `Source: .paqad/indexes/code-knowledge.json (symbols[].caller_count === 0).`,
        `Reproduce: npx paqad-ai index query ${symbol.name}`,
      ],
      suggestion: {
        action: 'remove',
        detail: `Remove ${symbol.name} or stop exporting it if it is only used internally.`,
      },
      affected_files: [symbol.file],
      affected_packages: [],
      requires_network: false,
      baseline_status: 'unknown',
      status: 'open',
    });
  }

  return findings;
}

/** Known-vulnerable dependencies from OSV / native audit records. */
export function detectVulnerableDependencies(records: OsvVulnerabilityRecord[]): HealthCandidate[] {
  const seen = new Set<string>();
  const findings: HealthCandidate[] = [];
  for (const record of records) {
    const key = `${record.package_name}@${record.version}:${record.advisory_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      title: `Vulnerable dependency: ${record.package_name}@${record.version} (${record.advisory_id})`,
      description: reason('vulnerable-dependency'),
      category: 'vulnerable-dependency',
      severity: 'high',
      tier: 'deterministic',
      confidence: 0.9,
      evidence: [
        `${record.advisory_id}: ${record.summary || record.details}`.trim(),
        `Source: ${record.ecosystem} advisory for ${record.package_name}@${record.version}.`,
        `Reproduce: osv-scanner --lockfile <your-lockfile> (or the native audit for ${record.ecosystem}).`,
      ],
      suggestion: {
        action: 'update',
        detail: `Upgrade ${record.package_name} past the affected range, or apply the advisory's remediation.`,
      },
      affected_files: [],
      affected_packages: [record.package_name],
      requires_network: false,
      baseline_status: 'unknown',
      status: 'open',
    });
  }
  return findings;
}

/** Deprecated / abandoned / end-of-life packages (registry metadata; online). */
export function detectDeprecatedDependencies(records: DeprecationRecord[]): HealthCandidate[] {
  return records.map((record) => ({
    title: `${record.kind === 'eol' ? 'End-of-life' : 'Deprecated'} package: ${record.package}@${record.version}`,
    description: reason('deprecated-dependency'),
    category: 'deprecated-dependency' as const,
    severity: 'medium' as const,
    tier: 'deterministic' as const,
    confidence: 0.9,
    evidence: [
      `${record.ecosystem} registry marks ${record.package}@${record.version} as ${record.kind}: ${record.message}`,
      `Source: package registry metadata (network).`,
      `Reproduce: npm view ${record.package}@${record.version} deprecated`,
    ],
    suggestion: {
      action: 'update' as const,
      detail: `Migrate off ${record.package} to a maintained alternative, or pin and plan a replacement.`,
    },
    affected_files: [],
    affected_packages: [record.package],
    requires_network: true,
    baseline_status: 'unknown' as const,
    status: 'open' as const,
  }));
}

/** Committed secrets — evidence is REDACTED: location + rule + fingerprint only. */
export function detectSecrets(matches: SecretMatch[]): HealthCandidate[] {
  return matches.map((match) => ({
    title: `Possible secret: ${match.rule} at ${match.file}:${match.line}`,
    description: reason('secret-leak'),
    category: 'secret-leak' as const,
    severity: 'high' as const,
    tier: 'deterministic' as const,
    confidence: match.source === 'gitleaks' ? 0.85 : 0.6,
    evidence: [
      `${match.source === 'gitleaks' ? 'gitleaks' : 'built-in regex (lower confidence)'}: ${match.rule} matched at ${match.file}:${match.line}.`,
      `Fingerprint: ${match.fingerprint} (the secret value is intentionally not recorded).`,
      `Reproduce: gitleaks detect --source . --report-format json (or inspect ${match.file}:${match.line}).`,
    ],
    suggestion: {
      action: 'rotate' as const,
      detail: `Rotate the credential now — deleting the line does not un-leak it — then remove it from history and load it from an environment variable.`,
    },
    affected_files: [match.file],
    affected_packages: [],
    requires_network: false,
    baseline_status: 'unknown' as const,
    status: 'open' as const,
  }));
}

/** Copy-paste blocks (jscpd, or cosine near-duplicate fallback). */
export function detectDuplication(clusters: DuplicationCluster[]): HealthCandidate[] {
  return clusters.map((cluster) => {
    const locations = cluster.blocks
      .map((block) => `${block.file}:${block.start_line}-${block.end_line}`)
      .join(', ');
    return {
      title: `Duplicated block (${cluster.lines} lines) across ${cluster.blocks.length} locations`,
      description: reason('duplication'),
      category: 'duplication' as const,
      severity: 'low' as const,
      tier: 'deterministic' as const,
      confidence: cluster.source === 'jscpd' ? 0.9 : 0.6,
      evidence: [
        `${cluster.source === 'jscpd' ? 'jscpd' : 'chunk-similarity (lower confidence)'}: ${cluster.lines} duplicated lines at ${locations}.`,
        `Source: ${cluster.source === 'jscpd' ? 'jscpd JSON report' : '.paqad/vectors/index.json cosine near-duplicates'}.`,
        `Reproduce: npx jscpd ${cluster.blocks.map((block) => block.file).join(' ')}`,
      ],
      suggestion: {
        action: 'rewrite' as const,
        detail: `Extract the shared logic into one function the duplicates call, so a fix lands once.`,
      },
      affected_files: cluster.blocks.map((block) => block.file),
      affected_packages: [],
      requires_network: false,
      baseline_status: 'unknown' as const,
      status: 'open' as const,
    };
  });
}

/** Stale-doc candidates — AI-judged: the model grades relevance, these never block. */
export function detectStaleDocs(candidates: StaleDocCandidate[]): HealthCandidate[] {
  return candidates.map((candidate) => ({
    title: `Possibly stale doc: ${candidate.doc}`,
    description: reason('stale-doc'),
    category: 'stale-doc' as const,
    severity: 'low' as const,
    tier: 'ai-judged' as const,
    confidence: 0.5,
    evidence: [
      `${candidate.reason}`,
      `References: ${candidate.referenced_sources.join(', ') || '(none detected)'}.`,
      `Reproduce: git log -1 --format=%cI ${candidate.doc}`,
    ],
    suggestion: {
      action: 'rewrite' as const,
      detail: `Re-read ${candidate.doc} against the current code and update or delete the parts that no longer match.`,
    },
    affected_files: [candidate.doc],
    affected_packages: [],
    requires_network: false,
    baseline_status: 'unknown' as const,
    status: 'open' as const,
  }));
}

/** AI-slop candidates — duplication clusters + one-caller wrapper symbols, AI-judged. */
export function detectAiSlop(
  clusters: DuplicationCluster[],
  index: CodeKnowledgeIndex | null,
): HealthCandidate[] {
  const findings: HealthCandidate[] = [];

  for (const cluster of clusters) {
    findings.push({
      title: `Slop candidate: repeated block across ${cluster.blocks.length} files`,
      description: reason('ai-slop'),
      category: 'ai-slop',
      severity: 'low',
      tier: 'ai-judged',
      confidence: 0.45,
      evidence: [
        `Duplication cluster of ${cluster.lines} lines is a common shape of low-value generated code.`,
        `Locations: ${cluster.blocks.map((block) => `${block.file}:${block.start_line}`).join(', ')}.`,
        `Reproduce: review the blocks and judge whether they add value or just bulk.`,
      ],
      suggestion: {
        action: 'rewrite',
        detail: `If these blocks are boilerplate with no real variation, collapse them; otherwise keep and mark reviewed.`,
      },
      affected_files: cluster.blocks.map((block) => block.file),
      affected_packages: [],
      requires_network: false,
      baseline_status: 'unknown',
      status: 'open',
    });
  }

  if (index) {
    for (const symbol of index.symbols) {
      if (!symbol.exported || symbol.caller_count !== 1) continue;
      findings.push({
        title: `Slop candidate: one-caller wrapper ${symbol.name}`,
        description: reason('ai-slop'),
        category: 'ai-slop',
        severity: 'low',
        tier: 'ai-judged',
        confidence: 0.4,
        evidence: [
          `Exported ${symbol.kind} ${symbol.name} at ${symbol.file}:${symbol.line} has exactly one caller — often a needless indirection.`,
          `Source: .paqad/indexes/code-knowledge.json (symbols[].caller_count === 1).`,
          `Reproduce: npx paqad-ai index query ${symbol.name}`,
        ],
        suggestion: {
          action: 'rewrite',
          detail: `If ${symbol.name} only forwards to its single caller, inline it; otherwise keep it.`,
        },
        affected_files: [symbol.file],
        affected_packages: [],
        requires_network: false,
        baseline_status: 'unknown',
        status: 'open',
      });
    }
  }

  return findings;
}
