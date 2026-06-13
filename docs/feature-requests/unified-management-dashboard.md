# Unified Management Dashboard: the one stop shop

> The dashboard becomes the single place where users see, understand, and **edit** everything they own in Paqad. No more bouncing between the web page, the CLI, and hand-edited YAML. If it is a setting or content, you change it on the web page. If it is prompt work, the web page shows it and routes you to the conversation. If it is evidence, you can see it and share it, and nobody can edit it.
>
> This spec is implement-ready. It contains the full inventory, the classification of every functionality, the page-by-page design, the editing API, the component list, the design rules with concrete values, and the actual copy. No further research is required.

---

## 0. North star and experience psychology

We are not building an admin panel. We are building the thing a user opens, exhales, and thinks "I know exactly where my project stands, and everything I need is one click away." The experience has to be good enough that people show it to colleagues unprompted. That is the bar, and it is a psychology problem before it is a UI problem:

1. **Make their life visibly easier, every session.** Every screen must remove a chore the user used to do by hand (editing YAML, reading raw JSONL, memorizing CLI flags). Ease is the value. The more we remove, the more they love it.
2. **Show the win after every action.** When the user saves, approves, or fixes something, tell them in plain words what just got better: "Your rules are saved. Every agent picks this up automatically on its next session." People share tools that make them feel competent.
3. **Make proof beautiful and shareable.** The trust artifacts (receipts, evidence, AI-BOM) are our crown jewels. Render them so well that pasting them into a PR or showing them to a lead feels like showing off. Shareable artifacts are the word-of-mouth engine.
4. **Calm, never spectacle.** Admiration comes from a product that feels quiet, fast, and inevitable. One accent color, soft structure, motion only when it explains what happened.
5. **Never make the user feel stupid.** Every error states the consequence and the next step in plain language. No codes without explanation. No jargon without a why.
6. **Reasoning is the interface.** Every feature leads with the problem it solves for the user, then the benefit, then the mechanism. In that order, everywhere, always.

---

## 1. The problem we are solving

Paqad does a lot: verification gates, decision pauses, evidence ledgers, attestation, AI bill of materials, module lifecycle, compliance checking, workflows, delivery policy, RAG context, defect patterns, quality ratchets. That power lives behind 20 CLI command groups, a dozen YAML files, and append-only logs under `.paqad/`. The result:

- **Users cannot see what they have.** The trust features are invisible unless you know to run `paqad-ai evidence`.
- **Users cannot tell what they control.** Some things Paqad decides, some things humans decide. Nothing says which is which.
- **Users manage by guessing.** Configuration means hand-editing `project-profile.yaml` or `delivery-policy.yaml`, or memorizing CLI flags.
- **Users never learn the why.** The product exposes mechanisms without stating the problem each one solves.

This is the documented failure mode of AI dev tools: Thoughtworks calls it cognitive debt, TechRadar calls it signal overload without context, and feature-discovery research shows features buried three clicks deep see roughly 82% lower adoption. Tools fail by presenting technology first and value never. (Sources at the end.)

**The fix:** one web page that is the complete management surface for everything the user owns, with the reasoning built into every screen.

---

## 2. The management rule

Every functionality in Paqad is classified exactly once, with no exceptions:

| Class | Rule | On the web page |
|---|---|---|
| **Web-managed** | Settings, policies, and content the user owns | Fully editable. Forms, editors, toggles. The web page is the primary surface; the CLI remains as the power path. |
| **Prompt-managed** | Work that flows through the AI conversation: code changes, workflow execution, spec authoring, plan runs | Visible as live status. Never edited on the web. The page shows state and tells the user where the work happens. |
| **Evidence** | Records Paqad generates to prove what happened: receipts, ledgers, audit trails, drift reports | View, search, and export only. Deliberately not editable, because editable evidence is worthless. |

One nuance: **decisions** (pauses and module proposals) are stored state with a resolution step. They are answerable on the web page or in the conversation; both write to the same decision store, and the agent picks up web resolutions on its next tool call. They live in the Approvals inbox.

---

## 3. Complete inventory and classification

Every functionality, who manages it, and its class. This table is the contract for the build: every "Web-managed" row must end up fully editable in the dashboard.

### A. Web-managed (fully editable on the web page)

