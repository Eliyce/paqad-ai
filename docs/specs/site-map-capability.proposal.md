# Proposal — The Site Map & Journeys capability ("create site map")

Status: **proposal** (draft for review — not frozen). Owner: Haider. Date: 2026-07-27.

This is a **functional** design: what we build, why it works, and how it pays off for both LLMs and humans. It deliberately contains no implementation code. Illustrative YAML fragments show the *shape* of the artifacts, nothing more.

It is the synthesis of three research passes: (1) an enrichment of the original idea, (2) web research into industry standards and academic state of the art, (3) a deep audit of the current paqad-ai codebase (documentation pipeline, dashboard/graph architecture, packs/detection, pentest surface mapping).

---

## 0. Executive summary

paqad-ai today answers one of the two questions an agent (or a new teammate) must ask about any software:

| Question | Answered today by | Status |
| --- | --- | --- |
| **"Where does the code live?"** | `docs/instructions/rules/module-map.yml` + module docs + Graph area | ✅ shipped |
| **"How does the application behave?"** — entries, screens/routes/commands, transitions, who can go where, which journeys exist | *nothing structured* | ❌ the gap |

We introduce a third documentation stage, **`create site map`**, next to `create documentation` and `create module documentation`. It produces a **machine-readable behavioral map of the application** — every entry point, every surface (page, screen, endpoint, CLI command, job), every transition between them, the guards on those transitions (auth, roles, feature flags), and a curated set of named **journeys** ("guest signs up and reaches the dashboard", "admin exports the audit log"). The map is:

- **canonical as diff-friendly YAML** under `docs/instructions/site-map/`, schema-versioned and evidence-linked (every element cites `file:line`),
- **rendered visually** as a new dashboard area next to Graph — one page showing the whole application flow with filters, search, journey playback, overlays, and a gap panel,
- **kept in sync** by the same differential-refresh, drift-detection, and verification-gate machinery the existing docs already use,
- **consumed downstream**: agent context (large token savings on flow questions), regression-test skeletons per journey, "untested journeys" reporting, pentest surface seeding, analytics alignment, and gap detection (unreachable screens, dead ends, guard-less admin surfaces).

One sentence: **the module map says where the code lives; the site map says how the product flows. Together they give the agent — and any human — the full picture without opening the app.**

---

## Part I — The idea, enriched

### 1.1 What the original idea asked for

> "You are entering in a system, and then that entry leads you to the other paths … creating the map of the whole website … creating the journeys as well … a technical document (XML, YAML, JSON) that can later be sent to the LLM … visible on the dashboard … one page where you can see the entry, the exit, and every single endpoint … it should keep updating as the current documentation is kept updated. Good for LLM. Good for human."

### 1.2 What we add on top (the enrichment)

The research turned up nine ideas that make the difference between "a diagram" and "a living behavioral contract". Each is folded into the design in Part II:

1. **Guards are first-class, and satisfiable.** "Admin dashboard requires role:admin" is not a footnote on an arrow — it is a named, reusable guard object. Crucially, every guard carries a *satisfiability hint* ("to become admin, run the `login-as-admin` journey / use fixture X"). This one field is what separates a map you can *draw* from a map you can *test* (model-based-testing research, §V.2).
2. **Journeys are composable and dual-exit.** "Login as admin" is a sub-journey referenced by every admin journey (the Maestro `runFlow` pattern). Every journey names its actor, its one goal, its entry, and **both** its success end and its failure/abandon ends — the industry-standard journey definition (§V.5).
3. **Every element carries provenance and confidence.** Each surface and transition records *how we know it* (`derivation: static | convention | agent | human`), *where* (`file:line`), and *how sure we are* (`confidence`). This is paqad's "proof, not promises" philosophy applied to the map itself — and it makes sync mechanical: re-extract, diff, flag what moved.
4. **Three truth layers with different update policies.** Deterministic extraction (scripts, no LLM, always regenerable) → agent enrichment (semantics, labels, inferred transitions — evidence-linked) → human curation (journey names, priorities — never clobbered by refresh, exactly like locked module-map entries).
5. **One model, many views.** The YAML is the single source of truth. Mermaid diagrams, the dashboard page, per-module user-flow docs, and test skeletons are all *generated projections* — never hand-maintained, never authoritative (the Structurizr/C4 lesson, §V.3).
6. **A token-budgeted agent index.** Besides the full map, a ~1k-token orientation file (entries, top journeys, counts, pointers) modeled on the llms.txt shape and Aider's ranked-slice discipline — because an agent rarely needs the whole graph, it needs the right slice (§V.1).
7. **Analytics-ready naming.** Surface IDs double as analytics screen names, transition names follow Object-Action convention. The day the team wants real user behavior overlaid on the map (PostHog/GA4-style paths), the join keys already exist — zero renaming. This also connects directly to paqad's existing `analytics-instrumentation` capability.
8. **Gaps are findings, not vibes.** The map enables a defect taxonomy: unreachable surfaces, dead ends, journeys with no covering test, sensitive surfaces without guards, surfaces missing from the map (drift), low-confidence edges awaiting confirmation. Each gets a stable finding code, like the module-map's `MM-*` family.
9. **Curation discipline.** Auto-extract *all* nodes and edges — but curate a *small, named, importance-ranked* set of journeys (the arc42 runtime-view rule: a handful of architecturally important scenarios, not every path). Exhaustive journey lists die; curated ones get read.

