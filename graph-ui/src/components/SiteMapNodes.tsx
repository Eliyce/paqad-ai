import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';

import type { Surface } from '../lib/site-map-types';
import { kindMeta, trustMeta } from '../lib/site-map-vocab';

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

const hiddenHandle = { opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1, border: 'none' };

export function SurfaceNode({ data }: NodeProps) {
  const node = data as SurfaceNodeData;
  const surface = node.surface;
  const meta = kindMeta(surface.kind);
  const rank = trustMeta(surface.trust).rank;
  const lowTrust = rank < 2;
  const unverified = rank === 0;
  const label = surface.label.length > 26 ? `${surface.label.slice(0, 25)}…` : surface.label;
  const zoom = useStore((state) => state.transform[2]);
  const showLabel = 12.5 * zoom >= 10;
  const showTag = 9 * zoom >= 10;
  const fullDetail = zoom >= 1.5;
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
