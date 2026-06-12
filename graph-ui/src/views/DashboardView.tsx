import { useEffect, useMemo, useRef, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { SectionCard } from '../components/SectionCard';
import { SummaryBand } from '../components/SummaryBand';
import { fetchDashboard } from '../lib/api';
import type { DashboardReport, SectionData } from '../lib/dashboard-types';
import { useHashRoute } from '../lib/router';

/**
 * Dashboard view. Fetches the report on mount, listens to the same
 * `/api/events` SSE stream the graph view uses, and re-fetches on
 * `dashboard-updated`. Pulses the border of any card whose section
 * payload changed between refreshes — the one animation the brief
 * allows.
 */
export function DashboardView() {
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const [pulsing, setPulsing] = useState<ReadonlySet<string>>(new Set());
  const prevReportRef = useRef<DashboardReport | null>(null);
  const { navigate } = useHashRoute();

  const loadReport = useMemo(
    () => (): void => {
      fetchDashboard()
        .then((next) => {
          const prev = prevReportRef.current;
          if (prev) {
            const changed = new Set<string>();
            const prevById = new Map(prev.sections.map((s) => [s.id, s]));
            for (const section of next.sections) {
              const before = prevById.get(section.id);
              if (!before || before.score !== section.score || before.summary !== section.summary) {
                changed.add(section.id);
              }
            }
            setPulsing(changed);
            if (changed.size > 0) {
              setTimeout(() => setPulsing(new Set()), 250);
            }
          }
          prevReportRef.current = next;
          setReport(next);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [],
  );

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    source.addEventListener('dashboard-updated', () => loadReport());
    return () => {
      source.close();
    };
  }, [loadReport]);

  const SECTION_ROUTES: Partial<Record<string, Parameters<typeof navigate>[0]>> = {
    architecture: 'graph',
    decisions: 'approvals',
    'module-decisions': 'approvals',
    attestation: 'trust',
  };

  const onOpenSection = (section: SectionData): void => {
    const target = SECTION_ROUTES[section.id];
    if (target) navigate(target);
  };

  return (
    <DashboardChrome
      projectName={report?.projectName ?? null}
      frameworkVersion={report?.frameworkVersion ?? null}
      sseLive={sseLive}
    >
      {report && (
        <SummaryBand
          score={report.overallScore}
          band={report.overallBand}
          attention={report.attention}
        />
      )}
      {error && (
        <div
          className="m-6 rounded-lg border p-4 text-sm"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
        >
          Error loading dashboard: {error}
        </div>
      )}
      {report?.notOnboarded && (
        <div className="grid flex-1 place-items-center p-6">
          <div
            className="max-w-md rounded-lg border p-6 text-sm"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="text-base font-medium">Project not onboarded</div>
            <div className="mt-2" style={{ color: 'var(--color-muted)' }}>
              Run <code>paqad-ai onboard</code> in this project to populate the dashboard.
            </div>
          </div>
        </div>
      )}
      {report && !report.notOnboarded && (
        <div className="grid gap-6 p-6 md:grid-cols-2 xl:grid-cols-3">
          {report.sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              pulsing={pulsing.has(section.id)}
              onOpen={SECTION_ROUTES[section.id] ? onOpenSection : undefined}
            />
          ))}
        </div>
      )}
      {!report && !error && (
        <div
          className="grid flex-1 place-items-center text-sm"
          style={{ color: 'var(--color-muted)' }}
        >
          Loading…
        </div>
      )}
    </DashboardChrome>
  );
}
