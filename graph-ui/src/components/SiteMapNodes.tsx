import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';

import type { Surface } from '../lib/site-map-types';
import { kindMeta, trustMeta } from '../lib/site-map-vocab';

/**
 * The two custom React Flow node types for the city map (issue #489): a `district` group that
 * carries the structure, and a `surface` card that wears its verification state. They are ordinary
 * React components styled with the existing `--color-*` design tokens, so the design-system rules
 * apply unchanged. The only non-token colour is a district's decorative tint, derived from a stable
 * hash of the area id — never the sole carrier of meaning, because the district's own label names
 * it (A11Y-3).
 */

/** 12 evenly spread hues; low alpha so one tint set reads over both the light and dark canvas. */
export function districtTint(colorIndex: number): string {
  const hue = Math.round((colorIndex / 12) * 360);
  return `hsl(${hue} 65% 50% / 0.12)`;
}

export interface DistrictNodeData {
  label: string;
  colorIndex: number;
  surfaceCount: number;
  [key: string]: unknown;
}

export function DistrictNode({ data }: NodeProps) {
  const district = data as DistrictNodeData;
  const zoom = useStore((state) => state.transform[2]);
  // Counter-scale the district name so it stays a roughly constant ~13px on screen: at the zoomed
  // out overview the districts are the primary content and must read (LOD tier k < 0.5), capped so
  // it never dominates the district box.
  const labelSize = Math.min(Math.max(13, 13 / zoom), 34);
  return (
    <div
      className="h-full w-full rounded-[14px]"
      style={{
        background: districtTint(district.colorIndex),
        border: '1px solid var(--color-border)',
      }}
    >
      <div
        className="flex items-center gap-2 px-3 pt-2 font-semibold"
        style={{ color: 'var(--color-canvas-fg)', fontSize: labelSize, lineHeight: 1.1 }}
      >
        <span className="truncate">{district.label}</span>
        <span style={{ color: 'var(--color-muted)', fontSize: '0.8em' }}>
          {district.surfaceCount}
        </span>
      </div>
    </div>
  );
}

export interface SurfaceNodeData {
  surface: Surface;
  dead: boolean;
  selected: boolean;
  dimmed: boolean;
  guarded: boolean;
  onSelect: (id: string) => void;
  [key: string]: unknown;
}

/** An invisible handle so real transition edges can attach without a visible connector dot. */
const hiddenHandle = { opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1, border: 'none' };

export function SurfaceNode({ data }: NodeProps) {
  const node = data as SurfaceNodeData;
  const surface = node.surface;
  const meta = kindMeta(surface.kind);
  const rank = trustMeta(surface.trust).rank;
  const lowTrust = rank < 2; // inferred/unverified reads dashed, not colour
  const unverified = rank === 0; // the least-earned tier gets the sketchy, foggy treatment
  const label = surface.label.length > 26 ? `${surface.label.slice(0, 25)}…` : surface.label;
  // Semantic zoom (LOD): hide any text whose effective on-screen size drops below 10px, so a
  // zoomed-out district reads as tinted blocks (tier k < 0.5) and detail appears as you zoom in.
  const zoom = useStore((state) => state.transform[2]);
  const showLabel = 12.5 * zoom >= 10;
  const showTag = 9 * zoom >= 10;
  const fullDetail = zoom >= 1.5; // entry markers + guard labels only at the closest tier
  // Status fidelity (Phase 3): the trust tier changes the RENDERING, not just a badge, and is
  // distinguishable without colour (A11Y-3). Proven surfaces are crisp and never fogged; inferred
  // is dashed and lightly fogged; unverified adds a slight sketch offset and desaturation. The
  // fog fades (200ms) when a refreshed map raises a surface's trust (proven is filter:none).
  const fog = node.dead ? 0.4 : node.dimmed ? 0.25 : unverified ? 0.72 : lowTrust ? 0.86 : 1;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${meta.family}: ${surface.label}`}
      onClick={() => node.onSelect(surface.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          node.onSelect(surface.id);
        }
      }}
      className="relative flex h-full w-full cursor-pointer flex-col items-center justify-center rounded-[10px] px-2"
      style={{
        background: 'var(--color-surface)',
        border: node.selected ? '2px solid var(--color-accent)' : '1.5px solid var(--color-border)',
        borderStyle: lowTrust ? 'dashed' : 'solid',
        opacity: fog,
        filter: unverified ? 'saturate(0.55)' : undefined,
        transform: unverified ? 'rotate(-0.5deg)' : undefined,
        transition: 'opacity 200ms ease, filter 200ms ease',
        outline: 'none',
      }}
    >
      <Handle type="target" position={Position.Left} style={hiddenHandle} isConnectable={false} />
      {showLabel && (
        <div
          className="max-w-full truncate text-center font-semibold"
          style={{ color: 'var(--color-canvas-fg)', fontSize: 12.5 }}
        >
          {label}
        </div>
      )}
      {showTag && (
        <div
          className="text-center"
          style={{ color: 'var(--color-muted)', fontSize: 9, letterSpacing: 0.4 }}
        >
          {meta.tag}
          {node.dead ? ' · dead' : ''}
        </div>
      )}
      {fullDetail && surface.entry !== undefined && (
        <span
          aria-hidden="true"
          title="Entry point"
          className="absolute left-1.5 top-1"
          style={{ color: 'var(--color-accent)', fontSize: 10 }}
        >
          ▶
        </span>
      )}
      {node.guarded && (
        <span
          aria-hidden="true"
          title="Gated: a guard applies"
          className="absolute right-1.5 top-1"
          style={{ color: 'var(--color-mod-amber)', fontSize: 10 }}
        >
          🔒
        </span>
      )}
      <Handle type="source" position={Position.Right} style={hiddenHandle} isConnectable={false} />
    </div>
  );
}
