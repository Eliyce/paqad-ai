import { useState } from 'react';

import type { OnboardingChecklist as ChecklistData } from '../lib/dashboard-types';

import { WinLine } from './WinLine';

const DISMISS_KEY = 'paqad-checklist-dismissed';
const RECEIPT_VIEWED_KEY = 'paqad-receipt-viewed';

interface Props {
  data: ChecklistData;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * The first-loop checklist on Pulse (issue #146, final polish). Steps
 * complete from real events the server reports, never from clicks. The
 * one exception, "open your first receipt", completes client-side once
 * Trust has been opened while a receipt existed (the Trust view records
 * that in localStorage). Dismissing hides it forever and fires nothing.
 */
export function OnboardingChecklist({ data }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => readFlag(DISMISS_KEY));
  const [receiptViewed] = useState<boolean>(() => readFlag(RECEIPT_VIEWED_KEY));

  if (dismissed) return null;

  const hide = (): void => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // private mode; hiding still works for this session
    }
    setDismissed(true);
  };

  const isDone = (key: string, done: boolean): boolean =>
    done || (key === 'first-receipt' && data.receiptAvailable && receiptViewed);

  const allDone = data.steps.length > 0 && data.steps.every((step) => isDone(step.key, step.done));

  if (allDone) {
    return (
      <div className="mt-6">
        <WinLine onDone={hide}>
          You have completed the first loop. This dashboard is yours now.
        </WinLine>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-[10px] p-4" style={{ background: 'var(--color-surface)' }}>
      <div className="flex items-baseline justify-between gap-3 px-2.5">
        <h2 className="text-secondary font-medium">Getting started</h2>
        <button
          type="button"
          className="shrink-0 text-caption"
          style={{ color: 'var(--color-muted)' }}
          onClick={hide}
        >
          Dismiss
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
        {data.steps.map((step, index) => {
          const done = isDone(step.key, step.done);
          return (
            <a
              key={step.key}
              href={step.route}
              className="flex items-start gap-2.5 rounded-[6px] px-2.5 py-2 no-underline"
              style={{ color: 'var(--color-canvas-fg)' }}
            >
              <span
                aria-hidden="true"
                className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: done ? 'var(--color-accent)' : 'var(--color-muted)' }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-secondary font-medium">{step.label}</span>
                <span className="block text-caption" style={{ color: 'var(--color-muted)' }}>
                  {step.detail}
                </span>
                {index === 0 && (
                  <span className="block text-caption" style={{ color: 'var(--color-muted)' }}>
                    Tip: press Cmd+K to jump anywhere.
                  </span>
                )}
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                style={{ color: 'var(--color-muted)' }}
              >
                <path d="M3 7h8M8 4l3 3-3 3" />
              </svg>
            </a>
          );
        })}
      </div>
    </div>
  );
}
