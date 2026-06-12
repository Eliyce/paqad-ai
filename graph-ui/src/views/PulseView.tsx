import { useCallback, useEffect, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { EmptyState } from '../components/EmptyState';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { StatCard } from '../components/StatCard';
import { WhySentence } from '../components/WhySentence';
import {
  fetchApprovals,
  fetchAudit,
  fetchDashboard,
  fetchEvidence,
  fetchOnboardingChecklist,
  fetchReceipts,
} from '../lib/api';
import { PAGE_WHY } from '../lib/copy';
import type {
  AttentionItem,
  AuditFeedEntry,
  DashboardReport,
  EvidenceRow,
  OnboardingChecklist as OnboardingChecklistData,
  ScoreBand,
} from '../lib/dashboard-types';
import { useHashRoute, type Route } from '../lib/router';

const BAND_COLOR: Record<ScoreBand, string> = {
  green: 'var(--color-mod-green)',
  amber: 'var(--color-mod-amber)',
  red: 'var(--color-mod-red)',
  unknown: 'var(--color-mod-unknown)',
};

const SEVERITY_COLOR: Record<AttentionItem['severity'], string> = {
  info: 'var(--color-mod-unknown)',
  warn: 'var(--color-mod-amber)',
  critical: 'var(--color-mod-red)',
};

/** Where each report section lives in the seven-area IA. */
const SECTION_AREA: Partial<Record<string, Route>> = {
  architecture: 'build',
  'module-docs': 'build',
  'module-events': 'build',
  'module-health': 'build',
  'module-map-drift': 'build',
  'stack-drift': 'build',
  'tech-debt': 'build',
  pentest: 'build',
  'rule-compliance': 'build',
  decisions: 'approvals',
  'module-decisions': 'approvals',
  attestation: 'trust',
  delivery: 'automation',
  workflows: 'automation',
  session: 'automation',
  rules: 'knowledge',
  'design-system': 'knowledge',
  'rag-status': 'knowledge',
  'framework-version': 'setup',
  'project-profile': 'setup',
  registries: 'setup',
  stack: 'setup',
  tools: 'setup',
};

const VERDICT_COLOR: Record<EvidenceRow['verdict'], string> = {
  pass: 'var(--color-mod-green)',
  fail: 'var(--color-mod-red)',
  inconclusive: 'var(--color-mod-amber)',
  blocked: 'var(--color-mod-amber)',
};

interface ActivityItem {
  key: string;
  ts: string | null;
  text: string;
  dot: string;
}

/** "4m ago" style relative time. Tiny on purpose, no dependency. */
function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return '';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

/** One sentence per dashboard-actor audit action (issue #146 polish). */
function auditSentence(entry: AuditFeedEntry): string {
  const action = entry.action ?? '';
  if (/^dashboard\.config\..+\.write$/.test(action)) {
    const segment = action.split('.')[2] ?? 'settings';
    return 'You saved ' + segment.replace(/-/g, ' ') + ' on the web.';
  }
  if (action === 'dashboard.instructions.write') return 'You edited an instruction file.';
  if (action.startsWith('dashboard.ops.')) {
    const op = action.split('.')[2] ?? action;
    const status = /(?:^|\s)status="([^"]+)"/.exec(entry.raw)?.[1] ?? 'finished';
    return 'Operation ' + op + ' ' + status + '.';
  }
  if (action.includes('resolve') || action.includes('accept')) return 'A decision was resolved.';
  return action;
}

/** Merge gate evidence and dashboard-actor audit lines, newest first, ten. */
function buildActivity(rows: EvidenceRow[], entries: AuditFeedEntry[]): ActivityItem[] {
  const items: ActivityItem[] = rows.map((row) => ({
    key: 'evidence:' + row.content_hash + row.ts,
    ts: row.ts,
    text: 'Gate ' + row.code + ' ' + row.verdict + '.',
    dot: VERDICT_COLOR[row.verdict],
  }));
  for (const entry of entries) {
    if (entry.actor !== 'dashboard' || entry.action === null) continue;
    items.push({
      key: 'audit:' + (entry.ts ?? '') + entry.raw,
      ts: entry.ts,
      text: auditSentence(entry),
      dot: 'var(--color-mod-unknown)',
    });
  }
  items.sort((a, b) => {
    if (a.ts === null && b.ts === null) return 0;
    if (a.ts === null) return 1;
    if (b.ts === null) return -1;
    return b.ts.localeCompare(a.ts);
  });
  return items.slice(0, 10);
}

/**
 * Pulse — the home page of the comprehension layer (issue #146). One
 * health number, four stats, and at most five things worth attention,
 * each deep-linked to the area that explains it.
 */
