import type { AppMap, Journey, Surface } from '../lib/site-map-types';
import { evidenceList, guardList } from '../lib/site-map-types';
import { kindMeta, trustMeta } from '../lib/site-map-vocab';

/**
 * The detail panel for a selected surface (issue #466, DP-1..3). It leads with a plain-language
 * description, shows the honest trust tier, lists the guards on the surface and what they require,
 * the journeys that pass through it, and the file:line evidence behind every claim — so a person
 * can verify the map against the code (PROV-2). The code-level connectivity (its outgoing moves)
 * is the technical view alongside the visual one (DP-6).
 */

interface Props {
  surface: Surface;
  map: AppMap;
  journeys: Journey[];
  onClose: () => void;
}

export function SiteMapDetail({ surface, map, journeys, onClose }: Props) {
  const meta = kindMeta(surface.kind);
  const trust = trustMeta(surface.trust);
  const guardIds = guardList(surface.guard);
  const guards = guardIds.map((id) => map.guards?.find((guard) => guard.id === id) ?? { id });
  const evidence = evidenceList(surface.evidence);
  const passingJourneys = journeys.filter((journey) =>
    journey.steps.some((step) => step.surface === surface.id),
  );
  const transitions = (surface.transitions ?? []).filter((transition) =>
    map.surfaces.some((candidate) => candidate.id === transition.to),
  );

  return (
    <aside
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l p-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      aria-label={`Details for ${surface.label}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-body font-semibold">{surface.label}</div>
          <div className="text-caption" style={{ color: 'var(--color-muted)' }}>
            {meta.family}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="rounded-[6px] px-2 py-0.5 text-caption"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
        >
          Close
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge>{meta.tag}</Badge>
        <Badge title="How strongly this is proven">{trust.label}</Badge>
        {surface.confidence && <Badge>{surface.confidence} confidence</Badge>}
      </div>

      {surface.note && <p className="mt-3 text-secondary">{surface.note}</p>}

      {guards.length > 0 && (
        <Section title="Gated by">
          {guards.map((guard) => (
            <div key={guard.id} className="text-secondary">
              <span className="font-medium">{'label' in guard ? guard.label : guard.id}</span>
              {'requires' in guard && guard.requires ? (
                <span style={{ color: 'var(--color-muted)' }}> — requires {guard.requires}</span>
              ) : null}
            </div>
          ))}
        </Section>
      )}

      {passingJourneys.length > 0 && (
        <Section title="On these journeys">
          {passingJourneys.map((journey) => (
            <div key={journey.id} className="text-secondary">
              {journey.label}
            </div>
          ))}
        </Section>
      )}

      {transitions.length > 0 && (
        <Section title="Goes to">
          {transitions.map((transition, index) => (
            <div key={`${transition.to}#${index}`} className="text-secondary">
              <span className="font-medium">{transition.to}</span>
              <span style={{ color: 'var(--color-muted)' }}> · {transition.trigger}</span>
            </div>
          ))}
        </Section>
      )}

      <Section title="Evidence">
        {evidence.length === 0 ? (
          <div style={{ color: 'var(--color-muted)' }}>No evidence pointer recorded.</div>
        ) : (
          evidence.map((item, index) => (
            <div
              key={index}
              className="font-mono text-caption"
              style={{ color: 'var(--color-muted)' }}
            >
              {item.file}
              {item.line !== undefined ? `:${item.line}` : ''}
              {item.note ? ` — ${item.note}` : ''}
            </div>
          ))
        )}
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div
        className="text-caption font-semibold uppercase tracking-wide"
        style={{ color: 'var(--color-muted)' }}
      >
        {title}
      </div>
      <div className="mt-1.5 flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Badge({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-full px-2 py-0.5 text-caption"
      style={{
        background: 'var(--color-canvas)',
        color: 'var(--color-canvas-fg)',
        border: '1px solid var(--color-border)',
      }}
    >
      {children}
    </span>
  );
}
