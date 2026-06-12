import { useCallback, useEffect, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { actOnModuleProposal, fetchApprovals, fetchDashboard, resolvePause } from '../lib/api';
import { PAGE_WHY } from '../lib/copy';
import type {
  ApprovalsFeed,
  ApprovalsPauseItem,
  ApprovalsProposalItem,
} from '../lib/dashboard-types';

const WIN_LINE = 'Done. The agent continues with your choice.';

function ageLabel(createdAt: string): string {
  const ms = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return days + (days === 1 ? ' day' : ' days') + ' waiting';
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return hours + (hours === 1 ? ' hour' : ' hours') + ' waiting';
  return 'just now';
}

/** One resolved-this-session card: collapsed, win line only. */
function WinCard({ title }: { title: string }) {
  return (
    <div
      className="rounded-lg border p-4 text-sm"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div style={{ color: 'var(--color-muted)' }}>{title}</div>
      <div className="mt-1 flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: 'var(--color-accent)' }}
        />
        <span>{WIN_LINE}</span>
      </div>
    </div>
  );
}

function PauseCard({
  item,
  onResolved,
}: {
  item: ApprovalsPauseItem;
  onResolved: (winTitle: string) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (optionKey: string): void => {
    setBusyKey(optionKey);
    setError(null);
    resolvePause(item.id, optionKey)
      .then(() => {
        onResolved(item.question);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusyKey(null));
  };

  return (
    <div
      className="rounded-lg border p-4 text-sm"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-canvas-fg)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium">{item.question}</div>
        <span className="shrink-0 text-xs" style={{ color: 'var(--color-muted)' }}>
          {item.id} · {ageLabel(item.created_at)}
        </span>
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
        {item.context}
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
        Asked by {item.requested_by} · {item.category}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {item.options.map((option) => {
          const recommended = item.recommendation === option.option_key;
          return (
            <button
              key={option.option_key}
              type="button"
              disabled={busyKey !== null}
              className="rounded-md border px-3 py-2 text-left disabled:opacity-50"
              style={{
                borderColor: recommended ? 'var(--color-accent)' : 'var(--color-border)',
                background: 'var(--color-canvas)',
              }}
              onClick={() => choose(option.option_key)}
            >
              <span className="font-medium">
                {busyKey === option.option_key ? 'Saving…' : option.label}
              </span>
              {recommended && (
                <span className="ml-2 text-xs" style={{ color: 'var(--color-accent)' }}>
                  recommended
                </span>
              )}
              <span className="mt-0.5 block text-xs" style={{ color: 'var(--color-muted)' }}>
                {option.one_line_preview} {option.trade_off}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <div className="mt-2 text-xs" style={{ color: 'var(--color-mod-red)' }}>
          {error} Your choice was not saved. Try again or resolve it in the conversation.
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  item,
  onResolved,
}: {
  item: ApprovalsProposalItem;
  onResolved: (winTitle: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = (action: 'accept' | 'reject'): void => {
    setBusy(true);
    setError(null);
    actOnModuleProposal(item.id, action)
      .then(() => {
        onResolved(
          action === 'accept'
            ? 'Module ' + item.proposed_slug + ' accepted. The map gains it on the next apply.'
            : 'Module ' + item.proposed_slug + ' rejected.',
        );
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="rounded-lg border p-4 text-sm"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-canvas-fg)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium">
          New module proposed: {item.proposed_name} ({item.proposed_slug})
        </div>
        <span className="shrink-0 text-xs" style={{ color: 'var(--color-muted)' }}>
          {item.id} · {item.confidence} confidence
        </span>
      </div>
      {item.reasoning && (
        <div className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          {item.reasoning}
        </div>
      )}
      {item.prompt_excerpt && (
        <div className="mt-1 text-xs italic" style={{ color: 'var(--color-muted)' }}>
          “{item.prompt_excerpt}”
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-md border px-3 py-1.5 disabled:opacity-50"
          style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
          onClick={() => act('accept')}
        >
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border px-3 py-1.5 disabled:opacity-50"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          onClick={() => act('reject')}
        >
          Reject
        </button>
      </div>
      <div className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
        Accept: the module map gains {item.proposed_slug}, keeping your architecture map truthful.
        Reject: the proposal is closed and nothing changes.
      </div>
      {error && (
        <div className="mt-2 text-xs" style={{ color: 'var(--color-mod-red)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * The Approvals inbox (issue #146). One list of everything waiting on the
 * human: decision pauses and module proposals. Resolutions write to the same
 * stores the agent reads, so the conversation picks them up on its next call.
 */
export function ApprovalsView() {
  const [feed, setFeed] = useState<ApprovalsFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  /** Items resolved in this browser session — kept visible as win lines. */
  const [resolved, setResolved] = useState<{ id: string; title: string }[]>([]);

  const loadFeed = useCallback((): void => {
    fetchApprovals()
      .then((next) => {
        setFeed(next);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    loadFeed();
    fetchDashboard()
      .then((report) => {
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
      })
      .catch(() => {
        // chrome falls back to placeholders; the feed error is the one that matters
      });
  }, [loadFeed]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    source.addEventListener('dashboard-updated', () => loadFeed());
    return () => {
      source.close();
    };
  }, [loadFeed]);

  const onItemResolved = (id: string) => (winTitle: string) => {
    setResolved((prev) => [...prev, { id, title: winTitle }]);
    loadFeed();
  };

  const items: (ApprovalsPauseItem | ApprovalsProposalItem)[] = feed
    ? [...feed.pauses, ...feed.proposals]
        .filter((item) => !resolved.some((r) => r.id === item.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
          {PAGE_WHY.approvals}
        </p>
        {error && (
          <div
            className="mt-4 rounded-lg border p-4 text-sm"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load the inbox: {error}
          </div>
        )}
        {resolved.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            {resolved.map((entry) => (
              <WinCard key={entry.id} title={entry.title} />
            ))}
          </div>
        )}
        {feed && items.length === 0 && resolved.length === 0 && !error && (
          <div
            className="mt-6 rounded-lg border p-6 text-sm"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-muted)',
            }}
          >
            Nothing needs you. Paqad pauses here the moment something does.
          </div>
        )}
        <div className="mt-4 flex flex-col gap-3">
          {items.map((item) =>
            item.kind === 'pause' ? (
              <PauseCard key={item.id} item={item} onResolved={onItemResolved(item.id)} />
            ) : (
              <ProposalCard key={item.id} item={item} onResolved={onItemResolved(item.id)} />
            ),
          )}
        </div>
        {!feed && !error && (
          <div className="mt-6 text-sm" style={{ color: 'var(--color-muted)' }}>
            Loading…
          </div>
        )}
      </div>
    </DashboardChrome>
  );
}