export function PulseView() {
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [receiptCount, setReceiptCount] = useState<number | null>(null);
  const [checklist, setChecklist] = useState<OnboardingChecklistData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const { navigate } = useHashRoute();

  const loadAll = useCallback((): void => {
    fetchDashboard()
      .then((next) => {
        setReport(next);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    fetchApprovals()
      .then((feed) => setPendingCount(feed.pendingCount))
      .catch(() => setPendingCount(null));
    fetchReceipts()
      .then((feed) => setReceiptCount(feed.receipts.length))
      .catch(() => setReceiptCount(null));
    fetchOnboardingChecklist()
      .then(setChecklist)
      .catch(() => setChecklist(null));
    Promise.all([fetchEvidence({}), fetchAudit(50)])
      .then(([evidenceFeed, auditPage]) =>
        setActivity(buildActivity(evidenceFeed.rows, auditPage.entries)),
      )
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    source.addEventListener('dashboard-updated', () => loadAll());
    return () => {
      source.close();
    };
  }, [loadAll]);

  const scored = report?.sections.filter((s) => s.score !== null) ?? [];
  const healthy = scored.filter((s) => s.band === 'green').length;
  const topAttention = report?.attention[0] ?? null;
  const healthSentence = topAttention ? topAttention.message : 'Healthy.';

  return (
    <DashboardChrome
      projectName={report?.projectName ?? null}
      frameworkVersion={report?.frameworkVersion ?? null}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-3xl p-6">
        <h1 className="text-page font-semibold">Pulse</h1>
        <WhySentence>{PAGE_WHY.pulse}</WhySentence>

        {error && (
          <div
            className="mt-4 rounded-[10px] border p-4 text-secondary"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load the pulse: {error}
          </div>
        )}

        {report?.notOnboarded && (
          <div className="mt-6">
            <EmptyState
              what="This is where your project's pulse will live. Run your first workflow and watch the first gate pass."
              why="Once onboarded, every change is scored, checked and summarized here, so you never have to read logs to know where you stand."
              actionLabel="Start onboarding"
              onAction={() => navigate('setup')}
            />
          </div>
        )}

        {report && !report.notOnboarded && (
          <>
            {checklist && <OnboardingChecklist data={checklist} />}

            <div className="mt-6 rounded-[10px] p-5" style={{ background: 'var(--color-surface)' }}>
              <div className="flex items-baseline gap-3">
                <span className="text-stat font-semibold">
                  {report.overallScore !== null ? String(report.overallScore) : '…'}
                </span>
                <span className="flex items-center gap-1.5 text-secondary">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: BAND_COLOR[report.overallBand] }}
                  />
                  <span style={{ color: 'var(--color-muted)' }}>{report.overallBand}</span>
                </span>
              </div>
              <div className="mt-1 text-secondary" style={{ color: 'var(--color-muted)' }}>
                {healthSentence}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                value={pendingCount !== null ? String(pendingCount) : '…'}
                label="Pending approvals"
                onClick={() => navigate('approvals')}
              />
              <StatCard
                value={healthy + ' / ' + scored.length}
                label="Sections healthy"
                onClick={() => navigate('build')}
              />
              <StatCard
                value={receiptCount !== null ? String(receiptCount) : '…'}
                label="Receipts sealed"
                onClick={() => navigate('trust')}
              />
              <StatCard
                value={report.frameworkVersion ? 'v' + report.frameworkVersion : '…'}
                label="Framework version"
                onClick={() => navigate('setup')}
              />
            </div>

            {report.attention.length > 0 && (
              <div className="mt-6">
                <h2 className="text-section font-medium">Worth your attention</h2>
                <div className="mt-2 flex flex-col gap-1">
                  {report.attention.slice(0, 5).map((item) => (
                    <button
                      key={item.sectionId + item.message}
                      type="button"
                      className="flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left text-secondary"
                      style={{ color: 'var(--color-canvas-fg)' }}
                      title={item.severity + ' · opens the area that explains it'}
                      onClick={() => navigate(SECTION_AREA[item.sectionId] ?? 'dashboard')}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: SEVERITY_COLOR[item.severity] }}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.message}</span>
                      <span
                        className="shrink-0 text-caption"
                        style={{ color: 'var(--color-muted)' }}
                      >
                        {item.severity}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activity.length > 0 && (
              <div className="mt-6">
                <h2 className="text-section font-medium">Recent activity</h2>
                <div className="mt-2 flex flex-col gap-1">
                  {activity.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-secondary"
                      style={{ color: 'var(--color-canvas-fg)' }}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: item.dot }}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.text}</span>
                      {item.ts !== null && (
                        <span
                          className="shrink-0 text-caption"
                          style={{ color: 'var(--color-muted)' }}
                        >
                          {relativeTime(item.ts)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!report && !error && (
          <div className="mt-6 text-secondary" style={{ color: 'var(--color-muted)' }}>
            Loading…
          </div>
        )}
      </div>
    </DashboardChrome>
  );
}
