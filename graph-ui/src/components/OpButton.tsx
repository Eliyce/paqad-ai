import { useEffect, useRef, useState } from 'react';

import { fetchOpsJob, startOp } from '../lib/api';
import type { OpsAction, OpsJob, OpsProgressEvent } from '../lib/dashboard-types';

import { WinLine } from './WinLine';

interface Props {
  action: OpsAction;
  label: string;
  /**
   * The consequence sentence for destructive actions. When set, the first
   * click swaps the button for an inline confirm (the sentence plus
   * "Go ahead" / "Cancel") instead of a bare are-you-sure.
   */
  confirm?: string;
  /** Win sentence shown for 4 seconds once the job finishes. */
  done?: string;
  onDone?: (job: OpsJob) => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'running'; jobId: string; message: string }
  | { kind: 'done' }
  | { kind: 'failed'; error: string };

/**
 * One dashboard button per ops job (issue #146). Click starts the job via
 * POST /api/ops/{action}; while it runs the button is disabled and shows the
 * latest `ops-progress` SSE message for its jobId, with a light poll as the
 * backstop when the stream drops.
 */
export function OpButton({ action, label, confirm, done, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const jobId = phase.kind === 'running' ? phase.jobId : null;

  const finish = (job: OpsJob): void => {
    if (job.status === 'done') {
      setPhase({ kind: 'done' });
      onDoneRef.current?.(job);
    } else if (job.status === 'failed') {
      setPhase({ kind: 'failed', error: job.error ?? 'The operation failed.' });
    }
  };

  // While running: follow the SSE progress stream and poll as a backstop.
  useEffect(() => {
    if (jobId === null) return undefined;
    const source = new EventSource('/api/events');
    source.addEventListener('ops-progress', (event) => {
      let payload: OpsProgressEvent;
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as OpsProgressEvent;
      } catch {
        return;
      }
      if (payload.jobId !== jobId) return;
      if (payload.status === 'running') {
        setPhase({ kind: 'running', jobId, message: payload.message });
      } else {
        fetchOpsJob(jobId)
          .then(finish)
          .catch(() => undefined);
      }
    });
    const poll = setInterval(() => {
      fetchOpsJob(jobId)
        .then((job) => {
          if (job.status === 'running') {
            const latest = job.progress[job.progress.length - 1];
            if (latest !== undefined) setPhase({ kind: 'running', jobId, message: latest });
          } else {
            finish(job);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      source.close();
      clearInterval(poll);
    };
    // finish is stable in behaviour; the stream rebinds per job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const start = (): void => {
    setPhase({ kind: 'running', jobId: '', message: 'Starting…' });
    startOp(action)
      .then((job) => setPhase({ kind: 'running', jobId: job.id, message: 'Started.' }))
      .catch((err: unknown) => {
        setPhase({ kind: 'failed', error: err instanceof Error ? err.message : String(err) });
      });
  };

  if (phase.kind === 'confirm') {
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-secondary" style={{ color: 'var(--color-canvas-fg)' }}>
          {confirm}
        </span>
        <button
          type="button"
          className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
          style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
          onClick={start}
        >
          Go ahead
        </button>
        <button
          type="button"
          className="rounded-[6px] px-3 py-1.5 text-secondary"
          style={{ color: 'var(--color-muted)' }}
          onClick={() => setPhase({ kind: 'idle' })}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (phase.kind === 'running') {
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled
          className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium opacity-50"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          {label}
        </button>
        <span className="text-caption" style={{ color: 'var(--color-muted)' }}>
          {phase.message}
        </span>
      </div>
    );
  }

  if (phase.kind === 'done') {
    return <WinLine onDone={() => setPhase({ kind: 'idle' })}>{done ?? 'Done.'}</WinLine>;
  }

  if (phase.kind === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex items-baseline gap-2 text-secondary">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
            style={{ background: 'var(--color-mod-red)' }}
          />
          <span style={{ color: 'var(--color-canvas-fg)' }}>{phase.error}</span>
        </span>
        <button
          type="button"
          className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
          style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
          onClick={confirm !== undefined ? () => setPhase({ kind: 'confirm' }) : start}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
      style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
      onClick={confirm !== undefined ? () => setPhase({ kind: 'confirm' }) : start}
    >
      {label}
    </button>
  );
}
