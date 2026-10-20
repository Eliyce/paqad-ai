# Graph UI (React 19 + Vite SPA) — Technical View

> Module: **Project Graph Command** (`cli-graph`) · Layer: `cli-commands` · Feature slug: `graph-ui`

## Module Boundaries

Source directories owned by this feature:

- `graph-ui`



## Entry Points

- CLI entry: `paqad-ai graph ui` (verify exact flag set in the source).

## Data Model / Schema

- Tables, JSON schemas, or YAML schemas owned by this feature.
- For `cli-commands` modules, this usually means the file shape under `.paqad/` or
  the validated input/output contract.

## API / Interface Contract

- Public functions exported from the source files above.
- CLI flags / arguments (if applicable).
- Agent-callable skill names or workflow trigger phrases (if applicable).

## State Management

- What state this feature reads.
- What state this feature writes.
- Where that state is persisted (`.paqad/**`, project files, in-memory only).

## Error Codes

- Structured error IDs emitted by this feature.
- Mapping from error ID → user-facing message → recovery action.

## Dependencies

- **Internal:** other paqad-ai modules this feature imports or calls.
- **External:** npm packages, system binaries (`node`, `git`, etc.).
- **Runtime data:** files that must already exist before this feature runs.

## Configuration

- Environment variables read.
- Config keys in `.paqad/project-profile.yaml` or `.paqad/onboarding-manifest.json`.
- Default values and override precedence.

## Testing Entry Points

- Unit test files that cover `graph-ui` directly.
- Integration tests that exercise this feature end-to-end.
- Manual verification commands (CLI invocations, agent prompts).

## Observability

- Console output / log lines emitted.
- Tracker writes (`.paqad/doc-progress.json`, `.paqad/stack-drift.json`, etc.).
- Exit codes (for CLI features).

## Why the code works the way it does

The reasons below are not obvious from the code, grouped by file under `graph-ui/`.

- **`vite.config.ts` and `vitest.config.ts`.** The build writes into the path the CLI server
  serves at runtime. The SPA is checked by `vite build`, not by coverage. The one exception is
  `src/lib/site-map-district-layout.ts`, which is unit-tested to full coverage because a silent
  reflow there would break the reader's spatial memory with nothing else to catch it, so coverage
  is scoped to exactly that file. The other pure `src/lib/` files keep their branch tests too.
- **`src/lib/router.ts` and `App.tsx`.** A tiny hash router on purpose, so the SPA does not pull in
  react-router. Pulse is the home route, `#/dashboard` still serves the older full-status view, and
  `paqad-ai graph` opens `/#/graph` so its old shortcut keeps working. Every view shares the same
  design tokens and the one `/api/events` stream.
- **Type mirrors (`src/lib/types.ts`, `dashboard-types.ts`, `site-map-types.ts`,
  `site-map-progress.ts`).** graph-ui is a separate package and cannot import the engine's types,
  so these files copy the server shapes by hand (`src/graph/types.ts`, `src/dashboard/types.ts`
  and the files it names, the site-map engine types, `src/core/types/site-map-progress.ts`). Only
  the fields the UI reads are mirrored. Change both sides together.
- **`src/lib/api.ts`.** A 422 (validation) or 409 (edit conflict, with the current content) is an
  expected outcome the editors render, so it comes back as a value. Only transport and guard
  failures (403 read-only, network) throw, with the server's sentence. Starting an ops job that is
  already running is a 409 that throws, because there is nothing to merge.
- **`components/ConflictPanel.tsx`.** Every managed-file editor shows this on a 409: a side by side
  diff of your edit against what is on disk now, with exactly two ways out.
- **`components/CodeEditor.tsx`.** The CodeMirror view is created once. It remembers the last value
  it emitted so an echo of its own change does not replace the document while you type.
- **`components/CommandPalette.tsx` and `SiteMapSearch.tsx`.** The palette is stateless: it only
  navigates or opens the packet export. The why drawer keeps the product's only shadow, so the
  palette uses a thin border instead. While the Site map is on screen its own search claims
  Cmd/Ctrl+K in the capture phase and stops propagation, so the two palettes never both open.
- **`components/DashboardChrome.tsx`, `OnboardingChecklist.tsx`, `TrustView.tsx`.** localStorage can
  throw in private mode; the toggle or checklist then just works for this session. Sub-pages light
  their parent area (delivery policy under Automation, instructions and design tokens under
  Knowledge, the module map under Build). The Site map hides the sidebar in full screen. Icons are
  inline SVG, no icon library.