| Functionality | What it does for the user | Managed by | Source of truth | Web page gives you |
|---|---|---|---|---|
| Canonical instructions | One source of truth every agent reads first | Human | `docs/instructions/**` (rules, stack, design-system, tech-debt, architecture) | Full file browser + markdown editor with live preview |
| Workflow definitions | Each prompt like `create documentation` routes to a guided process | Human | `docs/instructions/workflows/*.yaml` | One beautiful page per workflow: visual step timeline, editable settings, run history |
| Delivery policy | Decide what ships automatically and what waits for you | Human | `docs/instructions/workflows/delivery-policy.yaml` | Visual rule builder (branch pattern, host, auto or manual) |
| Module map | The authoritative list of what exists in the codebase | Shared | `docs/instructions/rules/module-map.yml` | Structured editor with drift hints inline |
| Decision pause contract | Defines when the AI must stop and ask you | Human | `.paqad/decision-pause-contract.md` | Editor with category toggles and plain-language preview |
| Project profile | The central configuration | Human | `.paqad/project-profile.yaml` | Schema-driven form, raw YAML toggle |
| Capabilities | Switch feature areas on and off | Human | `project-profile.yaml` active_capabilities | Toggle list with per-capability why-text |
| Stack packs | Stack-specific rules and patterns | Human | `~/.paqad-ai/packs/`, `.paqad/packs/` | Install, remove, scope switch, validate |
| Provider adapters | Same governance for all 10 supported AI tools | Human | Provider entry files | Enable per provider, regenerate entry files |
| RAG configuration | The AI finds code by meaning, not filename | Shared | `.paqad/vectors/`, profile | Provider and model picker, rebuild, clear, status |
| Design tokens | The AI builds UI that matches your brand | Shared | `src/design-tokens/`, `docs/instructions/design-system/` | Visual token editor: color swatches, type scale, live preview |
| Defect pattern library | Learns from past defects across your projects | Shared | `~/.paqad-ai/patterns/` | Browse, prune, export |
| Decisions and approvals | Nothing risky proceeds without you | Shared | `.paqad/decisions/` | Approvals inbox: accept, reject, resolve, bulk actions |

### B. Prompt-managed (web shows live status, work happens in the conversation)

| Functionality | What it does for the user | Web page shows |
|---|---|---|
| Workflow execution (development, release, create documentation, pentest, design test, design retest) | The actual work | Live run status per workflow page, last run, outcome, link to artifacts |
| Plan execution and resume | Long work survives interruptions | Current slice, progress, resume command shown copy-ready |
| Spec authoring (`.paqad/specs/`) | Specs drive obligations and plans | Read view with extraction status |
| Module decision extraction | New modules proposed from prompts | Proposals land in the Approvals inbox |
| Session handoff and context budget | Work continues across sessions | Session card: active session, budget used, last handoff |

### C. Evidence (view, search, export; never editable, by design)

| Functionality | What it proves | Web page gives you |
|---|---|---|
| Evidence ledger (`evidence.jsonl`) | Every verification that ran, append-only | Human-readable timeline, filter by gate and verdict, export |
| DSSE receipts | Who wrote a change, who vouched, tamper-evident | Receipt cards: author, voucher, checks, hash chain; copy as PR comment |
| AI bill of materials (CycloneDX) | Exactly which models and inputs touched the code | Readable inventory view, download JSON |
| Audit log | Every framework update and every web edit | Filterable list |
| Module events (`events.jsonl`) | Who changed which module, when | Timeline per module |
| Module map drift report | Where docs and reality diverge | Findings list with one-click "open in module map editor" |
| Module health | Test status and coverage per module | Health grid, trends |
| Stack snapshot and drift | Your real stack, and when it shifts | Detected vs declared diff view |
| Compliance reports | Spec obligations covered by tests | Coverage per obligation, gaps highlighted, skeleton trigger |
| Quality baseline (ratchet) | Quality only improves, never silently regresses | Trend sparkline per measure |
| Pentest findings and retests | Security posture over time | Findings by severity, retest status |
| Rule compliance results | Project rules enforced on changes | Pass and fail list with rule text inline |

### D. Safe operations (web-triggered buttons, same code paths as the CLI)