### 1.3 What it deliberately is NOT

- **Not sitemap.xml.** That is a flat URL inventory for crawlers — nodes with no edges, no guards, no journeys. Our map is precisely what sitemap.xml is not.
- **Not a hand-drawn diagram.** Diagrams are generated output. Hand-maintained diagrams rot; generated ones survive.
- **Not runtime crawling (in v1).** Static, framework-aware extraction plus agent refinement is the state of the art (2026 academic work does exactly this) and fits paqad's local-first, no-app-boot philosophy. A runtime-confirmation mode is a later, optional add-on.
- **Not a replacement for module docs.** It is the third stage of the same documentation family, cross-linking into the module map rather than duplicating it.

---

## Part II — What we will build (functional solution)

### 2.1 The trigger and the workflow

A new routed workflow, **`site-map`**, joining the existing ten. Trigger phrases: `create site map` (primary), plus `create sitemap`, `update site map`, `generate site map`, `create journey map` — registered in the same routing table as the documentation workflows, in their priority band. The agent bootstrap's numbered workflow list grows by one entry, described as: *"site-map — the 'create site map' stage: map every entry, surface, transition, and journey of the application."*

**Prerequisite posture (soft):** the site map is most valuable after Stage 1 (`create documentation`) has produced the module map, because every surface links to its owning module. If the module map is missing, the workflow still runs but marks surfaces as unattributed and recommends running `create documentation` — a softer posture than Stage 2's hard refusal, because the behavioral map has standalone value.

**What a run does, functionally:**

1. **Detect the application shape.** From the detected stack (packs) decide what "surface" means here: web pages, API operations, CLI commands, mobile screens, jobs — or several at once (a Laravel + React app has both server routes and SPA pages; a monorepo may contain an API and a CLI).
2. **Deterministic inventory (scripts first, no LLM).** Run the per-stack extractor recipes (§2.5) to enumerate raw surfaces: route tables, page-file conventions, command trees, navigation XML. Output is a raw extraction artifact with file/line evidence — cheap, repeatable, and the future drift baseline.
3. **Agent normalization & enrichment.** The agent turns raw entries into named surfaces (semantic slugs, human titles, page types), walks the code to find **transitions** (links, redirects, form submissions, navigation calls, command invocations) and **guards** (middleware, decorators, route meta, `canActivate`, redirect callbacks), marking each with derivation + confidence + evidence. Existing per-feature skills (`user-flow-generation`, `ux-state-machine`) already reason this way per change; this workflow aggregates the same reasoning app-wide.
4. **Journey proposal.** From entry points to terminal states, the agent proposes the important journeys — informed by existing E2E tests, the module map, analytics call-sites, and READMEs. Proposals carry confidence and are explicitly marked `proposed`.
5. **Human checkpoint.** Journey confirmation rides the existing review machinery (Decision Pause packets or the dashboard Approvals area — decision point §7.3): confirm, rename, reprioritize, or reject. Confirmed journeys become curated files that refresh never clobbers. This mirrors Stage 1's `pending_map_review` pattern.
6. **Write the artifact set** (§2.3), register every output in the doc tracker (inheriting differential refresh + crash recovery for free), regenerate the human mirror and Mermaid views, and finish with the standard workflow status output (completed / blocked / gaps found).

**Re-runs are differential.** Like the doc workflow: content-hashing of each output's source files means an unchanged module costs nothing; a changed routes file re-extracts only the affected slice; human-curated fields survive (same semantics as `auto_update_module_name: false` locked entries in the module map).

### 2.2 The universal vocabulary (works for web, API, CLI, mobile, service)

Five entity families. Everything any project type has reduces to these:

