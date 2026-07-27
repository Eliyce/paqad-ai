// Publication: derived, human- and agent-facing VIEWS of the canonical `app-map.yaml`.
// Everything here is a PURE, deterministic projection of facts already in the map — it
// authors no new facts (INV-2). Three views are produced:
//   1. index.md   — the ≤1k-token agent orientation layer (entries, areas, guards, journeys)
//   2. overview.md — a human overview with a deterministically generated Mermaid graph
//   3. registries  — surfaces projected into per-family tables (screens, apis)
// The impure writer that lands these on disk with differential refresh lives in `./publish.ts`.

import { PATHS } from '@/core/constants/paths.js';
import type { AppMap, Area, Surface, SurfaceEntry, Transition } from '@/core/types/site-map.js';

/** A single publishable view: where it goes, its rendered bytes, and the sources it projects. */
export interface SiteMapPublicationOutput {
  path: string;
  contents: string;
  /** Source files this view is derived from (drives the freshness/differential-refresh hash). */
  source_files: string[];
}

/** The token budget for `index.md` — the always-loaded orientation layer must stay lean. */
export const SITE_MAP_INDEX_TOKEN_BUDGET = 1000;

/** The fixed consult-and-verify rule (framework copy, not an inferred fact) prepended to index.md. */
export const SITE_MAP_CONSULT_RULE =
  '**Consult-and-verify rule:** before adding or changing a mapped surface, read the matching ' +
  'section of `app-map.yaml`. Every claim carries `evidence: file:line` — if the evidence no ' +
  'longer matches the code, trust the code and flag map drift (an SM finding), never edit around it.';

/** A deterministic, whitespace-based token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The map's app kinds as a flat, ordered list (one product may be several kinds). */
function appKinds(map: AppMap): string[] {
  return Array.isArray(map.app.kind) ? map.app.kind : [map.app.kind];
}

/** A surface's guard ids as a flat list (a surface may carry one guard or several). */
function surfaceGuards(surface: Surface): string[] {
  if (surface.guard === undefined) return [];
  return Array.isArray(surface.guard) ? surface.guard : [surface.guard];
}

/** A surface known to have an entry (narrowed by the caller's filter). */
type EntrySurface = Surface & { entry: SurfaceEntry };

/** Render a single entry-point surface as one bullet, noting its guard when present. */
function renderEntry(surface: EntrySurface): string {
  const via = surface.entry.value ?? surface.entry.kind;
  const guards = surfaceGuards(surface);
  const guardNote = guards.length > 0 ? ` (guard: ${guards.join(', ')})` : '';
  return `- **${surface.label}** — ${via}${guardNote}`;
}

