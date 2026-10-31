import type { OsvVulnerabilityRecord } from '@/pentest/osv.js';

import type { DuplicationCluster, SecretMatch, StaleDocCandidate } from './detectors.js';
import { redactedFingerprint, SECRET_PATTERNS } from './secret-patterns.js';

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function parseOsvScannerJson(raw: string): OsvVulnerabilityRecord[] {
  const parsed = safeParse<{
    results?: Array<{
      packages?: Array<{
        package?: { name?: string; version?: string; ecosystem?: string };
        vulnerabilities?: Array<{ id?: string; summary?: string; details?: string }>;
      }>;
    }>;
  }>(raw);
  if (!parsed?.results) return [];
  const records: OsvVulnerabilityRecord[] = [];
  for (const result of parsed.results) {
    for (const pkg of result.packages ?? []) {
      for (const vuln of pkg.vulnerabilities ?? []) {
        records.push({
          package_name: pkg.package?.name ?? 'unknown',
          ecosystem: pkg.package?.ecosystem ?? 'unknown',
          version: pkg.package?.version ?? 'unknown',
          advisory_id: vuln.id ?? 'UNKNOWN',
          summary: vuln.summary ?? '',
          details: vuln.details ?? '',
        });
      }
    }
  }
  return records;
}

export function parseNpmAuditJson(raw: string): OsvVulnerabilityRecord[] {
  const parsed = safeParse<{
    vulnerabilities?: Record<
      string,
      { name?: string; via?: Array<string | { title?: string; url?: string; source?: number }> }
    >;
  }>(raw);
  if (!parsed?.vulnerabilities) return [];
  const records: OsvVulnerabilityRecord[] = [];
  for (const [name, entry] of Object.entries(parsed.vulnerabilities)) {
    const advisory = (entry.via ?? []).find(
      (via): via is { title?: string; url?: string } => typeof via === 'object',
    );
    if (!advisory) continue;
    records.push({
      package_name: entry.name ?? name,
      ecosystem: 'npm',
      version: 'installed',
      advisory_id: advisory.url ?? advisory.title ?? 'NPM-ADVISORY',
      summary: advisory.title ?? '',
      details: advisory.url ?? '',
    });
  }
  return records;
}

export function parseGitleaksJson(raw: string): SecretMatch[] {
  const parsed = safeParse<
    Array<{
      RuleID?: string;
      File?: string;
      StartLine?: number;
      Fingerprint?: string;
      Secret?: string;
    }>
  >(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => ({
    file: entry.File ?? 'unknown',
    line: entry.StartLine ?? 0,
    rule: entry.RuleID ?? 'secret',
    fingerprint:
      entry.Fingerprint ?? redactedFingerprint(entry.Secret ?? `${entry.File}:${entry.StartLine}`),
    source: 'gitleaks' as const,
  }));
}

export function parseJscpdJson(raw: string): DuplicationCluster[] {
  const parsed = safeParse<{
    duplicates?: Array<{
      lines?: number;
      firstFile?: { name?: string; start?: number; end?: number };
      secondFile?: { name?: string; start?: number; end?: number };
    }>;
  }>(raw);
  if (!parsed?.duplicates) return [];
  return parsed.duplicates
    .map((dup) => {
      const blocks = [dup.firstFile, dup.secondFile]
        .filter((file): file is { name?: string; start?: number; end?: number } => Boolean(file))
        .map((file) => ({
          file: file.name ?? 'unknown',
          start_line: file.start ?? 0,
          end_line: file.end ?? 0,
        }));
      return { lines: dup.lines ?? 0, blocks, source: 'jscpd' as const };
    })
    .filter((cluster) => cluster.blocks.length > 0);
}

export function builtinSecretScan(files: Array<{ path: string; content: string }>): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index]!;
      for (const { rule, pattern } of SECRET_PATTERNS) {
        const found = pattern.exec(text);
        if (!found) continue;
        matches.push({
          file: file.path,
          line: index + 1,
          rule,
          fingerprint: redactedFingerprint(found[0]),
          source: 'builtin-regex',
        });
      }
    }
  }
  return matches;
}

export interface DocTimestampInput {
  doc: string;
  doc_committed_at: number | null;
  references: Array<{ source: string; committed_at: number | null }>;
}

export function gatherStaleDocCandidates(inputs: DocTimestampInput[]): StaleDocCandidate[] {
  const candidates: StaleDocCandidate[] = [];
  for (const input of inputs) {
    if (input.doc_committed_at === null || input.references.length === 0) continue;
    const newerSources = input.references.filter(
      (ref) => ref.committed_at !== null && ref.committed_at > input.doc_committed_at!,
    );
    if (newerSources.length === 0) continue;
    candidates.push({
      doc: input.doc,
      reason: `Doc last changed before ${newerSources.length} of the source file(s) it references.`,
      referenced_sources: newerSources.map((ref) => ref.source),
    });
  }
  return candidates;
}