- **`components/OnboardingChecklist.tsx`.** Steps complete from real events the server reports,
  never from clicks. The one exception, opening the first receipt, is recorded client side by the
  Trust view. Dismissing hides it for good and sends nothing.
- **`components/GraphCanvas.tsx`.** Sigma's WebGL renderer ignores rgba alpha on node fills, so
  dimming blends toward a neutral gray instead. Modules are sized by how many files they hold.
  Visibility is the layer toggle OR the semantic zoom level, and an edge shows only when both ends
  are visible. The overlay is deliberately not a dependency of the layout effect, so recolouring
  never reruns the layout worker. Similarity edges merged earlier are cleared first, so changing
  the threshold is not additive. The camera is saved and restored across live reloads.
- **`components/OpButton.tsx`.** A running job follows its SSE progress messages and also polls
  lightly, as a backstop when the stream drops. A destructive action asks inline with its
  consequence sentence instead of a bare are-you-sure.
- **`components/SchemaForm.tsx`.** Anything the form cannot show faithfully (records with arbitrary
  keys, arrays of objects, unions) falls back to a JSON textarea, so no value is ever lost.
- **`components/DetailPanel.tsx`.** A shareable view withholds the failing detail and the raw spec
  sheet; both show only in the working view.
- **Site map (`lib/site-map-district-layout.ts`, `SiteMapCanvas.tsx`, `SiteMapNodes.tsx`,
  `JourneyLines.tsx`).** App maps, CLI tools especially, have many surfaces and few transitions, so
  the layout is containment first: each area is a district box with a card grid, and dagre runs
  only on connected chains inside a district. The layout is pure and deterministic (no DOM, clock
  or randomness), so the same map always looks the same. A district tint comes from a stable hash
  of its id and never carries meaning alone, since the district label names it. A stored team
  layout pins only x and y (size stays computed); districts without a stored place flow below the
  pinned ones, and a drop saves the whole arrangement. React Flow needs stateful nodes for drags
  to stick, so they resync whenever the derived layout changes. Journeys draw from their own step
  order, so lines exist even with zero transitions. Text smaller than about 10px on screen is
  hidden, and the trust tier changes how a card renders (dashed, fogged), not just its badge, so it
  reads without colour. The wheel pans by default. React Flow attribution is hidden through
  `proOptions`, and the theme follows `data-theme`.
- **Site map full screen (`lib/site-map-fullscreen.ts`, `SiteMapView.tsx`).** The decisions live
  in pure functions so they can be unit-tested while the components stay thin. Full screen is
  never stored, so a page load can never open trapped in it. The Fullscreen API is tried first; if
  it is missing or rejected (an embedded host), a fixed CSS container is used instead. Escape exits
  only while full screen is active, and every key is ignored while typing in a field. The zoom
  floor was raised from 0.05, where a card is an unreadable speck; when a fit lands on the floor
  the map shows a hint pointing at the minimap instead of shrinking further. Transitions honour
  `prefers-reduced-motion`.
- **Site map honesty (`lib/site-map-vocab.ts`, `lib/site-map-derive.ts`, `lib/site-map-progress.ts`).**
  Everything is read from the served payload, nothing is resolved at view time and no model is
  called. A lower trust tier is never shown or counted as a higher one, and before the map is
  verified the freshness verdict is "not yet checked", not fresh or stale. The progress strip
  renders nothing when there is no progress file or no units, never an empty bar.
- **`views/DeliveryPolicyView.tsx`.** The builder edits a YAML document in place, so the user's
  comments and key order survive. Broken YAML on disk opens in raw mode with the parse message.
- **`views/DesignTokensView.tsx`.** The raw JSON text is the source of truth; the swatches and list
  write back through it, so the two can never disagree.
- **`views/InstructionsView.tsx`.** Untouched frontmatter is kept byte for byte. The Markdown
  preview renders the file body as HTML, which is acceptable because instruction files are
  project local and the server allowlists writes.
- **`views/TrustView.tsx` and `index.css`.** Evidence is view and export only, because editable
  evidence is worthless. Clause chips say "evidence toward", never "compliant". The receipt seal is
  the product's only spring animation, played once on the newest receipt when it arrives live.
- **`lib/activity.ts`.** AI activity per module is projected from the existing receipts, not a new
  store. Receipts without a verified time are skipped, and a module counts as recently active for
  30 days.
- **`lib/copy.ts`.** Raw tier names and engineering metrics never reach a user-facing surface.
