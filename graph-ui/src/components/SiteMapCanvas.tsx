import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type ColorMode,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';

import {
  cardCenter,
  layoutSiteMapDistricts,
  type StoredPositions,
} from '../lib/site-map-district-layout';
import { deadSurfaceIds, journeySurfaceIds } from '../lib/site-map-derive';
import { isMapOversized, SITE_MAP_MIN_ZOOM } from '../lib/site-map-fullscreen';
import type { AppMap, Journey, SiteMapStoredLayout } from '../lib/site-map-types';
import { guardList } from '../lib/site-map-types';
import { JourneyLines, type Station } from './JourneyLines';
import { SiteMapSearch } from './SiteMapSearch';
import { DistrictNode, districtTint, SurfaceNode, type DistrictNodeData } from './SiteMapNodes';

/**
 * The interactive city map (issue #489). Areas are districts that carry the structure by
 * containment, so a CLI-shaped map with zero transitions is a first-class citizen, not the
 * degenerate sliver the old edge-driven SVG produced (D1). React Flow 12 supplies the correct
 * gesture substrate — cursor-anchored zoom, pinch, non-passive wheel, fitView, minimap — so all of
 * D2..D5 die in the swap. Journeys draw as metro lines from their own step order (Phase 2, fixes
 * D6). It renders only the static layout it is handed, from the served payload (NFR-1), so the same
 * map always looks the same (LAY-2).
 */

interface Props {
  map: AppMap;
  journeys: Journey[];
  activeJourneyId: string | null;
  /** The current walk station (drives the camera flight); null when not walking. */
  walkStationId: string | null;
  selectedId: string | null;
  /** A focus request (from the insight line / gaps chip); the camera flies to `id` on each nonce. */
  focus: { id: string; nonce: number } | null;
  /** Team-shared district curation to honor; null before anyone has arranged the map. */
  stored: SiteMapStoredLayout | null;
  /** True in --read-only mode: the canvas hides its drag affordances and never persists. */
  readOnly: boolean;
  onSelect: (id: string | null) => void;
  onPickJourney: (id: string | null) => void;
  onPersistLayout: (districts: SiteMapStoredLayout) => void;
  onResetLayout: () => void;
}

const DISTRICT_PREFIX = 'district::';

const nodeTypes = {
  district: (props: NodeProps) => <DistrictNode {...props} />,
  surface: (props: NodeProps) => <SurfaceNode {...props} />,
};

const WHEEL_KEY = 'paqad.sitemap.wheel';
type WheelMode = 'pan' | 'zoom';

function districtNodeId(areaId: string): string {
  return `${DISTRICT_PREFIX}${areaId}`;
}

/** The stored layout carries x,y,w,h; the layout pass pins on x,y only (size stays computed). */
function toStoredPositions(stored: SiteMapStoredLayout | null): StoredPositions | undefined {
  if (stored === null || stored === undefined) return undefined;
  const positions: StoredPositions = {};
  for (const [areaId, placement] of Object.entries(stored)) {
    positions[areaId] = { x: placement.x, y: placement.y };
  }
  return positions;
}