| Entity | What it is | Examples across project types |
| --- | --- | --- |
| **Surface** | Any place a user or caller can *be* | web page, mobile screen, modal/dialog, API operation, CLI command, background job, webhook receiver, transactional email, external hand-off (Stripe checkout) |
| **Transition** | A directed move between surfaces, with its trigger | click/submit/link/redirect, navigation push, deep link, api-call, command invocation, event, schedule, timeout |
| **Guard** | A named condition on entry/traversal | authenticated, role:admin, feature flag, subscription tier, valid session, required flag/env for a CLI command |
| **Actor** | Who travels | guest, standard user, admin, API consumer, operator/DevOps, the scheduler |
| **Journey** | A curated, goal-directed path | "guest signs up → onboarding → dashboard (success) / abandons at email verify (failure)"; for a CLI: "init → configure → first successful run" |

Per project type, the mapping is natural:

- **Web app** — surfaces are pages/routes and modals; entries are public URLs and deep links; exits are logout, order-complete, error pages.
- **API service** — surfaces are operations (method + path); "journeys" are multi-call workflows (create token → create resource → poll status) — exactly what the OpenAPI Initiative's **Arazzo** spec models; guards come from the security scheme.
- **CLI tool** — the command tree *is* the site map: commands/subcommands are surfaces, flags are params, interactive prompts are transitions, exit codes are the success/failure ends. (paqad-ai itself would dogfood this: `onboard → doctor → dashboard` is a journey.)
- **Mobile app** — screens and navigation graph; entries include deep links and push-notification targets; guards include permissions.
- **Service/worker** — jobs, queues, webhooks, schedules: the "invisible journeys" that most documentation never captures.
- **Library** — mostly out of scope (its "surfaces" are the public API, already covered by the code-knowledge index); the capability degrades gracefully to entry-points-only.

### 2.3 The artifact set (what lands on disk)

```
docs/instructions/site-map/
├── app-map.yaml            # canonical graph: surfaces + transitions + guards + actors
├── journeys/
│   ├── signup-to-dashboard.journey.yaml
│   ├── admin-audit-export.journey.yaml
│   └── ...                 # one file per journey → clean diffs, no merge conflicts
├── index.md                # the ~1k-token agent orientation (generated, budgeted, ranked)
└── overview.md             # human mirror: embedded Mermaid views + gap report (generated)

docs/modules/<slug>/user-flows/    # per-module journey pages (claims the dormant
                                   # MODULE_USER_FLOWS_DIR slot; generated projections)

.paqad/site-map/extraction.json    # raw deterministic extraction (derived cache + drift baseline)
.paqad/site-map/drift.json         # SM-* findings from the last reconcile
```

**Format decisions (each backed by research, §V.6):**

