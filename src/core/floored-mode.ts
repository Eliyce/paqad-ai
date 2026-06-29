// The C2 clamp (buildout F2, decision D1).
//
// Capability mode knobs (stages_mode, rule_compliance) used to resolve LOCAL-WINS
// like every other config key: a developer could drop `stages_mode=off` into the
// git-ignored `.paqad/.config` (or a `PAQAD_*` env var) and silently lower the
// team's enforcement with zero repo trace — the verified C2 hole. For an ENFORCED
// mode knob the precedence is inverted: the team-tracked value is a FLOOR, and the
// local file / env escape hatch may only RAISE strictness above it, never lower it.
//
// When no layer sets the knob, the built-in default applies and is itself the
// floor, so a lone developer cannot drop below the install default either. To
// lower enforcement a TEAM must commit the weaker value to `configs/.config.*` —
// a visible, reviewable decision, exactly the trust model D1 asks for.

/** The three config layers, lowest-trust last. `team` is the floor. */
export interface FlooredModeLayers {
  /** Merged `configs/.config.*` (tracked, team-shared) — the floor. */
  team?: string;
  /** `.paqad/.config` (git-ignored, dev-local) — may only RAISE. */
  local?: string;
  /** `PAQAD_*` env escape hatch — may only RAISE. */
  env?: string;
}

/**
 * Resolve an enforced mode knob with the team value as a floor. `order` lists the
 * modes weakest → strictest (e.g. `['off','warn','strict']`). The result is the
 * STRICTEST of the floor and any raising layer; a local/env value weaker than the
 * floor is clamped away. Unrecognised values are ignored (treated as unset) so a
 * typo never silently disables enforcement.
 */
export function resolveFlooredMode<T extends string>(
  layers: FlooredModeLayers,
  order: readonly T[],
  def: T,
): T {
  const norm = (raw: string | undefined): T | undefined => {
    if (raw === undefined) return undefined;
    const value = raw.trim().toLowerCase() as T;
    return order.includes(value) ? value : undefined;
  };

  // The team value (when present and valid) is the floor; otherwise the default.
  const floor = norm(layers.team) ?? def;
  let rank = order.indexOf(floor);
  // Local and env may only RAISE — take the max rank, never below the floor.
  for (const raising of [norm(layers.local), norm(layers.env)]) {
    if (raising !== undefined) {
      rank = Math.max(rank, order.indexOf(raising));
    }
  }
  return order[rank];
}
