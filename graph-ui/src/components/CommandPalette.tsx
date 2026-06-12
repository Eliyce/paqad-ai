import { useEffect, useMemo, useRef, useState } from 'react';

import { useHashRoute, type Route } from '../lib/router';

interface PaletteEntry {
  label: string;
  /** Quiet right-hand hint: "page" or "action". */
  kind: 'page' | 'action';
  run: () => void;
}

/**
 * Cmd+K / Ctrl+K command palette (issue #146, final polish). One input,
 * one filtered list, arrow keys plus Enter. Deliberately stateless: it
 * persists nothing and only navigates or opens the packet export. The
 * why-drawer keeps the product's only shadow, so the panel separates
 * itself with a 1px low-opacity border instead.
 */
export function CommandPalette() {
  const { navigate } = useHashRoute();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<PaletteEntry[]>(() => {
    const go = (route: Route) => () => navigate(route);
    return [
      { label: 'Pulse', kind: 'page', run: go('pulse') },
      { label: 'Approvals', kind: 'page', run: go('approvals') },
      { label: 'Trust', kind: 'page', run: go('trust') },
      { label: 'Build', kind: 'page', run: go('build') },
      { label: 'Automation', kind: 'page', run: go('automation') },
      { label: 'Knowledge', kind: 'page', run: go('knowledge') },
      { label: 'Setup', kind: 'page', run: go('setup') },
      { label: 'Graph', kind: 'page', run: go('graph') },
      { label: 'Legacy health view', kind: 'page', run: go('dashboard') },
      { label: 'Delivery policy', kind: 'page', run: go('delivery-policy') },
      { label: 'Instructions', kind: 'page', run: go('instructions') },
      { label: 'Module map', kind: 'page', run: go('module-map') },
      { label: 'Design tokens', kind: 'page', run: go('design-tokens') },
      { label: 'Resolve approvals', kind: 'action', run: go('approvals') },
      {
        label: 'Export the evidence packet',
        kind: 'action',
        run: () => window.open('/api/export/evidence-packet?format=html', '_blank'),
      },
    ];
  }, [navigate]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter((entry) => entry.label.toLowerCase().includes(needle));
  }, [entries, query]);

  // Global shortcut: Cmd+K / Ctrl+K toggles, Escape closes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setActive(0);
        return;
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));

  const runEntry = (entry: PaletteEntry | undefined): void => {
    if (entry === undefined) return;
    setOpen(false);
    entry.run();
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((prev) =>
        filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runEntry(filtered[activeIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center"
      style={{ background: 'color-mix(in srgb, var(--color-canvas-fg) 20%, transparent)' }}
      onMouseDown={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="palette-in mt-[15vh] h-fit w-full max-w-[520px] rounded-[10px] p-2"
        style={{
          background: 'var(--color-canvas)',
          border: '1px solid color-mix(in srgb, var(--color-border) 70%, transparent)',
        }}
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="w-full bg-transparent px-2.5 py-2 text-body outline-none"
          style={{ color: 'var(--color-canvas-fg)' }}
          placeholder="Jump to a page or run an action"
          aria-label="Jump to a page or run an action"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKeyDown}
        />
        <div className="mt-1 flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-2.5 py-2 text-secondary" style={{ color: 'var(--color-muted)' }}>
              Nothing matches.
            </div>
          )}
          {filtered.map((entry, index) => (
            <button
              key={entry.kind + entry.label}
              type="button"
              className="flex items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-secondary"
              style={{
                background: index === activeIndex ? 'var(--color-surface)' : 'transparent',
                color: 'var(--color-canvas-fg)',
              }}
              onMouseEnter={() => setActive(index)}
              onClick={() => runEntry(entry)}
            >
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <span className="shrink-0 text-caption" style={{ color: 'var(--color-muted)' }}>
                {entry.kind}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