- **YAML, not JSON/XML.** Cheapest for LLM consumption in multi-file navigation benchmarks (JSON +28%, Markdown +60% tokens for identical content), line-oriented for git diffs, supports comments, parses everywhere the dashboard needs.
- **Shallow (≤3 nesting levels), no anchors/aliases.** LLM extraction accuracy collapses past ~3 levels of nesting.
- **Semantic slug IDs, never UUIDs** (`checkout.payment`, `cli.onboard`). Semantic names measurably improve LLM graph reasoning and double as the analytics screen-name contract.
- **Incident encoding: each surface lists its outgoing transitions inline.** Per-node adjacency beats separate edge tables for LLM reasoning (53.8% vs 19.8% on connectivity tasks in Google's graph-encoding research) and keeps related facts textually adjacent.
- **One journey per file.** Journeys are the most-edited, most-reviewed artifact; per-file keeps diffs readable and merges conflict-free.
- **Mermaid is generated, never authored.** LLMs still make Mermaid syntax errors; deterministic generation from the canonical YAML guarantees valid diagrams (state diagram for the graph, flowchart per journey), and GitHub renders them in PRs for free.

**Illustrative shape** (abbreviated — the real schema is versioned and validated):

```yaml
# app-map.yaml (fragment)
schema_version: 1
app: { name: acme-shop, kind: web, frameworks: [laravel, react] }

actors:
  - { id: guest, name: Guest }
  - { id: admin, name: Administrator, satisfies: [authenticated, role-admin] }

guards:
  - id: role-admin
    kind: role
    requires: "role:admin"
    satisfy_via: journey:login-as-admin        # ← the testability hint
    evidence: { file: app/Http/Middleware/EnsureAdmin.php, line: 18 }

surfaces:
  - id: auth.login
    kind: page
    title: Login
    path: /login
    entry: { kind: public-url }
    page_type: form
    module: authentication                     # ← module-map slug (structure ↔ behavior join)
    oracle: { url: "/login", element: "form#login" }
    evidence: { file: routes/web.php, line: 24 }
    derivation: static
    confidence: high
    transitions:
      - to: dashboard.home
        trigger: submit
        guard: authenticated
        evidence: { file: app/Http/Controllers/LoginController.php, line: 41 }
        confidence: high
      - to: auth.login          # failed attempt stays, with error state
        trigger: submit
        note: invalid credentials
```

```yaml
# journeys/admin-audit-export.journey.yaml (fragment)
schema_version: 1
id: admin-audit-export
name: "Admin exports the audit log"
actor: admin
goal: "Download a CSV of recent audit events"
entry: auth.login
uses: [journey:login-as-admin]                 # composable sub-journey
steps:
  - { surface: dashboard.home,   action: "open Admin menu" }
  - { surface: admin.audit,      action: "set date range", expect: "table shows events" }
  - { surface: admin.audit,      action: "click Export",   expect: "CSV downloads" }
ends: { success: [admin.audit], failure: [errors.forbidden] }
priority: high
status: confirmed                              # proposed | confirmed | locked
tests: [tests/e2e/admin-audit-export.spec.ts]  # ← journey-coverage link
```

### 2.4 The sync model (how it stays true, forever)

This reuses the four existing drift mechanisms rather than inventing a fifth:

1. **Differential refresh via the doc tracker.** Every generated site-map output registers in `.paqad/doc-progress.json` with its source files and content hash — the identical mechanism the module docs use. Unchanged sources ⇒ skip; interrupted runs ⇒ automatic crash recovery. (The tracker's `global` group is schema-open, so this needs no schema surgery.)
2. **Stale-detection on every code change.** The stale-doc detector learns the flow-relevant paths (per-pack: `routes/**`, `app/Http/Controllers/**`, `src/pages/**`, `src/cli/**`, navigation dirs …) so a change there marks the site map stale during feature development, and the documentation-sync engine routes the repair to a new `site-map-maintainer` skill — exactly how `api-doc-maintainer` works today.
3. **Reconciliation with stable finding codes.** A reconcile pass compares a fresh deterministic extraction against the canonical map and emits `SM-*` findings, mirroring the module map's `MM-*` family:
   - `SM-ADD` — surface exists in code, missing from map
   - `SM-REMOVE` — mapped surface no longer in code
   - `SM-EDGE-STALE` — transition's evidence no longer matches
   - `SM-GUARD-DRIFT` — guard changed (e.g., middleware removed) — **security-relevant, escalates**
   - `SM-JOURNEY-BROKEN` — a journey step references a removed surface/transition
   - `SM-ORPHAN` — surface unreachable from any entry
   - `SM-DEADEND` — non-terminal surface with no outgoing transition
4. **A verification gate.** A `SiteMapFreshnessGate` (same family as `DocumentationFreshnessGate`): when a change touches flow-relevant files and the map wasn't refreshed, the change "needs your attention". This is the OpenAPI-contract-test lesson: the build is what keeps a spec honest.

Because the extraction layer is deterministic, "is the map in sync?" is a **script-answerable question with zero tokens** — fully aligned with paqad's rules-as-scripts philosophy.

### 2.5 How extraction covers every stack (the pack contract)

Research validated that **modern frameworks have converged on statically enumerable routing** — half ship a first-party machine-readable dump. The pack system is the natural carrier, and it already half-does this:

- Five packs already ship `scripts/extract-routes.sh` (nextjs, nestjs, dotnet, flask, kotlin-android), and a stack-switched runner-script template exists with `php artisan route:list --json` as its default arm — currently orphaned (never wired into onboarding). The capability adopts and completes this seam.
- Per-ecosystem dump commands validated: Laravel `route:list --json` (middleware = guards), Rails `rails routes`, Django `show_urls --format json`, FastAPI `/openapi.json` (security = guards), React Router/Remix `routes --json`, Next.js file conventions + build manifests, Vue Router meta + navigation guards, Angular `canActivate`, Android navigation XML, iOS storyboards, Flutter GoRouter trees, oclif `manifest`, commander introspection.
- **Pack extension (new optional `site_map` block):** declares the app kind(s) (`web | api | cli | mobile | service`), surface locations (route/screen/command globs — largely already present as pentest `file_check_map` globs), the extractor script, guard conventions (where auth lives in this stack), and navigation hints. Packs without the block fall back to generic conventions plus agent-led discovery at lower confidence. (Note: the pack schema is strict, so the block must be added to the schema — a known, cheap step.)
- **Key insight from the research: nodes are cheap; edges are the product.** Static extraction guarantees the surface inventory; transitions need framework-aware analysis plus agent refinement with per-edge confidence. That hybrid (static graph + LLM semantic refinement) is literally the 2026 state of the art in the academic literature — and paqad already has the LLM in the loop.

### 2.6 The dashboard area — "Site map"

A new left-rail area beside **Graph** (positioning: *Graph = how the code is structured; Site map = how the product behaves*). One page, everything visible:

- **The canvas.** Entries on one side, flows fanning out — a layered/hierarchical (DAG) layout rather than the Graph area's force-directed physics, because flow graphs have direction and roots. Surface icon by kind (page/screen/command/endpoint/job), color by overlay. Existing canvas machinery (WebGL renderer, semantic zoom, search-with-fly-to, dim-others, camera preservation, saved views, SSE live reload) is reused; the layout engine is a drop-in swap at the existing worker seam.
- **Filters** (the user's explicit ask): by actor/role, module, surface kind, guard, journey, confidence, status, coverage state. **Search** with match cycling. Semantic zoom: zoomed out = entries + top journeys; mid = all surfaces; close = transition detail.
- **Journey mode.** Pick a journey → its path lights up; step through it step-by-step with the step's action/expectation shown; success ends green, failure ends red. This is the "see the whole journey without opening the app" moment.
- **Overlays** (reusing the Graph area's overlay + legend pattern):
  - *Test coverage* — journeys with/without passing linked tests; untraversed transitions.
  - *Security* — pentest findings joined by surface/module (the pentest `impact_area` join).
  - *Health* — color by owning module's health tier (free join via `module` slug).
  - *Freshness/confidence* — low-confidence or drifted elements glow amber.
  - *(later) Usage* — real analytics counts per transition, PostHog-style.
- **Gap panel.** The `SM-*` findings as an actionable list: unreachable surfaces, dead ends, guard-less sensitive surfaces, untested journeys, unmapped code. Each deep-links to the canvas and to the evidence.
- **Diff view.** "What changed since the last refresh": surfaces/transitions added/removed — the VisualSitemaps recrawl-diff idea, done statically on every refresh.
- **Detail panel.** Plain-language first (existing dashboard voice), evidence links (`file:line`), guards and journeys through this surface, "For engineers" expansion. Journey curation actions (confirm/rename/reprioritize) ride the existing audited write pipeline and approvals surface — the map itself stays read-only in the UI.

### 2.7 Downstream consumers (built-in, from day one)

The research graveyard (Sourcetrail, CodeSee, Octomind) teaches one hard lesson: **maps that only serve human eyeballs die; maps embedded in a workflow with machine consumers survive.** The flywheel ships with at least three consumers immediately:

1. **Agent context** (§III) — the primary consumer, by construction.
2. **Regression-test skeletons.** Every confirmed journey compiles to a test skeleton in the project's harness (Playwright for web, Maestro-shaped YAML for mobile, runner scripts for CLIs — the pack decides). Steps already carry action + expectation; guards carry `satisfy_via` for setup. Model-based-testing traversal (path per reachable surface, edge-coverage targets) is a later, natural extension because the metadata is in the schema from day one. The `_shared/skills/regression-test-gen` skill is the existing composition point.
3. **Journey coverage & gap reporting.** "Every journey either links to a passing test or gets flagged" — a CI-visible report and a dashboard overlay. This gives the team a *user-flow coverage* metric, complementing line coverage.
4. **Security back-feed.** The pentest workflow's surface enumeration is Laravel-only today; the site map replaces it with a typed, cross-stack inventory, and the STRIDE skill's documented "route inventory" fallback becomes structured input. Guard drift (`SM-GUARD-DRIFT`) becomes a security signal.
5. **Analytics alignment** (with the existing `analytics-instrumentation` capability): map slugs = screen names; transition names = Object-Action events. Free join key for a future behavior overlay.

---

## Part III — How it serves the LLM, the human, and the token budget

### 3.1 For the LLM: fewer tokens, better answers

**The problem today.** Flow questions are the most expensive class of question an agent faces. "Where do I add the admin report page, what guards it, and what breaks if I change this controller?" forces the agent to read routers, controllers, navigation components, and middleware across the repo — typically 15,000–40,000 tokens over several turns, with real hallucination risk (invented routes, guessed guards). Every frontier model **degrades** as context grows, so the cost is paid twice: in tokens and in answer quality.

**With the map:**

- The ~1k-token `index.md` answers orientation questions outright (what kind of app, where it starts, what the top journeys are).
- A targeted slice of `app-map.yaml` (a few hundred tokens, incident-encoded) answers reachability, guard, and impact questions — with `file:line` evidence the agent can spot-check instead of re-deriving.
- Realistic arithmetic for a mid-size app (~60 surfaces): full map ≈ 3–6k tokens; the relevant slice for one question ≈ 200–800. Against 15–40k of raw file reading, that is a **>90% token reduction on flow questions** — and the answer is grounded in a verified artifact rather than a fresh guess. (We do not claim the number until measured; see the benchmark commitment below.)
- **Plan quality improves where it matters most.** Feature placement ("this belongs on the settings journey, behind the existing `role-admin` guard"), impact analysis ("this module serves 3 journeys; these are the tests to run"), and doc-sync targeting all become lookups instead of explorations. The planning stage already reads module docs; the map becomes its behavioral counterpart.
- **It compounds with the existing context system.** The map is exactly the kind of high-value, low-token artifact paqad's context intelligence is built to serve: it can join the session-context artifact for flow-touching changes, RAG indexes it as first-class (docs + module map are already retrieval's top scope), and its slugs give retrieval better anchors.
- **It reduces hallucination structurally.** A route the map doesn't contain is a route the agent should not invent. The drift gate keeps the map honest, so "trust the map, verify by evidence pointer" becomes a safe default — the same trust model as the rule manifest.

**Benchmark commitment (paqad culture: measured, not marketed).** Extend the existing footprint methodology (`docs/instructions/benchmarks/measured.md`) with a flow-question eval: a fixed set of reachability/guard/impact questions answered with and without the map, tracking tokens sent, correction turns, and task success — the same on/off discipline the RAG evals already use. The README claim gets written only after this exists.

### 3.2 For the human: the product on one page

- **Onboarding.** A new teammate (or stakeholder) opens the dashboard and sees the whole product: where users enter, where they can go, what's admin-only, which flows matter. No app account, no clicking around, no tribal knowledge.
- **Product/QA alignment.** Journeys are the shared language between product ("signup conversion"), QA ("signup regression suite"), and engineering ("these 4 modules"). The same artifact serves all three — that's what made OpenAPI stick.
- **Living documentation.** The map refreshes with the docs; the diff view shows what the last sprint changed about the product's shape. Documentation that is *provably* current, in the product's own words.
- **Gap visibility.** Dead ends, unreachable screens, unguarded admin surfaces, untested journeys — visible, filterable, and assignable, instead of discovered in production.

### 3.3 For coding efficiency

- **Correct-by-navigation edits.** Agents stop guessing file placement for flow-touching changes: the map names the surface, its module, its evidence file.
- **Targeted regression.** "Which journeys cross this module?" selects the E2E tests worth running for a diff — cheaper CI, faster feedback.
- **Review context.** A PR description can state (and the dashboard can show) which journeys a change touches — reviewers reason about user impact, not just diffs.
- **Dead-surface cleanup.** `SM-ORPHAN` findings feed the codebase-health workflow: unreachable UI is dead code with a UI.

---

## Part IV — Fit with the current codebase (what exists, where it plugs)

The deep audit found the capability is not fighting the architecture — the architecture has been *waiting for it*. Five dormant hooks exist today, all unclaimed:

| Existing hook | State today | Role in this design |
| --- | --- | --- |
| `evidence.routes` field on module-map entries | In the schema, parsed, validated — **never populated by anything** | Per-module route lists, filled by extraction (joins map ↔ modules) |
| `MODULE_USER_FLOWS_DIR = 'user-flows'` path constant | Declared, **zero references** | Home of per-module journey pages |
| `user-flow` pipeline phase, doc type, template (`Actors/Preconditions/Main Flow`), and validator | All declared; no executor | The journey docs' validation vocabulary |
| `screen-registry.md` (+ `api-registry.md`) | Scaffolded empty at onboard, filled only ad hoc | Regenerated as projections of the map |
| `extract-routes.sh` runner-script template + five per-pack extractor scripts | Template orphaned (generator never wired into onboarding) | The deterministic extraction layer, completed per pack |

Further ready-made substrate (all confirmed in the audit):

- **Persistence pattern:** the code-knowledge index (`.paqad/indexes/code-knowledge.json`) is the model — schema-versioned, AJV-validated, atomic writes, tolerant reads, incremental refresh, and an **entry-point resolver that already ships** (static globs + `package.json` main/bin/exports). The site map is its behavioral sibling.
- **Doc machinery:** registering outputs in the doc tracker buys differential refresh and crash recovery with no new mechanism; the sync-engine routing table and stale-doc detector extend by configuration, not redesign.
- **Dashboard:** area registration is a known 10-touchpoint checklist; the graph canvas, search, overlays, legend, saved views, SSE live updates, and the audited write pipeline are all reusable. The one deliberate change: a layered DAG layout instead of force-directed, at the existing layout-worker seam.
- **Routing/workflow registration:** the full "Shape A" checklist is enumerated (routing tables, classification unions, bootstrap list, gates, dashboard, self-maintenance docs, tests). Two guardrails to respect: the instructions-area allowlist must learn `site-map/` before anything writes there, and per-feature dirs under `docs/modules/**/features/` carry an `api.md` obligation — which `user-flows/` output deliberately avoids.
- **Retrieval decision precedent:** the MCP decision matrix already models `routes` as a data need answerable by MCP server, script, or LLM-read with estimated token savings — the exact three-tier retrieval philosophy the site map generalizes. Some router MCP servers even declare `route-tree` / `navigation-guards` as capabilities they provide.
- **Capability gating:** one new feature flag in the framework-config registry (`site_map`, default off initially, env-overridable, group `app`) — the same single-entry pattern `analytics_instrumentation` used. Site-map generation requires the `coding` capability (it reads code); content-only projects simply never route to it.

---

## Part V — Research foundations (best practices, with sources)

Condensed; each informed a specific design decision above.

1. **Statecharts / SCXML / XState** — transitions as `{event, guard, target}` objects, initial/final markers, hierarchy for nested routes/layout shells, and the config/implementation split (the map names guards; binding lives elsewhere) that keeps the model serializable. Guard cascades ("admin → admin dashboard, else → home") come straight from XState's ordered guarded targets. *W3C SCXML Recommendation; stately.ai docs.*
2. **Model-based testing** — GraphWalker (vertices = states with assertions, edges = actions; guards; weights; requirement tags; generators + stop conditions like `edge_coverage(100)`) and `@xstate/test` (shortest-paths → one test per reachable state) define what metadata a map needs to *generate* regression tests: per-edge action recipe, per-node oracle, satisfiable guards, weights, tags. Schemathesis proves the "machine-readable surface → automatic regression" thesis for APIs. *graphwalker.github.io; stately.ai/docs/xstate-test; github.com/schemathesis.*
3. **Architecture standards** — C4 dynamic diagrams (numbered steps over a shared element set) and Structurizr's one-model-many-views; arc42 §6's curation rule (document a handful of important scenarios, not every path); BPMN's explicit decision points and actor lanes. *c4model.com; docs.arc42.org; camunda.com/bpmn.*
4. **Diagram-as-code** — Mermaid is the LLM/tooling lingua franca (native GitHub/GitLab rendering), but benchmarks (MermaidSeqBench) show LLMs still emit syntax errors → diagrams must be deterministically generated from the canonical map. *mermaid.js docs; arXiv 2511.14967.*
5. **UX practice** — structure map vs journeys as separate-but-linked artifacts; entry/exit/decision-point vocabulary; dual exits (completed vs abandoned); one goal per flow; VisualSitemaps' scheduled recrawl + visual diff as commercial proof of "map that stays in sync"; Maestro's composable YAML flows as the executable-journey model. *flowmapp.com; visualsitemaps.com; maestro.dev; justinmind.com/blog/user-flow.*
6. **LLM-oriented representations & token economics** — llms.txt's shape is right and its failure mode (no guaranteed consumer) doesn't apply in-repo; Aider's repo map (ranked, token-budgeted slices; 1k default) sets the index discipline. Format benchmarks: YAML cheapest for agentic multi-file work (JSON +28%, Markdown +60%); nesting >3 levels collapses extraction accuracy; incident (per-node adjacency) encoding beats edge lists by wide margins; semantic names beat opaque IDs; JSON-LD worst by ~4x. Ecosystem lessons: OpenAPI/Arazzo (workflows-over-APIs spec — our journey shape for API kinds), sitemap.xml (nodes without edges = the anti-pattern), and the tool graveyard (Sourcetrail/CodeSee/Octomind: human-only visualization dies; workflow-embedded, machine-consumed maps live). *llmstxt.org; aider.chat/docs/repomap.html; arXiv 2602.05447, 2509.25922, 2310.04560 ("Talk like a Graph"), 2504.07087; spec.openapis.org/arazzo; appmap.io.*
7. **Academic state of the art for extraction** — static page-transition-graph extraction + LLM semantic refinement (selectors, conditional navigation) is precisely the current SOTA architecture for this problem (2025–26 papers on Vue.js PTG extraction and screen-transition-graph-driven E2E generation); Android's GATOR/ProMal literature confirms the static/dynamic precision boundary and endorses hybrid approaches. *arXiv 2606.27665, 2506.02529.*

---

## Part VI — Rollout (phased, value-first)

**Phase 0 — MVP as a skill (days, ~6 files, zero engine change).**
A `site-map-generation` skill triggered from the existing documentation workflows: extractor script adapted from the existing route-extraction template, agent-authored `app-map.yaml` + first journeys with evidence, per-module `user-flows/` pages, human overview with generated Mermaid. Outputs registered in the doc tracker. Proves the schema and the value on real projects (including dogfooding on paqad-ai itself — a CLI, which keeps the design honest about non-web apps from day one).

**Phase 1 — First-class workflow + dashboard (the headline release).**
`create site map` as routed workflow #11; `docs/instructions/site-map/` area registered; the Site map dashboard page (canvas, filters, search, journey mode, detail panel, gap panel) with SSE live updates; `refresh --site-map`; journey confirmation via the approvals/decision surface.

**Phase 2 — Sync hardening + pack depth.**
`SM-*` reconciliation + drift file; `SiteMapFreshnessGate`; stale-doc mappings per pack; `site_map` pack blocks for the top packs (Laravel, Next.js, React Router, FastAPI, Flutter, node-cli); extraction fingerprints; the diff view; pentest back-feed.

**Phase 3 — The consumers that compound.**
Journey → regression-test skeleton generation + "untested journeys" CI report; journey coverage in the verification receipt; analytics overlay (join on slugs); RAG/MCP query surface for the map; the measured token-savings benchmark published in `benchmarks/measured.md`.

Each phase ships standalone value; nothing blocks on the last mile.

---

## Part VII — Risks, open questions, and decisions for the owner

### Risks (with mitigations)

| Risk | Mitigation |
| --- | --- |
| Imperative/dynamic navigation (SwiftUI, raw `Navigator.push`, dynamic Express mounting) resists static extraction | Confidence field + agent refinement is the design center, not an afterthought; low-confidence edges are visible work items, not silent lies; optional runtime confirmation is a Phase 3+ add-on |
| Map bloat on very large apps | Semantic zoom + filters on the dashboard; budgeted index for agents; per-area rollups (GraphRAG community-summary pattern) if needed |
| Curation fatigue (too many journeys) | arc42 discipline enforced by design: journeys are proposed by the agent but capped and ranked; the map (exhaustive) and journeys (curated) are separate artifacts |
| Trust decay if the map drifts | The freshness gate + script-answerable reconcile makes drift loud; "in sync" is enforced, not hoped |
| Schema evolution | `schema_version` from day one + the existing schema-migration machinery |
| Confusion with the existing Graph area | Explicit positioning in the UI copy: Graph = code structure, Site map = product behavior; cross-links between the two (surface → owning module → files) |

### Decisions to make before the implementation spec (recommendations included)

1. **Name.** Recommended: area + trigger say **"Site map"** (the user's language, instantly understood); artifacts say `app-map.yaml` + `journeys/` (accurate for CLIs/APIs where "site" is a stretch). Alternatives: "App map" everywhere, or "Journeys" as the headline.
2. **Canonical home.** Recommended: `docs/instructions/site-map/` (version-controlled, reviewable, agent-loadable, dashboard-editable later), with `.paqad/site-map/` for derived caches only. Alternative: everything under `.paqad/` (hidden from PR review — not recommended; the map deserves review).
3. **Journey confirmation surface.** Recommended: dashboard Approvals (it exists, it's audited, it's pleasant) with Decision Pause packets as the headless fallback. Alternative: plain file edits only.
4. **MVP shape.** Recommended: Phase 0 skill first (validates schema on real repos in days), promote to routed workflow in the same release train as the dashboard area. Alternative: go straight to Shape A.
5. **Default state.** Recommended: feature flag `site_map` ships default-ON for projects with the `coding` capability once Phase 1 lands (docs are paqad's product promise), default-OFF during Phase 0.
6. **Trigger wording for journeys refresh.** One workflow (`create site map` does map + journey proposals) vs a separate `create journeys` stage. Recommended: one workflow with the review checkpoint inside — fewer phrases to learn, mirrors how Stage 1 already pauses at `pending_map_review`.

---

## Appendix A — The user promise, restated

When this ships, the README's documentation section gains one sentence and means it:

> **"Ask any connected agent to `create site map` and paqad maps your whole application — every entry, every screen, every path, every journey — as living documents your agents read for pennies and your team sees on one page. When the code changes, the map follows. Good for the LLM. Good for the human."**
