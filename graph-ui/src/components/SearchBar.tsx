import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../lib/store';

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

export function SearchBar() {
  const graph = useAppStore((s) => s.graph);
  const search = useAppStore((s) => s.search);
  const setQuery = useAppStore((s) => s.setSearchQuery);
  const setMatches = useAppStore((s) => s.setSearchMatches);
  const setIndex = useAppStore((s) => s.setSearchIndex);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recompute matches whenever the query changes.
  const matches = useMemo<string[]>(() => {
    if (!graph || !search.query.trim()) return [];
    const q = search.query.trim().toLowerCase();
    const out: string[] = [];
    for (const n of graph.nodes) {
      const label = n.label.toLowerCase();
      if (label.includes(q)) {
        out.push(n.id);
        continue;
      }
      if (n.type === 'file' && basename(n.label).toLowerCase().includes(q)) {
        out.push(n.id);
        continue;
      }
    }
    return out;
  }, [graph, search.query]);

  useEffect(() => {
    setMatches(matches);
  }, [matches, setMatches]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (matches.length === 0) return;
      if (e.key === 'n') {
        e.preventDefault();
        setIndex((search.index + 1) % matches.length);
      }
      if (e.key === 'N') {
        e.preventDefault();
        setIndex((search.index - 1 + matches.length) % matches.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [matches, search.index, setIndex]);

  return (
    <div
      className="absolute left-1/2 top-3 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-sm shadow-sm flex items-center gap-2"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <input
        ref={inputRef}
        value={search.query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search modules, files, symbols…  (press /)"
        className="w-72 bg-transparent text-sm outline-none"
      />
      {search.query && (
        <>
          <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            {matches.length === 0 ? 'no matches' : `${search.index + 1} / ${matches.length}`}
          </span>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-[11px] underline"
            style={{ color: 'var(--color-muted)' }}
          >
            clear
          </button>
        </>
      )}
    </div>
  );
}
