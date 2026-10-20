import { ViewportPortal } from '@xyflow/react';

import type { Journey } from '../lib/site-map-types';
import { interchangeSurfaces, journeyColor, stationNumbers } from '../lib/site-map-journey';

export interface Station {
  x: number;
  y: number;
}

interface Props {
  journeys: Journey[];
  activeJourneyId: string | null;
  centers: Map<string, Station>;
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