Reconcile module map, refresh stack, refresh rules, refresh context, rebuild RAG index, regenerate module docs, regenerate registries, run compliance check, run doctor, run framework update. Each is idempotent, runs as a job with live progress over SSE, and reports its result in plain language.

---

## 4. Information architecture

Seven areas. Navigation is a quiet left sidebar, dimmer than content, collapsible to icons.

```
Pulse        Is my project healthy right now?
Approvals    What needs my decision?              [badge: count]
Trust        Can I prove this work?
Build        Modules, quality, security
Automation   Workflows and delivery rules
Knowledge    Instructions, design system, context
Setup        Profile, capabilities, packs, providers
```

Global elements on every page:

- **Ownership badge** on every card and page header: `You manage this`, `Paqad manages this`, or `Shared`. One shared component, identical everywhere.
- **Why-sentence** as the first line under every page title (copy provided in section 9).
- **"Why this matters" drawer**: right-side panel, one click, containing the problem, what would go wrong without this, and a link to docs. Hard cap of two disclosure levels anywhere in the app.
- **Command palette** (Cmd+K): jump to any page, any module, any decision, any action. Teach it in onboarding first, the way Linear does.
- **Save model:** every editor validates live, saves explicitly (Cmd+S or button), shows the win line after save, and is instantly reflected everywhere through the existing SSE stream.

---

## 5. Page-by-page specification

### 5.1 Pulse (home)

Purpose line: "Everything important about your project, in one glance."

- **Health band:** overall score 0 to 100 as a single large number with a 30-day trend sparkline. One sentence under it generated from the top factor: "Healthy. One module doc is going stale."
- **Stat cards** (Stripe style: one number, one trend, one click-through): Gates passed this week, Pending approvals, Modules healthy / total, Last receipt sealed.
- **Attention list:** at most five items, each phrased as benefit plus action: "2 module proposals waiting. Approving keeps your architecture map truthful." Each item deep-links to the exact page.
- **Activity feed:** last 10 events across ledgers in human language: "14:02 Verification passed on fix/login. Receipt sealed."
- Empty state (new project): "This is where your project's pulse will live. Run your first workflow and watch the first gate pass." plus one button: "Start onboarding."

### 5.2 Approvals (the inbox)

Purpose line: "Nothing risky moves forward without you. This is where you stay in control without reading logs."

- One list, newest first, mixing decision pauses, module proposals (MD-XXXX), and expiring decisions. Filter chips: All, Pauses, Modules, Expiring.
- **Each item is a card:** the question in plain language, two lines of context, the options as buttons, and one consequence line per option ("Accept: module-map gains `payments-adapter`, docs are scaffolded automatically.").
- Bulk select for module proposals.
- Resolving writes to `.paqad/decisions/` through the same store the agent uses; the conversation picks it up on its next tool call. A resolved card collapses with a short win line: "Done. The agent continues with your choice."
- Sidebar badge shows live count; goes quiet (no badge) at zero. Zero state: "Nothing needs you. Paqad pauses here the moment something does."

### 5.3 Trust

Purpose line: "Proof you can show anyone: what was checked, who wrote it, who vouched."

- **Evidence timeline:** virtualized list of ledger entries rendered as sentences, not JSON: "Gate `tests` passed, 412 tests, 96% coverage, on commit 4dbc2b2." Filter by gate, verdict, date.
- **Receipts:** card per DSSE receipt: author agent, vouching agent, checks covered, hash chain status (a quiet "sealed" check). Actions: "Copy as PR comment" (uses the existing `evidence` renderer) and "Export packet" (a polished standalone HTML/Markdown bundle, beautiful enough to attach to a release or show a stakeholder).
- **AI-BOM:** readable inventory ("3 models touched this release") with the CycloneDX JSON one click away.
- **Audit log:** filterable, includes every web edit with actor `dashboard`.
- Zero state: "Your first receipt appears after your first verified change. It proves who wrote what, and that the checks really ran."

### 5.4 Build

Purpose line: "Your codebase, mapped, measured, and honest."

