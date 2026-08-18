import { useEffect, useState } from 'react';
import { Command } from 'cmdk';

import type { AppMap, Journey } from '../lib/site-map-types';
import { kindMeta } from '../lib/site-map-vocab';

/**
 * The cmd+K / ctrl+K palette over surfaces, areas, and journeys (issue #489, Phase 2). Picking a
 * result flies the camera to it (the caller owns the flight) and, for a surface, selects it. Pure
 * client search over the served payload — no LLM, no network.
 */

interface Props {
  map: AppMap;
  journeys: Journey[];
  onSelectSurface: (id: string) => void;
  onSelectArea: (id: string) => void;
  onPickJourney: (id: string) => void;
}

export function SiteMapSearch({
  map,
  journeys,
  onSelectSurface,
  onSelectArea,
  onPickJourney,
}: Props) {
  const [open, setOpen] = useState(false);

  // Claim cmd/ctrl+K in the capture phase so the map search wins over the dashboard's global nav
  // palette (which also binds cmd+K) while the map is on screen; stopImmediatePropagation keeps the
  // two from both opening. Scoped to this component's lifetime, so other views keep the nav palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const close = (run: () => void) => {
    setOpen(false);
    run();
  };

  const areas = map.areas ?? [];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search the map"
      className="sm-search"
      style={{
        position: 'fixed',
        left: '50%',
        top: '18%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        width: 'min(560px, 92vw)',
        background: 'var(--color-surface)',
        color: 'var(--color-canvas-fg)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
        overflow: 'hidden',
      }}
    >
      <Command.Input
        placeholder="Search surfaces, areas, journeys…"
        style={{
          width: '100%',
          padding: '12px 14px',
          fontSize: 14,
          background: 'transparent',
          color: 'var(--color-canvas-fg)',
          border: 'none',
          borderBottom: '1px solid var(--color-border)',
          outline: 'none',
        }}
      />
      <Command.List style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
        <Command.Empty style={{ padding: '12px 10px', color: 'var(--color-muted)', fontSize: 13 }}>
          No matches.
        </Command.Empty>

        {journeys.length > 0 && (
          <Command.Group heading="Journeys">
            {journeys.map((journey) => (
              <Command.Item
                key={journey.id}
                value={`journey ${journey.label} ${journey.id}`}
                onSelect={() => close(() => onPickJourney(journey.id))}
                className="sm-search-item"
              >
                <span style={{ color: 'var(--color-muted)', fontSize: 11 }}>JOURNEY</span>
                <span>{journey.label}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {areas.length > 0 && (
          <Command.Group heading="Areas">
            {areas.map((area) => (
              <Command.Item
                key={area.id}
                value={`area ${area.label} ${area.id}`}
                onSelect={() => close(() => onSelectArea(area.id))}
                className="sm-search-item"
              >
                <span style={{ color: 'var(--color-muted)', fontSize: 11 }}>AREA</span>
                <span>{area.label}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Surfaces">
          {map.surfaces.map((surface) => (
            <Command.Item
              key={surface.id}
              value={`surface ${surface.label} ${surface.id}`}
              onSelect={() => close(() => onSelectSurface(surface.id))}
              className="sm-search-item"
            >
              <span style={{ color: 'var(--color-muted)', fontSize: 11 }}>
                {kindMeta(surface.kind).tag}
              </span>
              <span>{surface.label}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