/** The index's core sections: header, consult rule, entries, areas, guards, journeys. */
function indexCore(map: AppMap, journeyCount: number): string[] {
  const kinds = appKinds(map).join(' + ');
  const areas = [...(map.areas ?? [])];
  const backstage = areas.filter((area) => area.visibility === 'backstage').length;
  const entries = [...map.surfaces]
    .filter((surface): surface is EntrySurface => surface.entry !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
  const guards = [...(map.guards ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const journeys = [...(map.journeys ?? [])].sort((a, b) => a.id.localeCompare(b.id));

  const lines: string[] = [
    `# ${map.app.name} — site map index`,
    '',
    `> ${kinds}. ${map.surfaces.length} surfaces · ${areas.length} areas ` +
      `(${backstage} backstage) · ${journeyCount} journeys. ` +
      'Canonical map: `app-map.yaml`, journeys: `journeys/`.',
    '',
    SITE_MAP_CONSULT_RULE,
    '',
    '## Where things start (entries)',
    '',
  ];
  if (entries.length === 0) {
    lines.push('_No entry surfaces recorded._', '');
  } else {
    for (const surface of entries) lines.push(renderEntry(surface));
    lines.push('');
  }

  lines.push('## Areas', '');
  if (areas.length === 0) {
    lines.push('_No areas recorded._', '');
  } else {
    for (const area of [...areas].sort((a, b) => a.id.localeCompare(b.id))) {
      const count = map.surfaces.filter((surface) => surface.area === area.id).length;
      const stage = area.visibility === 'backstage' ? ' (backstage)' : '';
      lines.push(`- **${area.label}**${stage} — ${count} surfaces`);
    }
    lines.push('');
  }

  lines.push('## Guards that matter', '');
  if (guards.length === 0) {
    lines.push('_No guards recorded._', '');
  } else {
    for (const guard of guards) lines.push(`- \`${guard.id}\` (${guard.kind}) — ${guard.label}`);
    lines.push('');
  }

  lines.push('## Journeys', '');
  if (journeys.length === 0) {
    lines.push('_No journeys recorded._', '');
  } else {
    for (const journey of journeys) {
      const status = journey.status ?? 'proposed';
      lines.push(`- **${journey.label}** (\`${journey.id}\`, ${status})`);
    }
    lines.push('');
  }

  return lines;
}

/** The index's optional tier — dropped first under token pressure. */
function indexOptional(map: AppMap): string[] {
  const backstage = [...(map.areas ?? [])]
    .filter((area) => area.visibility === 'backstage')
    .sort((a, b) => a.id.localeCompare(b.id));
  if (backstage.length === 0) return [];
  const lines = ['## Background (optional detail)', ''];
  for (const area of backstage) {
    const surfaces = map.surfaces
      .filter((surface) => surface.area === area.id)
      .map((surface) => surface.label)
      .sort();
    lines.push(`- **${area.label}**: ${surfaces.join(', ') || '_no surfaces_'}`);
  }
  lines.push('');
  return lines;
}

/**
 * Render the token-budgeted `index.md`. The core sections always render; the optional
 * background tier is dropped when including it would blow the budget, with a one-line note
 * so the omission is honest rather than silent.
 */
export function buildSiteMapIndex(
  map: AppMap,
  journeyCount: number,
  budget: number = SITE_MAP_INDEX_TOKEN_BUDGET,
): string {
  const core = indexCore(map, journeyCount);
  const optional = indexOptional(map);
  const full = [...core, ...optional];
  if (optional.length === 0 || estimateTokens(`${full.join('\n')}\n`) <= budget) {
    return `${full.join('\n')}\n`;
  }
  const trimmed = [
    ...core,
    `_Optional background detail omitted to stay within the ${budget}-token index budget._`,
    '',
  ];
  return `${trimmed.join('\n')}\n`;
}

/** Turn a surface id into a Mermaid-safe node id (alphanumerics and underscores only). */
export function toMermaidId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '_');
}

/** Escape a label for a Mermaid quoted node/edge string. */
function escapeMermaid(label: string): string {
  return label.replace(/"/g, '&quot;');
}

/** Wrap a node label in the bracket shape that matches the surface kind. */
function mermaidNode(surface: Surface): string {
  const id = toMermaidId(surface.id);
  const label = `"${escapeMermaid(surface.label)}"`;
  if (surface.kind === 'terminal') return `${id}([${label}])`;
  if (surface.kind === 'decision-pause' || surface.kind === 'router') return `${id}{${label}}`;
  return `${id}[${label}]`;
}

/** A transition's guard ids as a flat list. */
function transitionGuards(transition: Transition): string[] {
  if (transition.guard === undefined) return [];
  return Array.isArray(transition.guard) ? transition.guard : [transition.guard];
}

/** Emit the Mermaid subgraph lines for one area (its surfaces, sorted). */
function mermaidArea(area: Area, surfaces: Surface[]): string[] {
  const lines = [`  subgraph ${toMermaidId(area.id)}["${escapeMermaid(area.label)}"]`];
  for (const surface of surfaces) lines.push(`    ${mermaidNode(surface)}`);
  lines.push('  end');
  return lines;
}

/**
 * Build `overview.md` with a deterministically generated Mermaid flowchart: areas become
 * subgraphs, surfaces become nodes, and each transition to an existing surface becomes a
 * labelled edge. Ordering is fully sorted so the same map always yields byte-identical output.
 */
export function buildSiteMapOverview(map: AppMap): string {
  const surfaces = [...map.surfaces].sort((a, b) => a.id.localeCompare(b.id));
  const knownIds = new Set(surfaces.map((surface) => surface.id));
  const areas = [...(map.areas ?? [])].sort((a, b) => {
    const stage = Number(a.visibility === 'backstage') - Number(b.visibility === 'backstage');
    return stage !== 0 ? stage : a.id.localeCompare(b.id);
  });

  const graph: string[] = ['```mermaid', 'flowchart LR'];
  const placed = new Set<string>();
  for (const area of areas) {
    const areaSurfaces = surfaces.filter((surface) => surface.area === area.id);
    if (areaSurfaces.length === 0) continue;
    graph.push(...mermaidArea(area, areaSurfaces));
    for (const surface of areaSurfaces) placed.add(surface.id);
  }
  const loose = surfaces.filter((surface) => !placed.has(surface.id));
  for (const surface of loose) graph.push(`  ${mermaidNode(surface)}`);

  const edges: string[] = [];
  for (const surface of surfaces) {
    for (const transition of [...(surface.transitions ?? [])].sort((a, b) =>
      `${a.to}\0${a.trigger}`.localeCompare(`${b.to}\0${b.trigger}`),
    )) {
      if (!knownIds.has(transition.to)) continue;
      const guards = transitionGuards(transition);
      const guardNote = guards.length > 0 ? ` [${guards.join(', ')}]` : '';
      const label = escapeMermaid(`${transition.trigger}${guardNote}`);
      edges.push(`  ${toMermaidId(surface.id)} -->|"${label}"| ${toMermaidId(transition.to)}`);
    }
  }
  graph.push(...edges, '```');

  return (
    [
      `# ${map.app.name} — behavioural overview`,
      '',
      'The districts of this product and how a user moves between them. Generated from ' +
        '`app-map.yaml`; edit the map, not this file.',
      '',
      '## Districts',
      '',
      ...graph,
      '',
      '_Rounded nodes are terminals; diamonds are routers or decision pauses; edge labels ' +
        'are the trigger and any guard._',
      '',
    ].join('\n') + '\n'
  );
}

/** Render a surface family into a registry markdown table (id, label, area, guard, evidence). */
function renderRegistry(title: string, intro: string, surfaces: Surface[]): string {
  const rows = [...surfaces].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    `# ${title}`,
    '',
    intro,
    '',
    '| Surface | Label | Area | Guard |',
    '| --- | --- | --- | --- |',
  ];
  for (const surface of rows) {
    const guards = surfaceGuards(surface);
    const guard = guards.length > 0 ? guards.join(', ') : '—';
    lines.push(`| \`${surface.id}\` | ${surface.label} | ${surface.area ?? '—'} | ${guard} |`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

const SCREEN_KINDS = new Set<Surface['kind']>(['page', 'screen', 'modal']);
const API_KINDS = new Set<Surface['kind']>(['api', 'webhook']);

/**
 * Project the map into registry views, one per surface family that actually has surfaces.
 * An empty family emits no file, so a CLI-only product carries no vacuous screen registry.
 */
export function buildSiteMapRegistries(map: AppMap): SiteMapPublicationOutput[] {
  const outputs: SiteMapPublicationOutput[] = [];
  const screens = map.surfaces.filter((surface) => SCREEN_KINDS.has(surface.kind));
  if (screens.length > 0) {
    outputs.push({
      path: PATHS.SITE_MAP_SCREEN_REGISTRY,
      contents: renderRegistry(
        'Screen registry',
        'Every visual surface (page, screen, modal) in the map.',
        screens,
      ),
      source_files: [PATHS.SITE_MAP_APP_MAP],
    });
  }
  const apis = map.surfaces.filter((surface) => API_KINDS.has(surface.kind));
  if (apis.length > 0) {
    outputs.push({
      path: PATHS.SITE_MAP_API_REGISTRY,
      contents: renderRegistry(
        'API registry',
        'Every programmatic surface (api, webhook) in the map.',
        apis,
      ),
      source_files: [PATHS.SITE_MAP_APP_MAP],
    });
  }
  return outputs;
}

/** Assemble every publishable view of the map (pure). Order is stable: index, overview, registries. */
export function assembleSiteMapPublication(
  map: AppMap,
  journeyCount: number,
): SiteMapPublicationOutput[] {
  return [
    {
      path: PATHS.SITE_MAP_INDEX,
      contents: buildSiteMapIndex(map, journeyCount),
      source_files: [PATHS.SITE_MAP_APP_MAP],
    },
    {
      path: PATHS.SITE_MAP_OVERVIEW,
      contents: buildSiteMapOverview(map),
      source_files: [PATHS.SITE_MAP_APP_MAP],
    },
    ...buildSiteMapRegistries(map),
  ];
}