- **Module map (editor):** table of modules from `module-map.yml` with structured editing (name, path, docs ref, owner). Drift findings from the latest reconcile render inline on the affected row with one-click fixes ("Add missing doc stub", "Remove orphan entry"). Save writes the YAML; a Reconcile button re-checks. Raw YAML toggle for power users.
- **Module health:** grid of modules colored by health band, trend per module, click for evidence detail.
- **Module docs:** freshness per module, "Regenerate" per row or bulk.
- **Compliance:** per spec: obligations, coverage ratio against the gate threshold, uncovered items highlighted, "Generate test skeletons" button.
- **Quality baseline:** each ratcheted measure as a sparkline with its plain meaning ("Dead code: 2.1%, best ever. The ratchet stops it from creeping back up.").
- **Security:** pentest findings by severity, retest status, defect pattern browser with prune and export.
- **Architecture graph:** the existing graph view, reached from here, unchanged.

### 5.5 Automation

Purpose line: "Decide once how work flows. Paqad follows your rules every time."

- **Workflows index:** one card per workflow (development, release, create documentation, pentest, design test, design retest, and any pack-added ones), each with its why-sentence, last run, and outcome.
- **Per-workflow page** (this is a showcase page, make it gorgeous): a vertical step timeline rendered from the workflow YAML, each step a quiet card (name, what it does, gates it must pass). Two modes: **Read** (the default, visual) and **Edit** (schema-driven form over the YAML: toggles for optional stages, thresholds, output paths; raw YAML toggle). Run history at the bottom with outcomes. Execution itself stays in the conversation; the page says exactly how to start it: "Type `create documentation` to your agent. Paqad routes it through these steps."
- **Delivery policy (visual rule builder):** rows of "branch pattern → host → auto-ship or wait for human", drag to reorder precedence, plain-language preview line under each rule ("Anything on `main` waits for your approval before release."). Saves to `delivery-policy.yaml` with schema validation.
- **Plans and sessions:** current plan slice and progress, active session, context budget bar, last handoff time. Copy-ready resume command.

### 5.6 Knowledge

Purpose line: "Everything your agents know about this project. Edit it here, every agent learns it instantly."

- **Instructions editor:** a two-pane editor over `docs/instructions/**`: file tree on the left (rules, stack, design-system, tech-debt, architecture, workflows), CodeMirror markdown editor with live preview on the right. Frontmatter rendered as fields. Save validates (markdown lint plus any schema for YAML files) and shows the win line: "Saved. Agents reload this automatically on their next session." (This is literally true: the existing sentinel invalidation re-triggers framework loading when `docs/instructions/**` changes. Say so in the UI; it is a trust moment.)
- **Design system:** token editor with color swatches, type scale preview, spacing scale, and a live preview panel showing a sample card rendered with the current tokens. Writes to the token source and regenerates derived files.
- **Registries:** generated feature, API, and component registries as readable tables, with "Regenerate" actions. View-only content, since the generator owns it.
- **Context (RAG):** status card (provider, model, index size, last build), provider and model picker, rebuild and clear with consequence confirmations ("Clearing deletes the semantic index. The AI falls back to filename search until you rebuild.").

### 5.7 Setup

Purpose line: "Your project's foundation. Set it once, change it any time."

- **Profile:** schema-driven form over `project-profile.yaml` (name, description, stack declaration, model routing), raw YAML toggle.
- **Capabilities:** toggle list; every capability has one line of why ("Security: adds pentest workflows and security rules to every change.").
- **Packs:** installed list with source and scope, install field (registry name, git URL, or path), validate, remove.
- **Providers:** the 10 supported agent tools as cards; enabled ones show their entry-file status; enabling regenerates entry files.
- **Framework:** version, last update from the audit log, Doctor button (runs diagnosis, results as fix-it cards with one-click safe operations where possible), Update button.

---

## 6. Editing infrastructure

### 6.1 API (extends the existing dashboard server)

Existing: `GET /api/dashboard`, `GET /api/events` (SSE), graph endpoints. New, all JSON:

