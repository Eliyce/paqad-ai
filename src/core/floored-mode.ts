export interface FlooredModeLayers {
  team?: string;
  local?: string;
  env?: string;
}

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

  const floor = norm(layers.team) ?? def;
  let rank = order.indexOf(floor);
  for (const raising of [norm(layers.local), norm(layers.env)]) {
    if (raising !== undefined) {
      rank = Math.max(rank, order.indexOf(raising));
    }
  }
  return order[rank];
}
