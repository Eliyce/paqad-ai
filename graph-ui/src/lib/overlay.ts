import type { Graph, GraphNode, ModuleHealthTier } from './types';

export type OverlayKind = 'none' | 'health' | 'defects' | 'risk' | 'complexity';

const TIER_COLOR: Record<ModuleHealthTier, string> = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
  unknown: '#94a3b8',
};

const NEUTRAL_MODULE = '#94a3b8';
const FILE_FALLBACK = '#64748b';
const CHUNK_COLOR = '#0d9488';
const SYMBOL_COLOR = '#a78bfa';

const RAMP_GRAY_50 = { r: 0xfa, g: 0xfa, b: 0xfa };
const RAMP_END = {
  defects: { r: 0xdc, g: 0x26, b: 0x26 }, // red 600
  risk: { r: 0xd9, g: 0x77, b: 0x06 }, // amber 600
};
// Tailwind purple 600 = #9333ea
const PURPLE_600 = { r: 0x93, g: 0x33, b: 0xea };

function lerp(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): string {
  const v = (k: 'r' | 'g' | 'b') => Math.round(a[k] + (b[k] - a[k]) * Math.max(0, Math.min(1, t)));
  const c = (v('r') << 16) | (v('g') << 8) | v('b');
  return '#' + c.toString(16).padStart(6, '0');
}

