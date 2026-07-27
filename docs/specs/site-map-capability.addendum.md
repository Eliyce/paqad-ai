# Addendum — Functional coverage directives for the Site Map capability

Status: **addendum to the approved-pending plan** (planning/research only — no code). Owner: Haider. Date: 2026-07-27.
Extends: [`site-map-capability.proposal.md`](./site-map-capability.proposal.md) (functional design) and [`site-map-capability.plan.md`](./site-map-capability.plan.md) (operating model). Where this addendum and those documents disagree, this addendum wins.
Samples: [`site-map-samples/`](./site-map-samples/) — hand-authored examples demonstrating every directive below (paqad-ai's own hybrid map; a fictional web-shop fragment).

This absorbs four owner directives and answers "what can be added next", each grounded in a fresh research pass: (1) the map speaks **business language**, resolving translation keys; (2) features vary by **permission and flag** — the map is a permission map, not just a user map; (3) the map is **functional, not technical** — entries, areas, external systems, how a user navigates — with technical detail as provenance only; (4) **LLM prompt workflows are a first-class surface family** — many modern apps (paqad-ai itself included) ship flows that start with a user prompt and run staged, routed workflows.

---

## 1. The functional-altitude law

The map documents **how a user of this product moves through it** — never its internal architecture. This becomes a design law with three mechanisms:

- **Line of visibility (service-blueprint discipline).** Every node carries `visibility: frontstage | backstage` (named `visibility`, not `stage`, to avoid colliding with the plan's pipeline stages and the prompt-flow step nodes). Frontstage = what the user consciously experiences (pages, screens, commands, prompts, the Stripe page they get redirected to). Backstage = supporting machinery (jobs, queues, webhooks, emails being sent, hooks). The dashboard renders frontstage by default; backstage is a toggle. This is the service-design industry's exact answer to "what the user experiences vs supporting systems" (NN/g service blueprints).
- **Audience-calibrated altitude (C4 discipline).** The map lives at C4-Level-1 altitude — meaningful to a non-technical reader. Technical truth is not lost: it lives in `evidence: file:line` provenance and in drill-down links to module docs and the Graph area. Altitudes link; they never mix.
- **APIs and internal systems appear functionally.** For a web/mobile product, an internal API is not a node — it is what a surface *does* ("saves the order"), with the endpoint recorded as evidence. Full API-operation nodes appear only when the *product itself* is an API (kind: api), where operations are the user-facing surfaces. External systems are always nodes when the user's journey crosses them (§4).

## 2. Business language: labels from translation keys and the docs we already have

Onboarded projects often reference UI text by translation key (`t('checkout.title')`), and paqad projects already hold business language in two places: `docs/modules/**` (business.md names) and the module map's `domain_glossary` (`preferred_terms`, `synonyms`). The map must render **business terms, never keys or technical identifiers**.

- **Every surface stores a stable id AND a resolved label — never one field.** The analytics industry learned this the hard way: GA4's `page_title` fragments one screen into a row per language, while `screen_class` is stable but unreadable. Our `id` is the stable slug (also the analytics screen-name contract); `label` is the resolved default-locale business name; `labels:` optionally carries per-locale text.
- **An ordered, recorded label-resolution chain** (`label_source` says which rung won):
  1. explicit human override in the map (locked, refresh never touches it)
  2. the domain glossary's preferred term (module-map `domain_glossary` — the schema and fresh-map writer ship today, but existing maps, including paqad-ai's own version-2 map, may lack the block, so this rung degrades gracefully when absent; optionally a repo glossary file, the Contextive pattern)
  3. route-meta title key (the only in-code *declared* per-surface name — vue-router `meta.title`, Next.js metadata)
  4. the H1/heading key (the page's single-topic name)
  5. document-title key, then nav-label key
  6. humanized technical id (last resort, flagged low-confidence)
- **Key → text resolution is deterministic extraction**, not LLM guessing: AST-based extractors are the universal pattern (i18next-cli, FormatJS, gettext, Flutter ARB, strings.xml), covering both catalog topologies (keys-as-ids with text in the default-locale catalog; text-as-ids where source carries the default message). Known blind spot — dynamic keys — is handled the way the ecosystem handles it: magic-comment declarations, finite static resolution where possible, and an honest `low` confidence otherwise. Translation catalogs become a new extractor input class in the extraction stage (a pack-declarable location, like route globs).
- **Free by-product: per-surface i18n coverage.** Extraction knows key→file; the map knows file→surface; the join yields "surface X is missing 3 keys in `ja`, has 2 unused keys, 1 hardcoded string" — finer-grained than any TMS's per-namespace report, precedented by i18next-cli's CI-failing `status`/`lint`. New finding family: `SM-I18N-*`. A **locale lens** on the dashboard renders the map in any extracted locale.

## 3. Permissions, roles, flags: the permission map

"For one user I have this, for another I have that" becomes first-class structure, not prose:

- **Typed guard kinds** (NIST RBAC vocabulary): `permission` (an atomic approval to perform an operation), `role` (a *named bundle* of permissions), `feature-flag` (a `flag_key` + `required_variant` pair — never a raw value), plus `auth-state`, `data-state`, `capability`, `environment`. Guards remain ordered predicates on transitions (statecharts), each with `satisfy_via` (the testability hint) and evidence. Negation is expressed as `guard_not: <guard-id>` on a transition (or, for flags, by requiring the opposite variant).
- **Actor = permission bundle.** Actors declare `satisfies: [guard-ids]`. That single choice makes the **"view as" lens computable**: the dashboard filters the map to what any actor (or ad-hoc permission set) can reach — reproducing the ubiquitous admin "login as / view as role" pattern without test accounts. The classic **permission matrix** (actor × capability) is *generated* from guards, not hand-maintained — hand-maintained matrices rot; derived ones cannot.
- **Variants: annotate, don't duplicate — with one honest exception.** When a flag changes something *inside* a surface, the surface stays canonical and carries `variants: [{flag, variant, adds/changes}]` (OpenFeature/flagd give variants stable names; experiment *layers* model mutual exclusivity). When a flag swaps the *whole surface* (classic vs express checkout), two surfaces tied by `variant_group`/`variant_of` is the truthful shape. A **flag lens** renders the map under any flag assignment.
- **The flag registry is a map section and a debt detector.** Flags carry `owner`, `introduced`, and `lifecycle` (`new/active/launched/inactive/stale` — LaunchDarkly's formalized staleness). Imports: OpenFeature CLI manifest (`flags.json`), flagd config, provider APIs; code anchoring via the established scanner pattern (ld-find-code-refs). A `launched` flag still guarding a variant is a cleanup candidate — new finding family `SM-FLAG-*` (Uber's Piranha proves (flag, variant) → dead-path is mechanically computable, so these findings are deterministic-tier).

## 4. External and internal systems

- **External systems are first-class nodes** (`kind: external-system`) drawn like a separate swimlane pool: a departure transition, a **labeled payload** (`carries: "payment session token"` — swimlane practice insists on naming *what* crosses the boundary, not just "sends to"), and an **explicit re-entry transition** — which is what makes async loops mappable (email verification: app → inbox → link → re-entry; payment: app → Stripe → success/cancel returns).
- The same node may be backstage in one journey (receipt email) and frontstage in another (verification email the user must open) — visibility is per-context, defaulting from the node.

## 5. Prompt workflows: the new surface family (first of its kind)

The research confirms genuine whitespace: capability manifests stop at tool lists (MCP `tools/list`, the old ai-plugin.json), observability stops at dev-facing traces (Langfuse/LangSmith), conversational-AI formats stop at the chatbot boundary (Rasa). **Nobody maps an application's prompt-triggered LLM workflows as user-facing journeys.** paqad both needs this (it *is* such an app: CLI + dashboard + 10 prompt workflows today, 11 once `site-map` ships) and can define it.

The model — synthesized from Rasa CALM (the exact production precedent: an LLM routes fuzzy prompts onto declarative staged flows), PromptFlow/Step Functions (flows-as-reviewable-files with typed steps and terminal states), BPMN user tasks + LangGraph interrupts (human pauses with resumable state):

**Seven node kinds:**

| Kind | What it carries | Why |
| --- | --- | --- |
| `prompt-entry` | intent, example utterances, and the **routing description the router model actually reads** — carried on the entry node for single-intent entries, or distributed onto the router's edges (`utterances`) and the target flow surfaces (`routing_description`) when one conversational entry serves many flows (the paqad case) | In CALM, flow descriptions *are* the routing data — so the map documents routing as it actually happens |
| `router` | guarded edges, each with a human-readable `guard_text` and marked **`guard_mode: deterministic` or `llm-judged`**, plus a **mandatory `fallback` edge** | The deterministic-vs-model-judgment marker is modeled by no surveyed tool and is exactly paqad's honesty contract applied to routing; mature systems treat "couldn't route" as a modeled path, never an error |
| `step` | sub-type `llm` / `tool` / `collect` (elicit input into a named slot) / `decision-pause` (embedded form of the pause node), declared inputs/outputs, optional produced `artifact` | PromptFlow node typing; Rasa calls flow steps exactly this; `step` avoids colliding with the plan's pipeline stages |
| `decision-pause` | `presents` (what the human sees), enumerated `decisions`, **outcome-labeled outgoing edges**, optional timeout edge, `resumable: true` | BPMN User Task + LangGraph interrupt/Temporal semantics: a pause is a checkpoint, not a diagram symbol — a reader can enumerate every point a human can redirect the flow |
| `handoff` / `subflow` | mode `link` (control transfers, no return) vs `call` (returns) | Rasa's exact distinction; composes flows from flows |
| `terminal` | `success / failure / abandoned` + the **receipt artifact emitted** | Step Functions Succeed/Fail; a named receipt makes completion verifiable by checking the artifact exists |
| flow-level `state` | slots/variables guards reference | Makes guards verifiable |

Edge semantics: `sequence`, `guarded`, `outcome`, `fallback`, `handoff`; **cycles allowed** (retry/revise loops — LangGraph, not DAG-only).

**Extraction sources**: when the app declares its flows (paqad's routing tables + workflow rules; Rasa `flows.yml`; PromptFlow YAML; n8n JSON; Step Functions ASL) extraction is deterministic; code-first frameworks (LangGraph topology export, OpenAI SDK) get static topology plus agent-led enrichment at marked confidence — the same three-truth-layer pipeline as every other surface family.

**A free export**: a generated, user-facing **AI-capability manifest** — "what can you ask this app's assistant to do" — one entry per `prompt-entry` (intent, example prompt, outcome), the machine-generated version of Microsoft's hand-written Transparency Notes. For paqad itself this doubles as living docs of its own workflows.

**App-kind coverage now reads**: web · api · **cli** · mobile · **desktop** (windows/menus/shortcuts as surfaces — no dedicated pack recipes early on; agent-led extraction at marked confidence until a pack contributes hints) · service/worker · **llm-workflows** — and one product may be several at once (paqad: cli + web + llm-workflows; the sample shows all three in one map).

## 6. What can be added next (ranked extension catalog, research-validated)

Within the same site-mapping feature, strongest prior art first — items 1–7 are proven patterns awaiting composition; 8–12 are validated in adjacent tooling:

1. **Journey ↔ test alignment** — import Playwright codegen / Chrome DevTools Recorder JSON flows as journey evidence; flag journeys without covering tests. *(Already Phase 4 in the plan; the recorder-JSON import is new.)*
2. **Runtime conformance overlay ("digital twin")** — process-mining-style modeled-vs-observed diffing: dead journeys, undocumented paths, drop-off hotspots (Celonis conformance checking; Amplitude Journeys).
3. **Impact simulation** — "what breaks if we remove surface X": walk the map's edges + code dependencies + dependent flags.
4. **AI-capability manifest export** — §5's free export, published as a doc page and machine-readable inventory.
5. **Accessibility journey audits** — axe-core per mapped journey (not per page) in CI; WCAG status as a map overlay.
6. **Auto-generated product tours** — compile journeys into interactive walkthroughs (Arcade/Supademo-style), and the dashboard's own first-run playback comes free from the same data.
7. **Onboarding code tours** — emit CodeTour-schema `.tours/` JSON walking a developer through the code behind each journey (the newbie path from map to first commit).
8. **Privacy/data-flow overlay** — personal-data touchpoints per journey; per-journey RoPA-style records (DataGrail/Transcend precedent; the journey join is the novel part).
9. **Environment/tenant/flag variant maps** — journey × flag-state × environment matrices (LaunchDarkly view-across-environments precedent).
10. **Observability deep-links** — stable map node IDs as the join key into Langfuse/Helicone-style traces; the map becomes the index into runtime behavior.
11. **Living two-way sync** — Zapier-Canvas-grade binding where the map updates the moment the underlying flow changes (our drift machinery is the foundation).
12. **SEO/crawlability view** (web only) — crawl-depth and orphan-page overlays computed from the map's own link graph.

## 7. Impact on the approved-pending plan (deltas only)

Nothing in the stage registry, skill granularity, or agent roles changes. The deltas:

- **Extraction stage (S1)** gains three extractor input classes: translation catalogs, flag inventories (OpenFeature manifest/flagd/provider API), and declared prompt-flow sources (routing tables, flow YAML). All pack-declarable, all deterministic-first.
- **Modeling stage (S2)** gains the label-resolution script (chain of §2, recorded `label_source`) inside `surface-modeling` — a script, not a new skill.
- **Schema** gains: `label`/`label_key`/`label_source`/`labels{}`, `visibility: frontstage|backstage`, guard-kind enum with `flag_key`+`required_variant` and `guard_not` negation, `variants[]`/`variant_group`, flag `lifecycle`/`owner`, `hand_off.carries` + re-entry, actor `satisfies[]`, the app-`kind` enum extended with `desktop` and `llm-workflows`, and the seven prompt-flow node kinds with `guard_text`+`guard_mode` on router edges.
- **Finding families** gain `SM-I18N-*` (missing/unused/hardcoded per surface) and `SM-FLAG-*` (stale-flag-guarded variants) — both deterministic-tier.
- **Dashboard** gains four lenses (actor/permission, locale, flag assignment, environment later) and the AI-capability manifest page; lenses are computed views over guards, not stored variants.
- **Verification (S6)** Tier A gains: label-chain resolution recorded, guard `flag_key` exists in the flag registry, prompt-flow router edges each carry `guard_mode`, every external hand-off has a re-entry or an explicit terminal.
- **Phasing**: the prompt-flow schema ships in P1 (paqad dogfoods it — it is the P1 test subject); lenses and i18n coverage land in P2; flag-debt findings in P3 with the sync machinery; extensions 1–7 populate P4+ in catalog order.

## 8. New decision points for the owner

11. **Prompt-flow surfaces in P1** via paqad's self-map as the dogfood subject. *(Recommended: yes — it is the only way to keep the schema honest beyond web apps from day one.)*
12. **Locale of record**: map labels resolve to the project's default locale; per-locale rendering is a lens, not stored duplication. *(Recommended.)*
13. **Glossary precedence**: module-map `domain_glossary` outranks translation catalogs when both name a concept. *(Recommended — the glossary is the team's declared business language.)*
14. **Flag-inventory imports**: OpenFeature manifest + env-file/static detection in P1–P2; vendor APIs (LaunchDarkly etc.) as optional connectors later. *(Recommended.)*
15. **Extension sequencing**: adopt the §6 ranking as the P4+ backlog seed. *(Recommended; re-rank at each phase gate.)*
