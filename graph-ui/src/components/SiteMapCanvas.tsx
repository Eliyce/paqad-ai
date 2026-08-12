import { useMemo, useRef, useState } from 'react';

import { layoutSiteMap, type LaidOutEdge, type LaidOutNode } from '../lib/site-map-layout';
import type { AppMap, Journey } from '../lib/site-map-types';
import { guardList } from '../lib/site-map-types';
import { kindMeta, trustMeta } from '../lib/site-map-vocab';

/**
 * The interactive visual map (issue #466). An SVG canvas the person can pan, zoom, and select on.
 * The whole map fits on first paint (overview-first, LAY-3); zoom reveals detail. It renders only
 * the static layout it is handed, so the same map always looks the same (LAY-2). Journeys are the
 * hero: pick one and its path lights up while everything else steps back (JM-1).
 */

interface Props {
  map: AppMap;
  activeJourney: Journey | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface View {
  x: number;
  y: number;
  k: number;
}

/** Surfaces that are dead: no entry, no inbound edge, and no outbound edge (DEAD-1, dimmed). */
function deadSurfaceIds(map: AppMap): Set<string> {
  const hasInbound = new Set<string>();
  const hasOutbound = new Set<string>();
  const known = new Set(map.surfaces.map((surface) => surface.id));
  for (const surface of map.surfaces) {
    for (const transition of surface.transitions ?? []) {
      if (!known.has(transition.to)) continue;
      hasOutbound.add(surface.id);
      hasInbound.add(transition.to);
    }
  }
  const dead = new Set<string>();
  for (const surface of map.surfaces) {
    const rooted = surface.entry !== undefined;
    if (!rooted && !hasInbound.has(surface.id) && !hasOutbound.has(surface.id)) {
      dead.add(surface.id);
    }
  }
  return dead;
}

/** The surface ids a journey visits, and the ordered pairs it steps between. */
function journeyPath(journey: Journey | null): { nodes: Set<string>; pairs: Set<string> } {
  const nodes = new Set<string>();
  const pairs = new Set<string>();
  if (journey === null) return { nodes, pairs };
  const steps = journey.steps.map((step) => step.surface);
  for (const surface of steps) nodes.add(surface);
  for (let i = 0; i < steps.length - 1; i += 1) {
    pairs.add(`${steps[i]}->${steps[i + 1]}`);
  }
  return { nodes, pairs };
}

function nodeShapePath(node: LaidOutNode) {
  const { x, y, width, height, surface } = node;
  const meta = kindMeta(surface.kind);
  const dashed = trustMeta(surface.trust).rank < 2; // low trust reads dashed, not just a colour
  const stroke = 'var(--color-border)';
  const common = {
    fill: 'var(--color-surface)',
    stroke,
    strokeWidth: 1.5,
    strokeDasharray: dashed ? '5 4' : undefined,
  };
  if (meta.shape === 'diamond') {
    const cx = x + width / 2;
    const cy = y + height / 2;
    return (
      <polygon
        points={`${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`}
        {...common}
      />
    );
  }
  if (meta.shape === 'slanted') {
    const skew = 12;
    return (
      <polygon
        points={`${x + skew},${y} ${x + width},${y} ${x + width - skew},${y + height} ${x},${y + height}`}
        {...common}
      />
    );
  }
  const rx = meta.shape === 'stadium' ? height / 2 : 10;
  return <rect x={x} y={y} width={width} height={height} rx={rx} {...common} />;
}

export function SiteMapCanvas({ map, activeJourney, selectedId, onSelect }: Props) {
  const layout = useMemo(() => layoutSiteMap(map), [map]);
  const dead = useMemo(() => deadSurfaceIds(map), [map]);
  const path = useMemo(() => journeyPath(activeJourney), [activeJourney]);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const panning = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const journeyActive = activeJourney !== null;

  function zoomBy(factor: number): void {
    setView((v) => ({ ...v, k: Math.max(0.2, Math.min(4, v.k * factor)) }));
  }

  function reset(): void {
    setView({ x: 0, y: 0, k: 1 });
  }

  function onWheel(event: React.WheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({ ...v, k: Math.max(0.2, Math.min(4, v.k * factor)) }));
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>): void {
    panning.current = { px: event.clientX, py: event.clientY, ox: view.x, oy: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>): void {
    const pan = panning.current;
    if (pan === null) return;
    setView((v) => ({
      ...v,
      x: pan.ox + (event.clientX - pan.px),
      y: pan.oy + (event.clientY - pan.py),
    }));
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>): void {
    panning.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const dimmed = (id: string): boolean => journeyActive && !path.nodes.has(id);
  const edgeOn = (edge: LaidOutEdge): boolean => path.pairs.has(`${edge.from}->${edge.to}`);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: 'var(--color-canvas)' }}
    >
      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        <CanvasButton label="Zoom in" onClick={() => zoomBy(1.2)}>
          +
        </CanvasButton>
        <CanvasButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          −
        </CanvasButton>
        <CanvasButton label="Reset view" onClick={reset}>
          Reset
        </CanvasButton>
      </div>

