import { useMemo, useState } from 'react';

import type { AppMap, Surface } from '../lib/site-map-types';
import { guardList } from '../lib/site-map-types';
import { kindMeta, trustMeta } from '../lib/site-map-vocab';

/**
 * The text-first equivalent of the diagram (issue #466, A11Y-2). A searchable list of every
 * surface grouped by district, keyboard-operable, conveying the same information (kind, gate,
 * trust) without relying on the visual or on colour. Reads from the same map as the canvas.
 */

interface Props {
  map: AppMap;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SiteMapList({ map, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (surface: Surface): boolean =>
      needle.length === 0 ||
      surface.label.toLowerCase().includes(needle) ||
      surface.id.toLowerCase().includes(needle);

    const byArea = new Map<string, Surface[]>();
    for (const surface of map.surfaces) {
      if (!matches(surface)) continue;
      const key = surface.area ?? '';
      const list = byArea.get(key) ?? [];
      list.push(surface);
      byArea.set(key, list);
    }
    const areaLabel = (id: string): string =>
      id === '' ? 'No district' : (map.areas?.find((area) => area.id === id)?.label ?? id);
    return [...byArea.entries()]
      .map(([id, surfaces]) => ({ id, label: areaLabel(id), surfaces }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [map, query]);

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--color-canvas)' }}>
      <div className="border-b p-3" style={{ borderColor: 'var(--color-border)' }}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search surfaces…"
          aria-label="Search surfaces"
          className="w-full rounded-[8px] px-3 py-1.5 text-body"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-canvas-fg)',
          }}
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-3">
        {groups.map((group) => (
          <li key={group.id} className="mb-3">
            <div
              className="mb-1 text-caption font-semibold uppercase tracking-wide"
              style={{ color: 'var(--color-muted)' }}
            >
              {group.label}
            </div>
            <ul className="flex flex-col gap-1">
              {group.surfaces.map((surface) => {
                const meta = kindMeta(surface.kind);
                const gated = guardList(surface.guard).length > 0;
                const selected = surface.id === selectedId;
                return (
                  <li key={surface.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(surface.id)}
                      className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left"
                      style={{
                        background: selected ? 'var(--color-accent)' : 'var(--color-surface)',
                        color: selected ? '#ffffff' : 'var(--color-canvas-fg)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-body">{surface.label}</span>
                      {gated && (
                        <span
                          className="text-caption"
                          style={{ color: selected ? '#fff' : 'var(--color-mod-amber)' }}
                        >
                          gated
                        </span>
                      )}
                      <span
                        className="text-caption"
                        style={{ color: selected ? '#fff' : 'var(--color-muted)' }}
                      >
                        {meta.tag}
                      </span>
                      <span
                        className="text-caption"
                        style={{ color: selected ? '#fff' : 'var(--color-muted)' }}
                      >
                        {trustMeta(surface.trust).label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
