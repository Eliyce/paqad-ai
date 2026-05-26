```
██████╗  █████╗  ██████╗  █████╗ ██████╗
██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗
██████╔╝███████║██║   ██║███████║██║  ██║
██╔═══╝ ██╔══██║██║▄▄ ██║██╔══██║██║  ██║
██║     ██║  ██║╚██████╔╝██║  ██║██████╔╝
╚═╝     ╚═╝  ╚═╝ ╚══▀▀═╝ ╚═╝  ╚═╝╚═════╝
```

**AI agents that think before they type.** paqad-ai reads your codebase, detects your stack, builds optional hybrid RAG context, and generates the docs, rules, MCP configs, security checks, and workflows your coding agents need to operate with real project context.

[![npm version](https://img.shields.io/npm/v/paqad-ai.svg?style=flat-square)](https://www.npmjs.com/package/paqad-ai)
[![npm downloads](https://img.shields.io/npm/dm/paqad-ai.svg?style=flat-square)](https://www.npmjs.com/package/paqad-ai)
[![CI](https://img.shields.io/github/actions/workflow/status/Eliyce/paqad-ai/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Eliyce/paqad-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/paqad-ai.svg?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/node/v/paqad-ai.svg?style=flat-square)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](./CONTRIBUTING.md)
[![website](https://img.shields.io/badge/website-paqad.ai-0A7A5C?style=flat-square)](https://paqad.ai)
[![docs](https://img.shields.io/badge/docs-paqad.ai-1f6feb?style=flat-square)](https://paqad.ai)

---

## The problem

You install an AI coding agent. You ask it to help with your Laravel + React project. It doesn't know your folder structure, conventions, test runner, or which version of anything you're running.

Then the context problem gets worse: the agent still cannot retrieve the right files when the repo is large, ambiguous, or spread across app code, docs, workflows, and generated artifacts. It guesses. It misses the right modules. It burns tokens on the wrong files.

So you spend an hour writing `CLAUDE.md` by hand. Then you do it again for Cursor. And again for Copilot. And again when your stack changes. Then you still have to solve retrieval, documentation drift, and workflow consistency yourself.

**paqad-ai solves both setup and retrieval: shared instructions for multiple external agent platforms, plus a built-in multi-agent runtime and optional hybrid RAG for real project context.**

---

## Get started

```bash
npm install -g paqad-ai
cd your-project
paqad-ai onboard
```

paqad-ai reads your lockfiles, detects your stack, asks you to confirm, and generates everything:

```
✓ Detected: laravel + react (inertia, tailwind, pest, docker)
✓ Generated: CLAUDE.md, AGENTS.md, ANTIGRAVITY.md, GEMINI.md, .cursor/rules/paqad.mdc
✓ Generated: .github/copilot-instructions.md, .windsurfrules
✓ Generated: docs/instructions/rules/* and stack-specific tool guides
✓ Wrote: .paqad/project-profile.yaml, onboarding-manifest.json, detection-report.json
✓ Configured: adapter entry files and MCP settings for selected platforms

Ready. Your AI agents now understand your project.
```

Or run with `npx` without installing:

```bash
npx paqad-ai onboard
```

---

## Core features

| Area                     | What you get                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------ |
| **Agent onboarding**     | Shared instructions and MCP config for supported external agent platforms            |
| **Stack detection**      | Lockfile-driven framework, trait, and archetype detection across 9 ecosystems        |
| **Documentation**        | Stack, architecture, design-system, registry, and module documentation flows         |
| **Hybrid RAG**           | Optional vector indexing, hybrid retrieval, reranking, evals, and benchmarks         |
| **Project graph**        | One-command WebGL map of modules, files, chunks, symbols, imports, and similarities  |
| **Security**             | OWASP-mapped pentest workflow with incremental retests                               |
| **Spec compliance**      | Obligation extraction, test evidence checks, and failing skeleton generation         |
| **Built-in agent roles** | 20 internal specialist roles for routing, review, design, verification, and security |
| **Context controls**     | Chunking, scoring, dedup, summarization, and budget enforcement                      |
| **Pack system**          | Built-in and custom stack packs for framework-specific behavior                      |
| **Operations**           | `doctor`, `compliance`, `refresh`, `update`, `patterns`, and capability toggles      |

---

## Supported adapters

One onboarding. Thin entry files that all point to the same shared instruction bundles:

| Platform               | What it generates                                      |
| ---------------------- | ------------------------------------------------------ |
| **Claude Code**        | `CLAUDE.md` + MCP config                               |
| **Codex CLI**          | `AGENTS.md` + MCP config                               |
| **Google Antigravity** | `ANTIGRAVITY.md` + MCP config                          |
| **Gemini CLI**         | `GEMINI.md` + MCP config                               |
| **Junie**              | `.junie/AGENTS.md` + `.junie/mcp/mcp.json`             |
| **Cursor**             | `.cursor/rules/paqad.mdc` + MCP, skills, agents        |
| **GitHub Copilot**     | `.github/copilot-instructions.md` + `.vscode/mcp.json` |
| **Windsurf**           | `.windsurfrules` + MCP, skills, agents                 |
| **Continue**           | `.continue/rules/paqad.md` + MCP, prompts              |
| **Aider**              | `CONVENTIONS.md` (config-only)                         |

Pick one or pick all. `paqad-ai onboard` lets you multi-select. If no `--providers` flag is passed, onboarding defaults to `claude-code`.

## 20 built-in specialist agents

Beyond adapter targets, paqad-ai also ships internal agent roles used by the framework's runtime content, reviews, workflows, and specialized guidance.

| Group                    | Count | Examples                                                                     |
| ------------------------ | ----- | ---------------------------------------------------------------------------- |
| **Base workflow agents** | 11    | `router`, `verifier`, `story-designer`, `test-planner`, `product-owner`      |
| **Coding specialists**   | 8     | `solution-architect`, `database-expert`, `devops-engineer`, `doc-maintainer` |
| **Security specialists** | 1     | `security-auditor`                                                           |

That is **20 built-in agent roles** in the shipped runtime, in addition to the supported external adapters above.

---

## 22 built-in Stack Packs

paqad-ai parses manifests and lockfiles across 9 ecosystems. It doesn't ask what stack you use — it reads your repo to figure it out.

**19 framework packs:**

`laravel` · `react` · `vue` · `flutter` · `django` · `fastapi` · `rails` · `spring-boot` · `express` · `angular` · `svelte` · `astro` · `go-web` · `rust-web` · `dotnet` · `nextjs` · `flask` · `nestjs` · `kotlin-android`

**3 archetype packs** (fallback for Node projects that don't match a framework):

`node-cli` · `node-library` · `node-service`

Each pack is a declarative `pack.yaml` that drives detection, documentation, MCP configuration, security mappings, and more. Don't see your framework? [Author your own pack](./docs/modules/packs/features/authoring/technical.md).

**What it reads:**

| Ecosystem  | Manifests & lockfiles                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| **Node**   | `package.json`, `package-lock.json`, `pnpm-lock.yaml`                                     |
| **PHP**    | `composer.json`, `composer.lock`                                                          |
| **Python** | `requirements.txt`, `pyproject.toml`, `Pipfile`, `Pipfile.lock`, `poetry.lock`, `uv.lock` |
| **Ruby**   | `Gemfile`, `Gemfile.lock`                                                                 |
| **JVM**    | `build.gradle`, `build.gradle.kts`, `pom.xml`, `gradle.lockfile`                          |
| **Go**     | `go.mod`, `go.sum`                                                                        |
| **Rust**   | `Cargo.toml`, `Cargo.lock`                                                                |
| **Dart**   | `pubspec.yaml`, `pubspec.lock`                                                            |

Lockfiles always win over manifest constraints. Traits like `inertia`, `tailwind`, `pest`, `docker`, and `sail` are detected automatically from packages and config files.

**Stack + capability matrix:**

| Stack              | Available traits                                   |
| ------------------ | -------------------------------------------------- |
| **Laravel**        | `inertia`, `react`, `vue`, `tailwind`, `boost`     |
| **React**          | `next`, `remix`, `vite-spa`, `gatsby`, `tailwind`  |
| **Vue**            | `nuxt`, `vite-spa`, `quasar`, `tailwind`           |
| **Flutter**        | `docker`, `compose`                                |
| **Django**         | `docker`, `compose`                                |
| **FastAPI**        | `docker`, `compose`                                |
| **Rails**          | `docker`, `compose`                                |
| **Spring Boot**    | `docker`, `compose`                                |
| **Express**        | `docker`, `compose`                                |
| **Angular**        | `docker`, `compose`                                |
| **Svelte**         | `docker`, `compose`                                |
| **Astro**          | `docker`, `compose`                                |
| **Go Web**         | `docker`, `compose`                                |
| **Rust Web**       | `docker`, `compose`                                |
| **ASP.NET Core**   | `ef-core`, `mvc`, `minimal-api`, `blazor`          |
| **Next.js**        | `app-router`, `pages-router`, `tailwind`, `prisma` |
| **Flask**          | `sqlalchemy`, `blueprints`, `celery`, `gunicorn`   |
| **NestJS**         | `prisma`, `typeorm`, `graphql`, `swagger`          |
| **Kotlin Android** | `jetpack-compose`, `room`, `hilt`, `navigation`    |

Laravel also detects `pest`, `phpunit`, `sail`, `docker`, and `compose` automatically. Environment traits like Docker and Compose are detected across all stacks.

---

## What you get after onboarding

paqad-ai isn't just a setup tool. Here's the full feature set:

### Stack intelligence and pack resolution

Detection is lockfile-first and feeds the rest of the framework. Onboarding, refresh, docs, MCP config, and security workflows all consume the same resolved stack profile and effective pack set.

| System                  | What it does                                                                     |
| ----------------------- | -------------------------------------------------------------------------------- |
| **Framework detection** | Detects frameworks, traits, and archetypes from manifests, lockfiles, and config |
| **Pack resolution**     | Merges built-in, global, and project pack overrides by precedence                |
| **Capability routing**  | Activates `content`, `coding`, and `security` based on the effective stack       |
| **Drift tracking**      | Stores stack snapshots and reports when the live repo diverges from onboarding   |

### Documentation as a first-class output

Docs aren't an afterthought — they're a primary framework output. There's no standalone `document` command. Instead, ask any connected agent to `create documentation` and the workflow:

1. Re-reads your live app state from manifests and lockfiles
2. Syncs if reality differs from stored onboarding data
3. Generates stack docs, architecture docs, design-system docs
4. Generates module docs — `business.md` + `technical.md` per feature
5. Tracks progress in `.paqad/doc-progress.json`

**Differential refresh** — when files change, only stale docs are regenerated.

### Security — "Break locally first"

A resumable 5-step pentest workflow with **12 security skills** and full OWASP coverage:

| Standard                    | Coverage     |
| --------------------------- | ------------ |
| **OWASP Top 10 2025**       | A01–A10 ✓    |
| **OWASP API Security 2023** | API1–API10 ✓ |

**The 12 skills:**

| Skill                         | What it checks                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `dependency-advisory-triage`  | Supply chain: typosquatting, dependency confusion, abandoned packages, transitive risk  |
| `permission-boundary-review`  | BOLA, function-level auth, mass assignment, resource consumption                        |
| `business-logic-abuse-review` | Race conditions, workflow bypass, financial manipulation, GraphQL abuse                 |
| `runtime-surface-probing`     | Headers, CORS, error disclosure, open redirects, sensitive files, SSRF, TLS             |
| `stride-threat-model`         | Systematic STRIDE enumeration per module and surface type                               |
| `input-validation-review`     | SSRF, IDOR, injection (SQL, template, command), file upload, prototype pollution, ReDoS |
| `auth-mechanism-review`       | JWT flaws, session fixation, OAuth/OIDC, brute-force, MFA bypass                        |
| `cryptographic-review`        | Encryption at rest/transit, key management, password hashing, weak PRNG                 |
| `logging-monitoring-review`   | Audit trail gaps, log injection, alerting coverage                                      |
| `rate-limiting-review`        | Missing throttling per framework, DoS surfaces                                          |
| `finding-normalizer`          | Stable PT-XXXX IDs across retests                                                       |
| `retest-verification`         | Finding replay against fresh evidence                                                   |

**Local attack playbook** — generates `curl` commands to prove findings locally. Never auto-executes.

**Incremental mode** — only re-scans changed files. Full scan staleness warning after 14 days.

### Context intelligence

Your AI agent has a limited context window. paqad-ai makes every token count:

| System               | What it does                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **Semantic loader**  | Chunks files at AST boundaries, scores by 5-signal relevance, packs into 40/45/15% budget    |
| **Budget optimizer** | 4 graduated tiers (green → yellow → amber → red), auto eviction + summarization              |
| **Deduplication**    | Identical artifacts from multiple paths → one-line reference pointers                        |
| **Turn summarizer**  | Old turns → structured extracts (decisions, files, blockers, next steps). No LLM, pure regex |
| **Stream truncator** | Per-tier output limits (fast: 2K, medium: 5K, reasoning: 15K) with sentence-boundary cuts    |

### Optional hybrid RAG retrieval

RAG is optional, but when enabled it plugs directly into the semantic loader instead of living off to the side as a separate experiment.

| Feature                 | What it does                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| **Vector index**        | Builds an AST-aware code/document index under `.paqad/vectors/` from the chunk index        |
| **Embedding providers** | Supports `local` (default), `openai`, and `voyageai` with provider-specific default models  |
| **Hybrid scoring**      | Fuses vector similarity, keyword overlap, symbol hits, and file-path proximity              |
| **Adaptive depth**      | Routes retrieval as `none`, `standard`, or `deep` based on task complexity, risk, and scope |
| **Metadata filtering**  | Narrows candidates by extension, module path, framework, and recency with safe fallbacks    |
| **Reranking**           | Supports `passthrough`, local cross-encoder reranking, or Cohere reranking                  |
| **Pattern vectors**     | Extends retrieval with vectorized cross-project patterns from `~/.paqad/patterns/`          |
| **Audit + fallbacks**   | Logs build/fallback/provider mismatch events to `.paqad/audit.log`                          |
| **Eval gates**          | Benchmarks hit@5, task success, correction turns, and prompt-token deltas                   |

RAG configuration lives in `.paqad/project-profile.yaml`. Project-specific corpus exclusions can be tuned with `.paqad/rag.ignore.yaml`, and remote provider keys are stored in `.paqad/secrets.env`.

### Smart session handoff

Structured v2 handoff captures active task, decisions, files, blockers, and next steps. **70–85% smaller** than raw dumps. Both JSON and Markdown.

### Predictive skill cache

Learns skill execution sequences. Pre-warms cache when `P(next | current) ≥ 0.7`. Disabled by default — transition data accumulates passively.

### Custom workflows

```yaml
# docs/instructions/workflows/feature-with-review.yaml
name: feature-with-review
triggers:
  workflow: [feature]
  complexity: [medium, high]
steps:
  - skill: scope-check
  - skill: spec-diff
    condition: { complexity: [medium, high] }
  - parallel:
      - skill: implementation
      - skill: test-writer
  - skill: adversarial-review
    condition: { risk: [medium, high] }
  - skill: diff-doc-sync
```

Conditional steps, parallel execution, failure handling (`abort` / `skip` / `retry`), resumable runs.

### Cross-project pattern library

Verified solutions stored globally at `~/.paqad/patterns/`. Scored by framework overlap + keyword match, staleness penalty after 180 days.

### Spec compliance verification

Structured feature specs can be turned into executable obligation artifacts before implementation starts.

| Workflow                  | What it does                                                                |
| ------------------------- | --------------------------------------------------------------------------- |
| **Obligation extraction** | Parses structured Markdown specs into deterministic obligation indexes      |
| **Compliance checking**   | Scans tests for explicit obligation evidence and reports coverage gaps      |
| **Skeleton generation**   | Creates failing Vitest stubs from obligations before implementation begins  |
| **Index doctoring**       | Validates schema version and duplicate IDs before checks or skeleton output |

Compliance artifacts live under `.paqad/compliance/` and are designed so the durable module docs can outlive the original feature spec once the behavior is implemented.

### Health, refresh, and update workflows

The operational side matters too: paqad-ai keeps generated artifacts and project state from quietly drifting.

| Workflow         | What it does                                                                        |
| ---------------- | ----------------------------------------------------------------------------------- |
| **Doctor**       | Validates framework artifacts, copied instructions, MCP config, docs, and RAG state |
| **Refresh**      | Re-detects stack and regenerates stack or design-system outputs                     |
| **Update**       | Rewrites framework-managed artifacts against the current package version            |
| **Compliance**   | Extracts spec obligations, checks evidence, generates skeletons, validates indexes  |
| **Capabilities** | Toggles active capability layers with dependency rules                              |
| **Patterns**     | Lists, prunes, and exports the global pattern library                               |

---

## The capability model

| Capability | What it enables                                                 | When it activates           |
| ---------- | --------------------------------------------------------------- | --------------------------- |
| `content`  | Writing rules, content skills, doc workflows                    | Always on                   |
| `coding`   | Stack detection, resolver, MCP config, implementation workflows | When a pack matches         |
| `security` | 12 security skills, pentest workflow, finding tracking          | Automatically with `coding` |

No framework match? Content-only setup. Node projects without a framework match get archetype packs (`node-cli`, `node-library`, `node-service`) with full `coding` + `security`.

---

## CLI reference

### `paqad-ai install`

Bootstraps the framework into a project and writes framework metadata.

```bash
paqad-ai install --project-root .
```

### `paqad-ai onboard`

Full project onboarding. The main command.

```bash
# Interactive — prompts for providers, confirms detected stack
paqad-ai onboard

# Explicit stack and providers
paqad-ai onboard --stack laravel --capability react tailwind --providers claude-code antigravity cursor

# Flutter with all providers
paqad-ai onboard --stack flutter

# Next.js with Tailwind
paqad-ai onboard --stack react --capability next tailwind

# GitHub Copilot only
paqad-ai onboard --providers github-copilot

# Windsurf + Continue
paqad-ai onboard --providers windsurf continue
```

**Options:**

| Flag                       | What it does                                             |
| -------------------------- | -------------------------------------------------------- |
| `--project-root <path>`    | Target directory (default: `.`)                          |
| `--stack <stack>`          | Manual framework override                                |
| `--capability <traits...>` | Manual trait overrides (e.g., `inertia tailwind docker`) |
| `--providers <agents...>`  | Which agents to generate for                             |

**Available `--stack` values:** `laravel`, `flutter`, `react`, `vue`, `django`, `fastapi`, `rails`, `spring-boot`, `express`, `angular`, `svelte`, `astro`, `go-web`, `rust-web`, `dotnet`, `nextjs`, `flask`, `nestjs`, `kotlin-android`, `short-video`

**Available `--providers`:** `claude-code`, `codex-cli`, `antigravity`, `gemini-cli`, `junie`, `cursor`, `github-copilot`, `windsurf`, `continue`, `aider`

**Notes:**

- `react` and `vue` are mutually exclusive — pick one
- `nextjs` supersedes standalone `react`, and `nestjs` supersedes standalone `express`
- Standalone React/Vue brings sub-stack rule bundles (`next`, `remix`, `nuxt`, etc.)
- Laravel auto-detects Pest vs PHPUnit from Composer dependencies
- Empty or content-only repos onboard as `active_capabilities: [content]`
- Onboarding is idempotent — running it twice produces the same output
- Default provider is `claude-code` if none specified

### `paqad-ai doctor`

Health checks. Validates framework artifacts, profile schema, instruction bundles, adapter config, MCP config, and doc completeness.

```bash
paqad-ai doctor
```

Exits `1` on failure, `0` on pass.

### `paqad-ai compliance`

Spec verification and test-evidence tooling.

```bash
paqad-ai compliance extract --spec docs/features/spec-compliance-verification.md
paqad-ai compliance check
paqad-ai compliance review docs/features/spec-compliance-verification.md
paqad-ai compliance skeleton --out tests/compliance-skeletons
paqad-ai compliance doctor
paqad-ai compliance boundary
paqad-ai compliance patterns
```

Use it to persist an obligation index, run spec-quality review, check tests for explicit `@obligation` evidence, generate failing Vitest skeletons, validate index/report health, and run boundary/pattern gap tooling before CI or review.

### `paqad-ai refresh`

Re-detects stack and regenerates derived artifacts without full re-onboarding.

```bash
paqad-ai refresh              # Both stack + design system
paqad-ai refresh --stack       # Stack snapshot + stack docs only
paqad-ai refresh --design-system  # Design system docs only
```

### `paqad-ai update`

Regenerates framework-managed files after a package version change. Preserves your onboarding decisions.

```bash
paqad-ai update
```

### `paqad-ai capabilities`

```bash
paqad-ai capabilities list       # What's active
paqad-ai capabilities available   # What's available
paqad-ai capabilities add coding  # Activate coding + security
paqad-ai capabilities remove coding  # Deactivate coding + security
```

Rules: `content` can't be removed. Removing `coding` also removes `security`. Adding `coding` auto-adds `security`.

### `paqad-ai packs`

```bash
paqad-ai packs list              # Show effective packs + sources
paqad-ai packs list --json       # Machine-readable with override state
paqad-ai packs install <source>  # Local path, git URL, or registry name
paqad-ai packs install <source> --scope project --project-root .
paqad-ai packs remove <name>     # Remove overrides only (can't remove built-ins)
paqad-ai packs validate <path>   # Validate a pack before installing
paqad-ai packs create <name>     # Scaffold a new pack
```

### `paqad-ai rag`

Optional RAG management, indexing, and benchmark tooling.

```bash
paqad-ai rag init                          # Enable RAG and build the initial vector index
paqad-ai rag init --provider local         # Local embeddings via Xenova/all-MiniLM-L6-v2
paqad-ai rag init --provider openai        # Remote embeddings via text-embedding-3-small
paqad-ai rag init --provider voyageai      # Remote embeddings via voyage-code-3
paqad-ai rag rebuild                       # Force a full rebuild
paqad-ai rag status                        # Show provider, model, validity, size, chunk count
paqad-ai rag clear --yes                   # Delete the vector index and disable RAG
paqad-ai rag eval                          # Run deterministic evals on the current index
paqad-ai rag eval --mode lexical-vs-rag
paqad-ai rag eval --baseline ./baseline.json --mode rag-vs-candidate
paqad-ai rag eval --model-graded           # Also run the optional model-graded lane
```

**What `rag init` configures:**

- Builds a vector index from the existing chunk index and enables `intelligence.rag_enabled`
- Persists provider/model selection in `.paqad/project-profile.yaml`
- Uses a free local model by default, or prompts for `OPENAI_API_KEY` / `VOYAGE_API_KEY` when needed
- Reuses cached local models under `~/.paqad/models` to avoid repeat downloads

**What `rag eval` measures:**

- `hit_at_5`
- `task_success_rate`
- `correction_turns`
- `prompt_tokens_sent`

Benchmark comparisons support `lexical-vs-rag`, `rag-vs-candidate`, and `feature-off-vs-on`.

### `paqad-ai graph`

Open an interactive WebGL map of your project in the browser. One command, no extra install — the server, frontend, and Force Atlas 2 layout worker all ship inside `paqad-ai`.

```bash
paqad-ai graph                          # Opens http://127.0.0.1:5371 in your browser
paqad-ai graph --no-open                # Print the URL and skip auto-open
paqad-ai graph --port 8080              # Custom port (auto-increments if busy)
paqad-ai graph --host 0.0.0.0           # Share on a trusted network (loopback by default)
paqad-ai graph --threshold 0.85         # Initial similarity threshold
paqad-ai graph --no-watch               # Disable live reload on .paqad/ changes
```

**What you get:**

- Modules, files, chunks, symbols, and the full import graph rendered together as one explorable map
- Click-through detail panel: module file lists, file `imports_in` / `imports_out`, chunk content with show-more, symbol metadata
- Search across modules, files, symbols, and file basenames — `/` to focus, `n` / `N` to cycle matches; the camera pans to each hit
- Similarity slider — adjust the cosine threshold and watch the orange semantic-neighbour edges redraw on demand. Works with `local`, `openai`, and `voyageai` embeddings.
- Four intelligence overlays — health, defect density (log-scaled), risk floor, complexity correction — with a persistent legend
- Live reload — change anything under `.paqad/` and the graph updates in place while preserving viewport and selection

**Pre-conditions:** the current directory must contain a `.paqad/` from a previous `paqad-ai onboard`. RAG is optional — without it the graph still renders fully, with similarity and chunk nodes disabled behind a clear banner.

### `paqad-ai dashboard`

The single-pane "where am I on this project?" view. Same bundle as `paqad-ai graph` — the graph view is now one section inside the dashboard, opened by the architecture card.

```bash
paqad-ai dashboard                       # Opens http://127.0.0.1:5372/#/dashboard
paqad-ai dashboard --no-open             # Print the URL and skip auto-open
paqad-ai dashboard --port 8080           # Custom port (auto-increments if busy)
paqad-ai dashboard --no-watch            # Disable live reload on .paqad/ changes
```

**What you get:**

- Overall completeness score (existence + freshness, no content-quality heuristics)
- A card per section: project profile, rules, workflows, decisions (living), module health (living), module docs, architecture, design system / stack / registries / tools / tech-debt, stack drift, framework version, RAG status, and — when present — pentest and session continuity
- Per-card score badge using the same `mod-green` / `mod-amber` / `mod-red` / `mod-unknown` tokens as the graph view
- Helper text behind a `?` affordance on every card (what this means + what good looks like)
- Summary band with up to five "Needs your attention" items, ordered critical-first
- Live reload — same SSE pattern as the graph view, the card border pulses when its section changes
- `paqad-ai graph` and `paqad-ai dashboard` share the bundle; switching between routes is a hash-router nav

### `paqad-ai status`

One-shot LLM-friendly snapshot of the same report — no server, no long-running process. Use this from an agent prompt.

```bash
paqad-ai status                          # Markdown (default) to stdout
paqad-ai status --format json            # Full DashboardReport contract
paqad-ai status --project-root <path>    # Snapshot a different project
```

The JSON shape is stable (`schemaVersion: 1`) and identical to the payload served by `GET /api/dashboard` on the dashboard server.

### Security workflows

Security and retest flows are part of the framework runtime and agent workflows in this package version. They are not exposed as standalone top-level CLI commands in `paqad-ai` today.

### Pattern library

```bash
paqad-ai patterns list [--domain <d>] [--frameworks <f1,f2>] [--category <c>]
paqad-ai patterns prune [--older-than <days>]
paqad-ai patterns export <output> [--format json|markdown]
```

### `paqad-ai plan`

Resumable execution of structured planning manifests. Picks up at the last incomplete slice.

```bash
paqad-ai plan resume <slug>
```

### `paqad-ai module-health`

Maintains the module health ledger. `sync` ingests pending provider evidence into the module profile; `record` writes a normalized evidence entry directly.

```bash
paqad-ai module-health sync
paqad-ai module-health record
```

---

## What paqad-ai manages

```text
your-project/
├── CLAUDE.md                              # onboarding, if Claude Code is selected
├── AGENTS.md                              # onboarding, if Codex CLI is selected
├── ANTIGRAVITY.md                         # onboarding, if Antigravity is selected
├── GEMINI.md                              # onboarding, if Gemini CLI is selected
├── CONVENTIONS.md                         # onboarding, if Aider is selected
├── .junie/AGENTS.md                       # onboarding, if Junie is selected
├── .cursor/rules/paqad.mdc               # onboarding, if Cursor is selected
├── .github/copilot-instructions.md        # onboarding, if GitHub Copilot is selected
├── .windsurfrules                         # onboarding, if Windsurf is selected
├── .continue/rules/paqad.md               # onboarding, if Continue is selected
│
├── docs/
│   ├── instructions/
│   │   ├── stack/                         # generated later by refresh/documentation workflows
│   │   │   ├── overview.md
│   │   │   ├── frameworks.md
│   │   │   ├── dependencies.md
│   │   │   ├── tooling.md
│   │   │   ├── version-rules.md
│   │   │   ├── sources.md
│   │   │   └── drift-report.md
│   │   ├── rules/                         # onboarding-generated conventions and writing rules
│   │   ├── tools/                         # onboarding-generated stack tool guides
│   │   └── workflows/                     # user-authored workflow templates
│   ├── modules/                           # generated later by documentation workflows
│   └── pentest/                           # generated later by security workflows
│
└── .paqad/                                # Framework metadata (machine-managed)
    ├── project-profile.yaml
    ├── stack-snapshot.json
    ├── stack-drift.json
    ├── onboarding-manifest.json
    ├── rag.ignore.yaml                    # Optional RAG corpus include/exclude rules
    ├── secrets.env                        # Optional API keys for remote RAG providers
    ├── audit.log                          # Build, fallback, and provider mismatch events
    ├── compliance/                        # Obligation indexes and related compliance artifacts
    ├── doc-progress.json
    ├── pentest/runs/                      # generated when pentest workflows run
    ├── session/                           # Handoff, budget, dedup stats
    ├── context/                           # Chunk index, load stats
    ├── vectors/                           # Optional RAG vector index + metadata
    ├── cache/                             # Transition log, metrics
    └── workflows/                         # Custom workflow run state
```

Entry files stay thin. Knowledge lives in shared instruction bundles that external platforms and built-in runtime roles consume consistently.

---

## Workflow overview

| Workflow              | How to trigger                         | What happens                                              |
| --------------------- | -------------------------------------- | --------------------------------------------------------- |
| **Onboarding**        | `paqad-ai onboard`                     | Detect stack → confirm → generate everything              |
| **Health check**      | `paqad-ai doctor`                      | Validate artifacts, config, docs                          |
| **Spec compliance**   | `paqad-ai compliance ...`              | Extract obligations, check evidence, generate skeletons   |
| **Refresh**           | `paqad-ai refresh`                     | Re-detect stack, update derived docs                      |
| **Update**            | `paqad-ai update`                      | Regenerate framework files after version bump             |
| **RAG**               | `paqad-ai rag ...`                     | Build, inspect, clear, and benchmark hybrid retrieval     |
| **Project graph**     | `paqad-ai graph`                       | Interactive browser view of modules, files, chunks, deps  |
| **Project dashboard** | `paqad-ai dashboard`                   | Living single-pane health overview, per-section scoring   |
| **Project status**    | `paqad-ai status [--format json]`      | One-shot LLM-friendly snapshot of the dashboard           |
| **Documentation**     | Ask agent: _"create documentation"_    | Stack → architecture → design system → modules            |
| **Pentest**           | Ask agent: _"run pentest"_             | 5-step scan → findings → report                           |
| **Retest**            | Ask agent: _"retest pentest"_          | Replay findings → fixed / still-open / needs-verification |
| **Capabilities**      | `paqad-ai capabilities add/remove`     | Toggle content / coding / security                        |
| **Pack management**   | `paqad-ai packs install/remove`        | Install, validate, scaffold stack packs                   |
| **Pattern library**   | `paqad-ai patterns ...`                | Query, prune, and export reusable solutions               |
| **Custom workflows**  | YAML at `docs/instructions/workflows/` | Your own resumable skill sequences                        |

---

## Requirements

| Requirement | Version                       |
| ----------- | ----------------------------- |
| **Node.js** | `≥ 22` (pinned via `.nvmrc`)  |
| **pnpm**    | `10+` (for local development) |

---

## Development

```bash
pnpm install
npm run format     # required before completion
npm run ci         # required before completion
```

```bash
pnpm run test       # Tests only
pnpm run test:coverage  # Coverage gate summary
pnpm run typecheck  # TypeScript checks
pnpm run lint       # ESLint
pnpm run build      # Production build
```

Every completed change in this repo is expected to keep 100% lines, 100% statements, 100% functions, and 100% branches coverage, add positive and negative E2E coverage for changed user flows, and update the owning `docs/modules/**` plus `website/` surfaces when their contract changes.

---

## Contributing

Coming soon

---

MIT License · [npm](https://npmjs.com/package/paqad-ai) · [Docs](https://paqad.ai) · [Maintainer Overview](./docs/maintainers/project-overview.md) · [Modules](./docs/modules/README.md)
