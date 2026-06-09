/**
 * Stability vocabulary for the engine extension surface contract (PQD-92).
 *
 * The extension-surface document (`docs/extension-surface.md`) enumerates every
 * engine API a downstream consumer (desktop, API layer, marketplace, coding-agent
 * adapters) depends on. Each entry carries a {@link StabilityLevel} so a breaking
 * change can be caught at design time rather than at integration. These types are
 * passive — exporting them lets future consumer-side tooling share the vocabulary.
 */

/** Stability guarantee grades, strongest to weakest. */
export const STABILITY_LEVELS = ['stable', 'beta', 'alpha', 'internal'] as const;

/**
 * The guarantee attached to a surface entry:
 * - `stable`   — covered by semver; removals/renames are breaking changes.
 * - `beta`     — usable, but may change in a minor release with notice.
 * - `alpha`    — experimental; may change or vanish without notice.
 * - `internal` — not part of the surface; consumers must not depend on it.
 */
export type StabilityLevel = (typeof STABILITY_LEVELS)[number];

/**
 * One row of the extension surface contract: a single engine API as consumed by
 * one consumer, with enough metadata to detect drift.
 */
export interface SurfaceEntry {
  /** The consumer that depends on this API (e.g. `desktop`, `claude-code`, `cli`). */
  consumer: string;
  /** The engine module path that owns the symbol (e.g. `src/adapters/adapter.interface.ts`). */
  engineModule: string;
  /** The exported symbol and its TypeScript signature. */
  functionSignature: string;
  /** The stability guarantee for this entry. */
  stabilityLevel: StabilityLevel;
  /** The semver in which the entry was introduced (e.g. `1.0.0`). */
  since: string;
  /**
   * When set, exempts the entry from the static orphan/drift checks with a
   * recorded reason — for call sites static analysis cannot reach (dynamically
   * constructed names, conditional imports, external consumers not in-tree).
   */
  exempt?: string;
}