```
GET    /api/inventory                       classification + state of every functionality (drives section cards and badges)

GET    /api/files/instructions              tree of docs/instructions/**
GET    /api/files/instructions/{path}       file content + parsed frontmatter
PUT    /api/files/instructions/{path}       save (validated)

GET    /api/config/profile                  parsed profile + JSON schema
PUT    /api/config/profile
GET    /api/config/delivery-policy          parsed rules + schema
PUT    /api/config/delivery-policy
GET    /api/config/module-map               parsed modules + latest drift findings
PUT    /api/config/module-map
GET    /api/config/rag
PUT    /api/config/rag
GET    /api/config/decision-contract
PUT    /api/config/decision-contract
PUT    /api/config/design-tokens

GET    /api/decisions?state=pending         inbox feed (pauses + module decisions, unified)
POST   /api/decisions/{id}/resolve          { choice, rationale }
POST   /api/module-decisions/{id}/accept
POST   /api/module-decisions/{id}/reject

POST   /api/capabilities/{name}             { enabled: boolean }
POST   /api/packs/install                   { source, scope }
POST   /api/packs/remove                    { name, scope }

POST   /api/ops/{action}                    action ∈ reconcile | refresh-stack | refresh-rules |
                                            refresh-context | rag-rebuild | regenerate-docs |
                                            regenerate-registries | compliance-check | doctor | update
GET    /api/ops/{jobId}                     job status; progress also streamed over SSE as ops-progress events

GET    /api/ledger/evidence?cursor=&gate=&verdict=
GET    /api/ledger/receipts
GET    /api/ledger/ai-bom
GET    /api/audit?cursor=
GET    /api/export/evidence-packet          polished standalone bundle (HTML + Markdown + JSON)
```

### 6.2 Write pipeline (every PUT and POST follows this, no exceptions)

1. **Validate**: ajv against the JSON schema for structured files; YAML parse plus schema for YAML; markdown lint for instructions. Errors return field-level messages the UI renders inline.
2. **Write through the existing core functions** that the CLI already uses. The server never reimplements file logic.
3. **Audit**: append `{ ts, actor: "dashboard", action, path, contentHash }` to `.paqad/audit.log`.
4. **Notify**: the existing file watcher fires `dashboard-updated` over SSE; every open client refreshes the affected cards (they already pulse on update).
5. **Agent sync**: edits under `docs/instructions/**` or to `CLAUDE.md`-adjacent files invalidate the agent entry sentinel (already built), so every agent reloads the canonical context next session. The UI states this as the win line.

### 6.3 Guardrails

- Server binds to localhost by default; writes refuse non-local origins; CSRF token on all mutations; `--read-only` flag disables every mutation endpoint for shared or CI usage.
- Path allowlist for file endpoints: only `docs/instructions/**` and the named config files. No traversal, no dotfiles, symlinks resolved and rejected outside the allowlist.
- Evidence endpoints have no mutation routes at all. There is nothing to misuse.
- Destructive operations (RAG clear, pack remove, module delete) confirm with a consequence sentence, never a bare "Are you sure?".
- Concurrent edit safety: PUTs carry the content hash they loaded; a mismatch returns 409 with a friendly merge prompt ("This file changed since you opened it, likely by an agent. Review the diff.") and a side-by-side diff.

---

## 7. Component library (build once, use everywhere)

| Component | Spec |
|---|---|
| `OwnershipBadge` | Three variants: You manage this / Paqad manages this / Shared. Text plus a small dot, no icon zoo. Identical placement: top right of cards, beside page titles. |
| `WhySentence` | First line under every page and card title. Regular weight, secondary color, max one line. |
| `WhyDrawer` | Right-side panel, 360px, three blocks: The problem, What you get, What happens without it. Footer link to docs. Opens with a 200ms ease-out slide. |
| `StatCard` | One number (28px), one trend arrow with delta, one label, whole card clickable. Nothing else. |
| `InboxItem` | Question (15px medium), two context lines (13px secondary), option buttons with one consequence line each, collapses on resolve with the win line. |
| `MarkdownEditor` | CodeMirror 6, side-by-side live preview, frontmatter as fields, Cmd+S, dirty indicator, validation footer. |
| `SchemaForm` | Renders any JSON schema as a form (text, select, toggle, list), inline errors, "Raw YAML" toggle preserving comments where the parser allows. |
| `RuleBuilder` | Delivery policy rows: pattern input, host select, auto/manual toggle, drag handle, plain-language preview line per rule. |
| `TokenEditor` | Color swatch grid with picker, type scale list with rendered samples, live preview pane (sample card + button + text rendered from current values). |
| `WorkflowTimeline` | Vertical step cards from workflow YAML: step name, one-line purpose, gate chips. Read mode default, Edit mode swaps cards to `SchemaForm` sections. |
| `EvidenceRow` | One ledger entry as a sentence with verdict dot, timestamp, expandable raw JSON (second and final disclosure level). |
| `ReceiptCard` | Author, voucher, checks list, sealed indicator, Copy as PR comment, Export. The seal indicator animates once (300ms spring) when a receipt arrives live over SSE. |
| `OpButton` | Runs a `/api/ops` action: idle, running (inline progress from SSE), done (win line, 4s), failed (consequence plus next step). |
| `EmptyState` | Three slots, always: what will appear here, why it matters, one button that populates it. |
| `WinLine` | The post-action confirmation sentence, accent-colored dot, auto-fades after 4 seconds, also logged to the activity feed. |

