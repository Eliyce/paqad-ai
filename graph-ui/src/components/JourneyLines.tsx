import { ViewportPortal } from '@xyflow/react';

import type { Journey } from '../lib/site-map-types';
import { interchangeSurfaces, journeyColor, stationNumbers } from '../lib/site-map-journey';

/**
 * The metro lines (issue #489, Phase 2, UXR-1/2) — the hero of the map. Each journey is a thick
 * coloured polyline threading its ordered stations, drawn from the journey's own steps, so it works
 * on a map with zero transitions (fixes D6). Rendered inside React Flow's viewport portal, so it
 * pans and zooms with the map for free, in the same absolute coordinate space as the surface cards.
 *
 * When a journey is selected its line is bright with numbered stations; the others stay thin and
 * desaturated so the map always shows its transit network. Interchanges (a surface on 2+ journeys)
 * wear the classic double ring. The reveal animation respects prefers-reduced-motion.
 */

export interface Station {
  x: number;
  y: number;
}

interface Props {
  journeys: Journey[];
  activeJourneyId: string | null;
  /** Absolute centre of every surface card, keyed by surface id. */
  centers: Map<string, Station>;
  /** The station the walk is currently on, glowing "you are here" (UXR-16). */
  walkStationId: string | null;
  reducedMotion: boolean;
}

function points(journey: Journey, centers: Map<string, Station>): Station[] {
  return journey.steps
    .map((step) => centers.get(step.surface))
    .filter((station): station is Station => station !== undefined);
}

function pathData(stations: Station[]): string {
  return stations.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.x} ${s.y}`).join(' ');
}

export function JourneyLines({
  journeys,
  activeJourneyId,
  centers,
  walkStationId,
  reducedMotion,
}: Props) {
  const interchange = interchangeSurfaces(journeys);
  return (
    <ViewportPortal>
      <svg
        width={1}
        height={1}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {journeys.map((journey, index) => {
          const active = journey.id === activeJourneyId;
          const idle = activeJourneyId !== null && !active;
          const stations = points(journey, centers);
          if (stations.length < 2) return null;
          const color = journeyColor(index);
          return (
            <path
              key={journey.id}
              d={pathData(stations)}
              fill="none"
              stroke={color}
              strokeWidth={active ? 6 : 4}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={idle ? 0.18 : active ? 1 : 0.4}
              pathLength={1}
              style={
                active && !reducedMotion
                  ? {
                      strokeDasharray: 1,
                      strokeDashoffset: 1,
                      animation: 'sm-metro-reveal 600ms ease-out forwards',
                    }
                  : undefined
              }
            />
          );
        })}

        {/* Stations for the active journey: numbered circles, double ring for interchanges. */}
        {journeys.map((journey, index) => {
          if (journey.id !== activeJourneyId) return null;
          const color = journeyColor(index);
          const numbers = stationNumbers(journey);
          return [...numbers.entries()].map(([surface, number]) => {
            const center = centers.get(surface);
            if (center === undefined) return null;
            const here = surface === walkStationId;
            return (
              <g key={`${journey.id}:${surface}`} transform={`translate(${center.x} ${center.y})`}>
                {here && <circle r={18} fill="none" stroke={color} strokeWidth={2} opacity={0.5} />}
                {interchange.has(surface) && (
                  <circle r={13} fill="var(--color-surface)" stroke={color} strokeWidth={2} />
                )}
                <circle r={10} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
                <text textAnchor="middle" y={3.5} fontSize={11} fontWeight={700} fill="#ffffff">
                  {number}
                </text>
              </g>
            );
          });
        })}
      </svg>
    </ViewportPortal>
  );
}
