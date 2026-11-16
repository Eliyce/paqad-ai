import { describe, expect, it } from 'vitest';

import { buildReviewView, reviewShown, STALL_MS } from '@/review-runs/view.js';
import type { ReviewFinding, ReviewGap } from '@/review-runs/types.js';

import { DESIGN, SECURITY, at, clockAt, reviewRun } from './fixtures.js';

function finding(
  severity: ReviewFinding['severity'],
  proof: ReviewFinding['proof'] = 'confirmed',
): ReviewFinding {
  return { severity, proof, id: null, at: at(1) };
}

function gap(stage: string, code = 'not-run'): ReviewGap {
  return { code, stage, say: `${stage} gap`, at: at(1) };
}

const ALL_DONE = Object.fromEntries(SECURITY.stages.map((stage) => [stage.id, 'done' as const]));

describe('review view headlines', () => {
  it('AC-6: stage 4 running reads Stage 4 of 8 with its running phrase in the accent signal', () => {
    const run = reviewRun({
      states: { scope: 'done', map: 'done', scan: 'done', threats: 'running' },
      current_stage: 'threats',
    });
    const view = buildReviewView(SECURITY, run, { now: clockAt(1) });
    expect(view.headline).toEqual({
      row: 'R1',
      text: 'Stage 4 of 8 · Modelling the threats',
      signal: 'accent',
    });
    expect(view.status).toBe('running');
    expect(view.word).toBe('Security review');
    expect(view.status_line).toBe('Modelling the threats');
  });

  it('AC-7: between stages, stopped and not started read their rows', () => {
    const between = buildReviewView(
      SECURITY,
      reviewRun({ states: { scope: 'done', map: 'done', scan: 'done' }, current_stage: 'scan' }),
      { now: clockAt(1) },
    );
    expect(between.headline).toEqual({
      row: 'R2',
      text: 'Next: stage 4 of 8 · Model the threats',
      signal: 'muted',
    });
    const stopped = buildReviewView(
      SECURITY,
      reviewRun({
        status: 'stopped',
        states: { scope: 'done', map: 'gap' },
        current_stage: 'map',
        stopped: { stage: 'map', was_running: true },
        gaps: [gap('map', 'tool-missing')],
      }),
      { now: clockAt(1) },
    );
    expect(stopped.headline).toEqual({
      row: 'R3',
      text: 'Stopped at stage 2 · Map the attack surface · Resume to continue',
      signal: 'caution',
    });
    expect(stopped.button).toBe('Resume');
    const fresh = buildReviewView(DESIGN, reviewRun({ kind: 'design' }), { now: clockAt(0) });
    expect(fresh.headline).toEqual({
      row: 'R0',
      text: 'Design review has not started',
      signal: 'muted',
    });
  });

  it('AC-8: a confirmed high or critical finding reads serious in the fail signal', () => {
    const one = buildReviewView(
      SECURITY,
      reviewRun({
        status: 'finished',
        finished_at: at(2),
        states: ALL_DONE,
        findings: [finding('high')],
      }),
      { now: clockAt(2) },
    );
    expect(one.headline).toEqual({
      row: 'F1',
      text: '1 serious finding confirmed',
      signal: 'fail',
    });
    const two = buildReviewView(
      SECURITY,
      reviewRun({
        status: 'finished',
        finished_at: at(2),
        states: ALL_DONE,
        findings: [finding('critical'), finding('critical'), finding('low')],
      }),
      { now: clockAt(2) },
    );
    expect(two.headline.text).toBe('2 serious findings confirmed');
    expect(two.findings).toMatchObject({ critical: 2, low: 1, confirmed: 3, serious: 2 });
  });

  it('AC-9: only medium, low or info confirmed findings never read fail', () => {
    const one = buildReviewView(
      SECURITY,
      reviewRun({
        status: 'finished',
        finished_at: at(2),
        states: ALL_DONE,
        findings: [finding('medium')],
      }),
      { now: clockAt(2) },
    );
    expect(one.headline).toEqual({ row: 'F2', text: '1 finding confirmed', signal: 'caution' });
    const two = buildReviewView(
      SECURITY,
      reviewRun({
        status: 'finished',
        finished_at: at(2),
        states: ALL_DONE,
        findings: [finding('low'), finding('info')],
      }),
      { now: clockAt(2) },
    );
    expect(two.headline.text).toBe('2 findings confirmed');
    expect(two.headline.signal).not.toBe('fail');
  });

  it('AC-10: leads alone read No finding confirmed, muted, with only a footnote', () => {
    const view = buildReviewView(
      SECURITY,
      reviewRun({
        status: 'finished',
        finished_at: at(2),
        states: ALL_DONE,
        findings: [
          finding('critical', 'lead'),
          finding('critical', 'lead'),
          finding('critical', 'lead'),
        ],
      }),
      { now: clockAt(2) },
    );
    expect(view.headline).toEqual({ row: 'F4', text: 'No finding confirmed', signal: 'muted' });
    expect(view.leads).toBe(3);
    expect(view.leads_note).toBe('3 leads, not confirmed');
    expect(view.findings.confirmed).toBe(0);
    expect(view.celebrate).toBe(false);
  });

  it('AC-11: gaps read Done with N gaps, and a serious finding wins with the gap as a footnote', () => {
    const oneGap = buildReviewView(
      SECURITY,
      reviewRun({ status: 'finished', finished_at: at(2), states: ALL_DONE, gaps: [gap('scan')] }),
      { now: clockAt(2) },
    );
    expect(oneGap.headline).toEqual({ row: 'F3', text: 'Done with 1 gap', signal: 'caution' });
    const twoGaps = buildReviewView(
      SECURITY,
      reviewRun({
        status: 'finished',
        finished_at: at(2),
        states: ALL_DONE,
        gaps: [gap('scan'), gap('hunt')],
      }),
      { now: clockAt(2) },
    );
    expect(twoGaps.headline.text).toBe('Done with 2 gaps');
    const both = buildReviewView(
      SECURITY,
      reviewRun({
        status: 'finished',
        finished_at: at(2),
        states: ALL_DONE,
        findings: [finding('critical')],
        gaps: [gap('scan')],
      }),
      { now: clockAt(2) },
    );
    expect(both.headline.signal).toBe('fail');
    expect(both.gaps.map((row) => row.footnote)).toEqual(['Scan: scan gap']);
  });

  it('AC-22: the alt text names each stage state, the confirmed severity and the leads', () => {
    const view = buildReviewView(
      SECURITY,
      reviewRun({
        states: { scope: 'done', map: 'skipped', scan: 'done', threats: 'running' },
        current_stage: 'threats',
        findings: [finding('high'), finding('low', 'lead'), finding('info', 'lead')],
      }),
      { now: clockAt(1) },
    );
    expect(view.alt).toBe(
      'Scope done, Map skipped, Scan done, Threats running, 4 not started, 1 high finding confirmed, 2 leads',
    );
    expect(view.stages[1]).toMatchObject({ state: 'skipped', mark: '–' });
  });

  it('FR-14: a running stage with no write for over 20 minutes builds as stopped', () => {
    const run = reviewRun({
      states: { scope: 'running' },
      current_stage: 'scope',
      updated_at: at(0),
    });
    const fresh = buildReviewView(SECURITY, run, {
      now: () => new Date(Date.parse(at(0)) + STALL_MS),
    });
    expect(fresh.status).toBe('running');
    const stale = buildReviewView(SECURITY, run, {
      now: () => new Date(Date.parse(at(0)) + STALL_MS + 1000),
    });
    expect(stale.status).toBe('stopped');
    expect(stale.stalled).toBe(true);
    expect(stale.headline.text).toBe('Stopped at stage 1 · Set the scope · Resume to continue');
    expect(stale.button).toBe('Resume');
  });

  it('AC-15 AC-17: a finished or abandoned view is shown for 30 minutes after it ended', () => {
    const view = { status: 'finished' as const, finished_at: at(0) };
    expect(reviewShown(view, Date.parse(at(0)) + 29 * 60_000 + 59_000)).toBe(true);
    expect(reviewShown(view, Date.parse(at(30)))).toBe(false);
    expect(reviewShown({ status: 'abandoned', finished_at: at(0) }, Date.parse(at(31)))).toBe(
      false,
    );
    expect(reviewShown({ status: 'running', finished_at: null }, Date.parse(at(300)))).toBe(true);
    expect(reviewShown(null, 0)).toBe(false);
  });
});
