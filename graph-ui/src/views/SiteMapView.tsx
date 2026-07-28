import { useCallback, useEffect, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { OpButton } from '../components/OpButton';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { ScoreBadge } from '../components/ScoreBadge';
import { WhySentence } from '../components/WhySentence';
import { fetchDashboard } from '../lib/api';
import type { SectionData } from '../lib/dashboard-types';

/**
 * The Site map area (issue #448). The site-map run is a dashboard action, not a
 * command the user types: this page renders the latest run the server computed
 * (surfaces, journeys, findings) and a Run button that maps the app on demand
 * via the `site-map` ops job, refreshing the view when it finishes.
 */

interface BlockedCheck {
  check: string;
  reason: string;
}

function readBlockedChecks(details: Record<string, unknown> | undefined): BlockedCheck[] {
  const raw = details?.blockedChecks;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is BlockedCheck =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as BlockedCheck).check === 'string' &&
      typeof (item as BlockedCheck).reason === 'string',
  );
}

export function SiteMapView() {
  const [section, setSection] = useState<SectionData | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sseLive, setSseLive] = useState(false);

  const load = useCallback((): void => {
    fetchDashboard()
      .then((report) => {
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
        setSection(report.sections.find((candidate) => candidate.id === 'site-map') ?? null);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    return () => {
      source.close();
    };
  }, []);

  const hasRun = section !== null && section.score !== null;
  const blockedChecks = readBlockedChecks(section?.details);

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-4xl p-6">
        <div className="flex items-center gap-3">
          <h1 className="text-page font-semibold">Site map</h1>
          <OwnershipBadge managedBy="shared" />
          {section && <ScoreBadge score={section.score} band={section.band} />}
          <div className="ml-auto">
            <OpButton
              action="site-map"
              label={hasRun ? 'Run again' : 'Run site map'}
              done="Mapped. Showing the fresh run."
              onDone={load}
            />
          </div>
        </div>
        <WhySentence>
          How your app really behaves: every screen, journey, and guard, checked against the code.
        </WhySentence>

        {loadError && (
          <div
            className="mt-4 rounded-[10px] border p-4 text-secondary"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load the site map: {loadError}
          </div>
        )}

        {!loaded && !loadError && (
          <div className="mt-6 text-secondary" style={{ color: 'var(--color-muted)' }}>
            Loading…
          </div>
        )}

        {loaded && !loadError && !hasRun && (
          <div className="mt-6 rounded-[10px] p-6" style={{ background: 'var(--color-surface)' }}>
            <div className="text-body font-medium">No site-map runs yet.</div>
            <p className="mt-1.5 text-secondary" style={{ color: 'var(--color-muted)' }}>
              Hit Run site map to scan the app, reconcile it against the map, and publish the
              overview here. It runs locally with zero model tokens.
            </p>
          </div>
        )}

        {loaded && hasRun && section && (
          <>
            <p className="mt-4 text-secondary" style={{ color: 'var(--color-muted)' }}>
              {section.summary}
            </p>

            {section.metrics.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {section.metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-[10px] p-4"
                    style={{ background: 'var(--color-surface)' }}
                  >
                    <div className="text-page font-semibold">{metric.value}</div>
                    <div className="text-caption" style={{ color: 'var(--color-muted)' }}>
                      {metric.label}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {blockedChecks.length > 0 && (
              <div
                className="mt-4 rounded-[10px] p-4"
                style={{ background: 'var(--color-surface)' }}
              >
                <div className="text-body font-medium">
                  {blockedChecks.length} {blockedChecks.length === 1 ? 'check was' : 'checks were'}{' '}
                  skipped
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  {blockedChecks.map((blocked) => (
                    <div key={blocked.check} className="flex items-baseline gap-2 text-secondary">
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
                        style={{ background: 'var(--color-muted)' }}
                      />
                      <span
                        className="shrink-0 font-mono text-caption"
                        style={{ color: 'var(--color-muted)' }}
                      >
                        {blocked.check}
                      </span>
                      <span className="min-w-0">{blocked.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardChrome>
  );
}