/** Follow the dashboard's theme (set as data-theme on the root) so React Flow matches it. */
function useDashboardColorMode(): ColorMode {
  const read = (): ColorMode =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const [mode, setMode] = useState<ColorMode>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** The per-user wheel setting (locked decision): scroll pans by default; a toggle flips to zoom. */
function useWheelMode(): [WheelMode, (next: WheelMode) => void] {
  const [mode, setMode] = useState<WheelMode>(() =>
    localStorage.getItem(WHEEL_KEY) === 'zoom' ? 'zoom' : 'pan',
  );
  const set = useCallback((next: WheelMode) => {
    localStorage.setItem(WHEEL_KEY, next);
    setMode(next);
  }, []);
  return [mode, set];
}

function Flow({
  map,
  journeys,
  activeJourneyId,
  walkStationId,
  selectedId,
  focus,
  stored,
  readOnly,
  onSelect,
  onPickJourney,
  onPersistLayout,
  onResetLayout,
}: Props) {
  const { zoomIn, zoomOut, fitView, setCenter } = useReactFlow();
  const colorMode = useDashboardColorMode();
  const [wheelMode, setWheelMode] = useWheelMode();
  // True when a fit-to-view was clamped at the zoom floor: the map is wider than the window can show
  // at a readable zoom, so we point the reader at the minimap instead of shrinking cards (S7, FR-5).
  const [oversized, setOversized] = useState(false);
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const storedPositions = useMemo(() => toStoredPositions(stored), [stored]);
  const layout = useMemo(
    () => layoutSiteMapDistricts(map, storedPositions),
    [map, storedPositions],
  );
  const dead = useMemo(() => deadSurfaceIds(map), [map]);
  const activeJourney = useMemo(
    () => journeys.find((journey) => journey.id === activeJourneyId) ?? null,
    [journeys, activeJourneyId],
  );
  const journeyIds = useMemo(() => journeySurfaceIds(activeJourney), [activeJourney]);
  const journeyActive = activeJourney !== null;

  // Absolute centre of every surface card — the stations for the metro lines and camera flights.
  const centers = useMemo(() => {
    const map2 = new Map<string, Station>();
    for (const district of layout.districts) {
      for (const card of district.cards) map2.set(card.id, cardCenter(district, card));
    }
    return map2;
  }, [layout]);

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = [];
    for (const district of layout.districts) {
      out.push({
        id: districtNodeId(district.id),
        type: 'district',
        position: { x: district.x, y: district.y },
        data: {
          label: district.label,
          colorIndex: district.colorIndex,
          surfaceCount: district.surfaceCount,
        },
        width: district.width,
        height: district.height,
        selectable: false,
        draggable: !readOnly,
        zIndex: 0,
      });
      for (const card of district.cards) {
        out.push({
          id: card.id,
          type: 'surface',
          parentId: districtNodeId(district.id),
          extent: 'parent',
          position: { x: card.x, y: card.y },
          data: {
            surface: card.surface,
            dead: dead.has(card.id),
            selected: selectedId === card.id,
            dimmed: journeyActive && !journeyIds.has(card.id),
            guarded: guardList(card.surface.guard).length > 0,
            onSelect,
          },
          width: card.width,
          height: card.height,
          draggable: false,
          zIndex: 1,
        });
      }
    }
    return out;
  }, [layout, dead, selectedId, journeyActive, journeyIds, onSelect, readOnly]);

  // React Flow needs stateful nodes for dragging to stick; resync whenever the derived layout
  // changes (map/journey/selection/stored refresh), so a persisted drag reappears at its new home.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(nodes);
  useEffect(() => setRfNodes(nodes), [nodes, setRfNodes]);

  // On a district drop, persist the WHOLE current arrangement so every district becomes an
  // authoritative pin (new areas still append), and the team-shared layout survives refreshes.
  const onNodeDragStop = useCallback(() => {
    setRfNodes((current) => {
      const districts: SiteMapStoredLayout = {};
      for (const node of current) {
        if (node.type !== 'district') continue;
        const areaId = node.id.slice(DISTRICT_PREFIX.length);
        districts[areaId] = {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
          w: Math.round(node.width ?? node.measured?.width ?? 0),
          h: Math.round(node.height ?? node.measured?.height ?? 0),
        };
      }
      onPersistLayout(districts);
      return current;
    });
  }, [setRfNodes, onPersistLayout]);

  const edges = useMemo<Edge[]>(() => {
    const known = new Set(map.surfaces.map((surface) => surface.id));
    const out: Edge[] = [];
    for (const surface of map.surfaces) {
      (surface.transitions ?? []).forEach((transition, index) => {
        if (!known.has(transition.to)) return;
        const guarded =
          guardList(transition.guard).length > 0 || transition.guard_text !== undefined;
        out.push({
          id: `${surface.id}->${transition.to}#${index}`,
          source: surface.id,
          target: transition.to,
          type: 'smoothstep',
          label: transition.trigger,
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-muted)' },
          style: {
            stroke: 'var(--color-muted)',
            strokeWidth: 1.5,
            strokeDasharray: guarded ? '6 4' : undefined,
          },
          labelStyle: { fill: 'var(--color-muted)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--color-canvas)', fillOpacity: 0.9 },
        });
      });
    }
    return out;
  }, [map]);

  // Walk mode: fly the camera to the current station (UXR-15). Jump-cut under reduced motion.
  useEffect(() => {
    if (walkStationId === null) return;
    const station = centers.get(walkStationId);
    if (station === undefined) return;
    void setCenter(station.x, station.y, { zoom: 1.4, duration: reducedMotion ? 0 : 700 });
  }, [walkStationId, centers, setCenter, reducedMotion]);

  const flyToNode = useCallback(
    (id: string) => {
      void fitView({
        nodes: [{ id }],
        duration: reducedMotion ? 0 : 800,
        padding: 0.4,
        maxZoom: 1.5,
      });
    },
    [fitView, reducedMotion],
  );

  // Focus request from the insight line / gaps chip: fly to the named node whenever the nonce ticks.
  useEffect(() => {
    if (focus === null) return;
    flyToNode(focus.id);
  }, [focus, flyToNode]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') {
        zoomIn();
      } else if (event.key === '-') {
        zoomOut();
      } else if (event.key === '0') {
        fitView({ padding: 0.1 });
      } else if (event.shiftKey && event.code === 'Digit1') {
        fitView({ padding: 0.1 });
      } else if (event.shiftKey && event.code === 'Digit2' && selectedId !== null) {
        void fitView({ padding: 0.3, nodes: [{ id: selectedId }], maxZoom: 1.5 });
      } else {
        return;
      }
      event.preventDefault();
    },
    [zoomIn, zoomOut, fitView, selectedId],
  );

  return (
    <div
      className="relative h-full w-full"
      style={{ background: 'var(--color-canvas)' }}
      onKeyDown={onKeyDown}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        colorMode={colorMode}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={SITE_MAP_MIN_ZOOM}
        maxZoom={2}
        onMoveEnd={(_, viewport) => setOversized(isMapOversized(viewport.zoom, SITE_MAP_MIN_ZOOM))}
        panOnScroll={wheelMode === 'pan'}
        zoomOnScroll={wheelMode === 'zoom'}
        zoomOnPinch
        zoomOnDoubleClick
        panActivationKeyCode="Space"
        preventScrolling
        onlyRenderVisibleElements
        nodesDraggable={!readOnly}
        nodesConnectable={false}
        onNodeClick={(_, node) => {
          if (node.type === 'surface') onSelect(node.id);
        }}
        onPaneClick={() => onSelect(null)}
      >
        <Background gap={24} color="var(--color-border)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            node.type === 'district'
              ? districtTint((node.data as DistrictNodeData).colorIndex)
              : 'var(--color-border)'
          }
          maskColor="var(--color-canvas)"
          style={{ background: 'var(--color-surface)' }}
        />
        <JourneyLines
          journeys={journeys}
          activeJourneyId={activeJourneyId}
          centers={centers}
          walkStationId={walkStationId}
          reducedMotion={reducedMotion}
        />
      </ReactFlow>

      <SiteMapSearch
        map={map}
        journeys={journeys}
        onSelectSurface={(id) => {
          onSelect(id);
          flyToNode(id);
        }}
        onSelectArea={(id) => flyToNode(districtNodeId(id))}
        onPickJourney={onPickJourney}
      />

      <div className="absolute right-3 top-3 z-10 flex gap-1.5">
        <button
          type="button"
          onClick={() => setWheelMode(wheelMode === 'pan' ? 'zoom' : 'pan')}
          title="Toggle what the scroll wheel does"
          className="rounded-[8px] px-2.5 py-1 text-caption font-medium"
          style={{
            background: 'var(--color-surface)',
            color: 'var(--color-canvas-fg)',
            border: '1px solid var(--color-border)',
          }}
        >
          Scroll: {wheelMode}
        </button>
        <button
          type="button"
          onClick={() => fitView({ padding: 0.1 })}
          title="Reset view"
          className="rounded-[8px] px-2.5 py-1 text-caption font-medium"
          style={{
            background: 'var(--color-surface)',
            color: 'var(--color-canvas-fg)',
            border: '1px solid var(--color-border)',
          }}
        >
          Reset
        </button>
        {!readOnly && stored !== null && Object.keys(stored).length > 0 && (
          <button
            type="button"
            onClick={onResetLayout}
            title="Discard the saved district arrangement and revert to the computed layout"
            className="rounded-[8px] px-2.5 py-1 text-caption font-medium"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-canvas-fg)',
              border: '1px solid var(--color-border)',
            }}
          >
            Reset layout
          </button>
        )}
      </div>

      {/* Over-size hint (S7, FR-5): shown only when a fit was clamped at the zoom floor, so cards
          stay readable. It points at the minimap (bottom-right) rather than shrinking the map. */}
      {oversized && (
        <div
          className="absolute bottom-3 left-3 z-10 max-w-[60%] rounded-[8px] px-2.5 py-1 text-caption"
          style={{
            background: 'var(--color-surface)',
            color: 'var(--color-muted)',
            border: '1px solid var(--color-border)',
          }}
        >
          This map is larger than the window at a readable zoom. Use the minimap to move around.
        </div>
      )}
    </div>
  );
}

export function SiteMapCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