function lighten(hex: string, t: number): string {
  // Reduce saturation by blending toward white. t in [0,1].
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const a = { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  const white = { r: 0xff, g: 0xff, b: 0xff };
  return lerp(a, white, t);
}

export interface OverlayMetrics {
  // Per-module
  fileCounts: Map<string, number>;
  defectDensities: Map<string, number>;
  riskValues: Map<string, number>;
  complexityDeltas: Map<string, number>;
  // Maxima (used for ramp normalisation)
  maxDefectDensityLog: number;
  maxRisk: number;
  maxComplexityDelta: number;
  // Module color cache by overlay
  moduleColors: Map<OverlayKind, Map<string, string>>;
}

export function computeOverlayMetrics(graph: Graph): OverlayMetrics {
  const fileCounts = new Map<string, number>();
  const defectDensities = new Map<string, number>();
  const riskValues = new Map<string, number>();
  const complexityDeltas = new Map<string, number>();

  for (const n of graph.nodes) {
    if (n.type === 'file' && n.parent_id) {
      fileCounts.set(n.parent_id, (fileCounts.get(n.parent_id) ?? 0) + 1);
    }
  }
  for (const n of graph.nodes) {
    if (n.type !== 'module') continue;
    const files = fileCounts.get(n.id) ?? 0;
    const defects = n.attributes.defect_count ?? 0;
    const density = files > 0 ? defects / files : defects;
    defectDensities.set(n.id, density);
    if (n.attributes.risk_floor != null) riskValues.set(n.id, n.attributes.risk_floor);
    if (n.attributes.complexity_correction != null) {
      complexityDeltas.set(n.id, Math.abs(n.attributes.complexity_correction - 1));
    }
  }
  let maxDefectDensityLog = 0;
  for (const d of defectDensities.values()) {
    maxDefectDensityLog = Math.max(maxDefectDensityLog, Math.log1p(d));
  }
  const maxRisk = Math.max(0, ...Array.from(riskValues.values()));
  const maxComplexityDelta = Math.max(0, ...Array.from(complexityDeltas.values()));

  const moduleColors = new Map<OverlayKind, Map<string, string>>();
  for (const overlay of ['none', 'health', 'defects', 'risk', 'complexity'] as OverlayKind[]) {
    const colors = new Map<string, string>();
    for (const n of graph.nodes) {
      if (n.type !== 'module') continue;
      colors.set(
        n.id,
        moduleOverlayColor(n, overlay, {
          defectDensities,
          riskValues,
          complexityDeltas,
          maxDefectDensityLog,
          maxRisk,
          maxComplexityDelta,
        }),
      );
    }
    moduleColors.set(overlay, colors);
  }

  return {
    fileCounts,
    defectDensities,
    riskValues,
    complexityDeltas,
    maxDefectDensityLog,
    maxRisk,
    maxComplexityDelta,
    moduleColors,
  };
}

interface RampInputs {
  defectDensities: Map<string, number>;
  riskValues: Map<string, number>;
  complexityDeltas: Map<string, number>;
  maxDefectDensityLog: number;
  maxRisk: number;
  maxComplexityDelta: number;
}

function moduleOverlayColor(node: GraphNode, overlay: OverlayKind, m: RampInputs): string {
  if (overlay === 'none') return NEUTRAL_MODULE;
  if (overlay === 'health') {
    return TIER_COLOR[(node.attributes.health_tier ?? 'unknown') as ModuleHealthTier];
  }
  if (overlay === 'defects') {
    const v = m.defectDensities.get(node.id) ?? 0;
    if (m.maxDefectDensityLog <= 0) return lerp(RAMP_GRAY_50, RAMP_END.defects, 0);
    const t = Math.log1p(v) / m.maxDefectDensityLog;
    return lerp(RAMP_GRAY_50, RAMP_END.defects, t);
  }
  if (overlay === 'risk') {
    const v = m.riskValues.get(node.id);
    if (v == null) return NEUTRAL_MODULE;
    const t = m.maxRisk > 0 ? v / m.maxRisk : v;
    return lerp(RAMP_GRAY_50, RAMP_END.risk, t);
  }
  if (overlay === 'complexity') {
    const v = m.complexityDeltas.get(node.id);
    if (v == null) return NEUTRAL_MODULE;
    const t = m.maxComplexityDelta > 0 ? v / m.maxComplexityDelta : 0;
    return lerp(RAMP_GRAY_50, PURPLE_600, t);
  }
  return NEUTRAL_MODULE;
}

export function colorForNodeWithOverlay(
  node: GraphNode,
  overlay: OverlayKind,
  metrics: OverlayMetrics,
): string {
  if (node.type === 'module') {
    return metrics.moduleColors.get(overlay)?.get(node.id) ?? NEUTRAL_MODULE;
  }
  if (node.type === 'file') {
    if (overlay === 'none' || !node.parent_id) return FILE_FALLBACK;
    const parentColor = metrics.moduleColors.get(overlay)?.get(node.parent_id) ?? FILE_FALLBACK;
    return lighten(parentColor, 0.45);
  }
  if (node.type === 'chunk') return CHUNK_COLOR;
  if (node.type === 'symbol') return SYMBOL_COLOR;
  return NEUTRAL_MODULE;
}

export interface LegendStop {
  label: string;
  color: string;
}

export function legendForOverlay(
  overlay: OverlayKind,
  metrics: OverlayMetrics,
): {
  title: string;
  stops: LegendStop[];
} | null {
  if (overlay === 'none') return null;
  if (overlay === 'health') {
    return {
      title: 'Module health',
      stops: [
        { label: 'green', color: TIER_COLOR.green },
        { label: 'amber', color: TIER_COLOR.amber },
        { label: 'red', color: TIER_COLOR.red },
        { label: 'unknown', color: TIER_COLOR.unknown },
      ],
    };
  }
  if (overlay === 'defects') {
    return {
      title: 'Defect density (log)',
      stops: [
        { label: 'low', color: lerp(RAMP_GRAY_50, RAMP_END.defects, 0) },
        { label: 'mid', color: lerp(RAMP_GRAY_50, RAMP_END.defects, 0.5) },
        { label: 'high', color: lerp(RAMP_GRAY_50, RAMP_END.defects, 1) },
      ],
    };
  }
  if (overlay === 'risk') {
    const cap = metrics.maxRisk > 0 ? metrics.maxRisk.toFixed(2) : '—';
    return {
      title: 'Risk floor',
      stops: [
        { label: '0.00', color: lerp(RAMP_GRAY_50, RAMP_END.risk, 0) },
        {
          label: (Math.max(metrics.maxRisk, 0) / 2).toFixed(2),
          color: lerp(RAMP_GRAY_50, RAMP_END.risk, 0.5),
        },
        { label: cap, color: lerp(RAMP_GRAY_50, RAMP_END.risk, 1) },
      ],
    };
  }
  if (overlay === 'complexity') {
    const cap = metrics.maxComplexityDelta > 0 ? metrics.maxComplexityDelta.toFixed(2) : '—';
    return {
      title: '|complexity − 1|',
      stops: [
        { label: '0.00', color: lerp(RAMP_GRAY_50, PURPLE_600, 0) },
        {
          label: (metrics.maxComplexityDelta / 2).toFixed(2),
          color: lerp(RAMP_GRAY_50, PURPLE_600, 0.5),
        },
        { label: cap, color: lerp(RAMP_GRAY_50, PURPLE_600, 1) },
      ],
    };
  }
  return null;
}
