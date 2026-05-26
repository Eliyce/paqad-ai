/**
 * Placeholder — the real dashboard view (chrome + summary band + section
 * grid) lands in the next commit. This stub exists so the hash router
 * has a default route and the SPA still type-checks while the larger
 * UI work is being staged.
 */
export function DashboardView() {
  return (
    <div
      className="grid h-full w-full place-items-center text-sm"
      style={{ background: 'var(--color-canvas)', color: 'var(--color-muted)' }}
    >
      <div
        className="rounded-lg border p-6"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="text-base font-medium" style={{ color: 'var(--color-canvas-fg)' }}>
          Dashboard coming up…
        </div>
        <div className="mt-2">
          Switch to <code>#/graph</code> for the project graph in the meantime.
        </div>
      </div>
    </div>
  );
}