---

## 8. Design rules (concrete, no interpretation needed)

Apple-inspired in philosophy (clarity, deference, depth), Linear-translated in practice ("don't compete for attention you haven't earned", "structure should be felt, not seen"). Stays on the existing stack: React 19, Tailwind 4, tokens in `src/design-tokens/`.

- **Type scale, the only six:** 12 (caption), 13 (secondary), 15 (body), 17 (section title), 22 (page title), 28 (the one big number). Weights: 400, 500, 600 only. System font stack (SF on macOS, Segoe on Windows, Inter fallback).
- **Color:** warm gray neutral ramp (background, surface, border, text-secondary, text-primary: 5 steps per theme). **One accent**, used exclusively for interactive elements and the win-line dot. Verdict colors (green, amber, red) appear only as small dots and sparklines, never as card backgrounds. Dark mode is first-class, same rules.
- **Structure:** spacing on a 4px base (8, 12, 16, 24, 32). Radius 10px cards, 6px controls. Prefer spacing and grouping over borders; where a border is unavoidable, 1px at 8% opacity. No drop shadows except the drawer (one soft layer).
- **Density:** newcomers see summaries; everything deeper is one click. Hard cap: two disclosure levels (card → detail → drawer is the maximum anywhere).
- **Motion:** 150 to 250ms ease-out for panels and fades. The only springy animation in the product is the receipt seal (300ms). Card pulse on SSE update is a 600ms background tint fade at 6% accent. Nothing loops, nothing bounces.
- **Microcopy rules:** benefit-led labels everywhere ("Catch regressions before merge", never "Verification gates" as a bare label). Buttons say what the user gets. No em dashes, no exclamation marks, no jargon without a why. Sentence case everywhere.

---

## 9. Microcopy pack (use verbatim, extend in the same voice)

Page why-sentences:

- Pulse: "Everything important about your project, in one glance."
- Approvals: "Nothing risky moves forward without you. This is where you stay in control without reading logs."
- Trust: "Proof you can show anyone: what was checked, who wrote it, who vouched."
- Build: "Your codebase, mapped, measured, and honest."
- Automation: "Decide once how work flows. Paqad follows your rules every time."
- Knowledge: "Everything your agents know about this project. Edit it here, every agent learns it instantly."
- Setup: "Your project's foundation. Set it once, change it any time."

Feature why-sentences (card level):

- Verification gates: "Proof the work was actually checked before it ships."
- Evidence ledger: "A permanent record no one can quietly rewrite."
- Receipts: "Who wrote it, who vouched for it, sealed."
- AI-BOM: "Exactly which AI models touched your code."
- Decision pauses: "The AI stops and asks before anything risky."
- Module map: "What exists in your codebase, kept truthful automatically."
- Quality ratchet: "Quality can improve, never silently slip."
- Delivery policy: "What ships on its own, what waits for you."
- RAG context: "Your AI finds the right code by meaning, not filename."
- Defect patterns: "Mistakes from past projects, remembered so they never repeat."

Win lines (post-action):

- Instructions saved: "Saved. Agents reload this automatically on their next session."
- Decision resolved: "Done. The agent continues with your choice."
- Policy saved: "From now on, releases follow these rules."
- Reconcile clean: "Your module map matches reality. Nothing to do."

Consequence confirmations:

- RAG clear: "Clearing deletes the semantic index. The AI falls back to filename search until you rebuild."
- Pack remove: "Removing this pack removes its rules from every future change. Existing code is untouched."