      <svg
        ref={svgRef}
        role="img"
        aria-label="Site map diagram"
        width="100%"
        height="100%"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: panning.current ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <defs>
          <marker
            id="sm-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-muted)" />
          </marker>
          <marker
            id="sm-arrow-on"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
          </marker>
        </defs>

        <rect
          x={0}
          y={0}
          width={layout.width}
          height={layout.height}
          fill="transparent"
          onClick={() => onSelect(null)}
        />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* Districts behind everything (AREA-1). */}
          {layout.areas.map((area) => (
            <g key={area.id}>
              <rect
                x={area.x}
                y={area.y}
                width={area.width}
                height={area.height}
                rx={14}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <text
                x={area.x + 10}
                y={area.y + 16}
                fontSize={12}
                fontWeight={600}
                fill="var(--color-muted)"
              >
                {area.label}
              </text>
            </g>
          ))}

          {/* Edges: directed, trigger-labelled, dashed when guarded (EDGE-1..3). */}
          {layout.edges.map((edge) => {
            const on = edgeOn(edge);
            const faded = journeyActive && !on;
            const guarded =
              guardList(edge.transition.guard).length > 0 ||
              edge.transition.guard_text !== undefined;
            const d = edge.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            return (
              <g key={edge.id} opacity={faded ? 0.15 : 1}>
                <path
                  d={d}
                  fill="none"
                  stroke={on ? 'var(--color-accent)' : 'var(--color-muted)'}
                  strokeWidth={on ? 2.5 : 1.5}
                  strokeDasharray={guarded ? '6 4' : undefined}
                  markerEnd={on ? 'url(#sm-arrow-on)' : 'url(#sm-arrow)'}
                />
                <g transform={`translate(${edge.labelX} ${edge.labelY})`}>
                  <rect
                    x={-edge.transition.trigger.length * 3.2 - 4}
                    y={-9}
                    width={edge.transition.trigger.length * 6.4 + 8}
                    height={16}
                    rx={4}
                    fill="var(--color-canvas)"
                    opacity={0.9}
                  />
                  <text textAnchor="middle" y={3} fontSize={10.5} fill="var(--color-muted)">
                    {edge.transition.trigger}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Nodes: shape by kind, business label, kind tag, guard + dead cues (NODE-1..5). */}
          {layout.nodes.map((node) => {
            const surface = node.surface;
            const meta = kindMeta(surface.kind);
            const isDead = dead.has(surface.id);
            const isSelected = selectedId === surface.id;
            const faded = dimmed(surface.id);
            const guarded = guardList(surface.guard).length > 0;
            return (
              <g
                key={surface.id}
                opacity={isDead ? 0.4 : faded ? 0.25 : 1}
                tabIndex={0}
                role="button"
                aria-label={`${meta.family}: ${surface.label}`}
                style={{ cursor: 'pointer', outline: 'none' }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(surface.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(surface.id);
                  }
                }}
              >
                {nodeShapePath(node)}
                {isSelected && (
                  <rect
                    x={node.x - 3}
                    y={node.y - 3}
                    width={node.width + 6}
                    height={node.height + 6}
                    rx={12}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                  />
                )}
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2 - 4}
                  textAnchor="middle"
                  fontSize={12.5}
                  fontWeight={600}
                  fill="var(--color-canvas-fg)"
                >
                  {surface.label.length > 26 ? `${surface.label.slice(0, 25)}…` : surface.label}
                </text>
                <text
                  x={node.x + node.width / 2}
                  y={node.y + node.height / 2 + 11}
                  textAnchor="middle"
                  fontSize={9}
                  letterSpacing={0.4}
                  fill="var(--color-muted)"
                >
                  {meta.tag}
                  {isDead ? ' · dead' : ''}
                </text>
                {guarded && <LockGlyph x={node.x + node.width - 15} y={node.y + 6} />}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function LockGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <title>Gated: a guard applies</title>
      <rect x={0} y={4} width={9} height={7} rx={1.5} fill="var(--color-mod-amber)" />
      <path
        d="M 1.5 4 V 2.5 A 3 3 0 0 1 7.5 2.5 V 4"
        fill="none"
        stroke="var(--color-mod-amber)"
        strokeWidth={1.3}
      />
    </g>
  );
}

function CanvasButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-[8px] px-2.5 py-1 text-caption font-medium"
      style={{
        background: 'var(--color-surface)',
        color: 'var(--color-canvas-fg)',
        border: '1px solid var(--color-border)',
      }}
    >
      {children}
    </button>
  );
}
