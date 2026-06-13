import { useCallback, useEffect, useState } from 'react';

import { deleteSavedView, fetchSavedViews, putSavedView } from '../lib/api';
import type { SavedView, SavedViewArea } from '../lib/dashboard-types';

interface Props {
  area: SavedViewArea;
  /** Capture the area's current scope when the user saves a view. */
  getScope: () => Record<string, unknown>;
  /** Apply a saved scope back onto the area's existing state. */
  onApply: (scope: Record<string, unknown>) => void;
}

/**
 * Issue #161 — the "Save this view" affordance plus the per-area list of saved
 * views. Project-scoped, shared through git. Applying a view sets the area's
 * existing state via {@link Props.onApply}; there is no new state model.
 */
export function SavedViewsBar({ area, getScope, onApply }: Props) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSavedViews()
      .then((all) => {
        setViews(all.filter((view) => view.area === area));
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [area]);

  useEffect(() => {
    load();
  }, [load]);

  const save = (): void => {
    const name = window.prompt('Name this view');
    if (name === null || name.trim().length === 0) return;
    putSavedView({ id: crypto.randomUUID(), name: name.trim(), area, scope: getScope() })
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const remove = (id: string): void => {
    deleteSavedView(id)
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <div className="text-xs">
      <button
        type="button"
        className="rounded border px-2 py-1 font-medium"
        style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
        onClick={save}
      >
        Save this view
      </button>
      {views.length > 0 && (
        <div className="mt-2">
          <div style={{ color: 'var(--color-muted)' }}>Saved views</div>
          <ul className="mt-1 space-y-1">
            {views.map((view) => (
              <li key={view.id} className="flex items-center gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  style={{ color: 'var(--color-accent)' }}
                  onClick={() => onApply(view.scope)}
                  title={`Apply ${view.name}`}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="shrink-0"
                  style={{ color: 'var(--color-muted)' }}
                  onClick={() => remove(view.id)}
                  aria-label={`Delete ${view.name}`}
                  title={`Delete ${view.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="mt-1" style={{ color: 'var(--color-mod-red)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