---

## 10. Onboarding

No auto-firing tour (self-triggered guidance completes at far higher rates). Instead:

1. **A checklist of real actions**, dismissible, living on Pulse until completed: Connect your agent → Watch your first gate pass → Approve your first decision → Open your first receipt → Edit one instruction file. Each item deep-links to the real page and completes from real events, not clicks.
2. **Activation is the first completed loop:** a gate passed and its receipt viewed. That is the moment the product has proven itself; design for time-to-that-moment.
3. **Empty states are the tour.** Every zero-data screen already teaches (component spec in section 7). With this many features, that is the most scalable onboarding surface we have.
4. **Teach the command palette first**, in checklist item one. It signals who this product is for.

---

## 11. Build plan and acceptance criteria

| Phase | Scope | Done when |
|---|---|---|
| 1. Comprehension | New IA (7 areas), `OwnershipBadge`, `WhySentence`, `WhyDrawer`, `EmptyState` everywhere, `/api/inventory`, microcopy pack applied | Every functionality in section 3 is visible, classified, and explained on the web page |
| 2. Decisions and proof | Approvals inbox with resolve/accept/reject (write path, audit, SSE), Trust area (evidence timeline, receipts, AI-BOM, audit, export packet) | A user handles every pending decision and shows proof to a colleague without touching the CLI |
| 3. Full editing | Instructions editor, workflow pages with edit mode, delivery policy builder, module map editor, profile form, capabilities, packs, providers, RAG config, token editor, ops buttons, 409 diff flow | Zero user-owned settings require hand-editing files or the CLI for common cases |
| 4. Onboarding and polish | Checklist, activation tracking, receipt seal animation, command palette, export packet styling | A new user reaches the first completed loop without reading docs |

Global definition of done:

- Every mutation goes through the section 6.2 pipeline (validate, core write path, audit, SSE, agent sync). No direct file writes from route handlers.
- Every page passes the two-level disclosure cap and the one-accent rule.
- `--read-only` flag verifiably disables all mutations.
- Keyboard: palette, Cmd+S in editors, arrow navigation in the inbox.
- All copy follows section 9 voice. No em dashes, no jargon without a why.

## 12. Success metrics

- A new user can answer without docs: what does Paqad do for me, what is it doing right now, what is waiting on me.
- 100% of section 3A rows editable on the web page; 100% of section 3C rows readable and exportable.
- Time from install to first completed loop (gate passed, receipt viewed) measurably drops.
- Pending decisions resolved on the web within a session, instead of lingering in files.
- Users export or copy a trust artifact (receipt, evidence packet) in their first week. That artifact is the thing they show a friend.

---

<details>
<summary>Research sources (for reference, none required during implementation)</summary>

Problem: Thoughtworks Technology Radar on cognitive debt (prnewswire.com/news-releases/as-ai-accelerates-software-complexity-thoughtworks-technology-radar-urges-a-return-to-engineering-fundamentals-to-combat-cognitive-debt-302737210.html) · TechRadar, AI cognitive overload (techradar.com/pro/ai-promised-productivity-but-it-teams-got-cognitive-overload-instead) · Feature discovery and adoption (companionlink.com/blog/2026/03/7-ui-ux-design-problems-killing-your-product-phenomenon-studios-problem-solving-guide/amp/) · Why dev tools fail (medium.com/geekculture/this-common-mistake-causes-most-developer-tools-to-fail-769e22c4a951)

Design: Apple HIG (developer.apple.com/design/human-interface-guidelines/) · Linear design refresh (linear.app/now/behind-the-latest-design-refresh) · Stripe dashboard teardown (illustration.app/blog/stripe-payment-ux-gold-standard) · NN/g progressive disclosure (nngroup.com/articles/progressive-disclosure/) · NN/g empty states (nngroup.com/articles/empty-state-interface-design/)

Onboarding and trust UX: Appcues onboarding data (appcues.com/blog/user-onboarding-best-practices) · ProductFruits checklists (productfruits.com/blog/onboarding-checklist-examples) · Linear onboarding teardown (supademo.com/user-flow-examples/linear) · Smashing Magazine, agentic AI UX patterns (smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/)

</details>
