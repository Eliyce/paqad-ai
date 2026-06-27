<div align="center">

```
██████╗  █████╗  ██████╗  █████╗ ██████╗
██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗
██████╔╝███████║██║   ██║███████║██║  ██║
██╔═══╝ ██╔══██║██║▄▄ ██║██╔══██║██║  ██║
██║     ██║  ██║╚██████╔╝██║  ██║██████╔╝
╚═╝     ╚═╝  ╚═╝ ╚══▀▀═╝ ╚═╝  ╚═╝╚═════╝
```

### Don't trust the prompt. Trust the workflow.

**The open-source, spec-driven framework for AI coding agents that have to be right, not just fast.**

[![npm version](https://img.shields.io/npm/v/paqad-ai.svg?style=flat-square)](https://www.npmjs.com/package/paqad-ai)
[![npm downloads](https://img.shields.io/npm/dm/paqad-ai.svg?style=flat-square)](https://www.npmjs.com/package/paqad-ai)
[![CI](https://img.shields.io/github/actions/workflow/status/Eliyce/paqad-ai/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Eliyce/paqad-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/paqad-ai.svg?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/node/v/paqad-ai.svg?style=flat-square)](https://nodejs.org)
[![website](https://img.shields.io/badge/website-paqad.ai-0A7A5C?style=flat-square)](https://paqad.ai)

Works with Claude Code, Cursor, GitHub Copilot, Gemini, Codex, Windsurf, Junie, Continue, Antigravity, and Aider.

</div>

---

A prompt is the most error-prone part of AI development. paqad-ai replaces "hope the prompt works" with something a team can stand behind. Your specs, rules, and workflows become version-controlled context that every AI agent has to follow, and every change is proven by automatic checks instead of by another AI guessing. One command sets up all your agents at once, and the whole thing runs on your machine, so your code never has to leave the building.

## Install in 30 seconds

```bash
npm install -g paqad-ai
cd your-project
paqad-ai onboard
```

paqad-ai reads your lockfiles, detects your stack, asks you to confirm, then sets everything up:

```text
✓ Detected:  laravel + react (inertia, tailwind, pest, docker)
✓ Generated: CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules, copilot-instructions, .windsurfrules
✓ Generated: docs/instructions/rules/* and stack-specific tool guides
✓ Wrote:     .paqad/project-profile.yaml, onboarding-manifest.json, detection-report.json
✓ Configured: entry files and MCP settings for every tool you picked

Ready. Your AI agents now understand your project, and your rules.
```

No account, no API key, no subscription. Prefer not to install anything? Run `npx paqad-ai onboard`.

## What you get, at a glance

| Area                         | What it means for you                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- |
| **One setup, every tool**    | Configure Claude, Cursor, Copilot, Gemini, and the rest from one source of truth |
| **Workflows, not prompts**   | Your team's process runs the same way every time, instead of being re-typed      |
| **Proof, not promises**      | Automatic checks confirm tests, specs, docs, and security before "done" counts   |
| **Security as a workflow**   | A full OWASP pentest pass, with retests, built in                                |
| **Design as a workflow**     | Your UI audited against your own design system                                   |
| **Docs that stay current**   | The framework keeps your documentation in sync with the code                     |
| **Fewer tokens, on purpose** | Loads the right files, not the whole repo, cutting token use by 60-85%           |
| **Runs locally**             | Your code stays on your machine, with an audit trail you can keep                |

The rest of this page walks through each of these. The [full docs](https://paqad.ai/docs.html) go deeper on every command and concept.

---

## The problem it solves

AI writes the code now. The hard part moved: it is no longer typing the code, it is trusting it.

Here is the difference paqad-ai makes on the same request.

| Without paqad-ai                                                   | With paqad-ai                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| ❌ Guesses your folder structure and puts files in the wrong place | ✅ Knows your stack, layout, and conventions before it writes a line         |
| ❌ Rebuilds a component that already exists                        | ✅ Finds the existing component and extends it                               |
| ❌ Writes code that quietly breaks tests it never ran              | ✅ Writes the failing test first, then makes it pass without breaking others |
| ❌ Forgets everything when you come back tomorrow                  | ✅ Picks up from a structured handoff of decisions and next steps            |
| ❌ Burns tokens re-reading the same files every turn               | ✅ Loads only what the task needs                                            |
| ❌ Tells you it is "done" when it is not                           | ✅ Cannot mark work done until the checks actually pass                      |

This is not a model problem you can wait out. The research is consistent:

- **84%** of developers use AI tools, but more now distrust their accuracy (**46%**) than trust it (**33%**), and the single biggest frustration, named by **66%**, is "AI solutions that are almost right, but not quite." <sup>[1]</sup>
- **81%** of developers say they spend more time reviewing code since adopting AI. The work did not vanish, it moved to review. <sup>[2]</sup>
- About **1 in 5** packages an AI recommends do not exist, a hallucination so reliable it created a new supply-chain attack. <sup>[3]</sup>
- **45%** of AI-generated code ships with a known security flaw, and bigger models are not measurably safer. <sup>[4]</sup>
- Every frontier model gets worse as you cram more into its context window, so dumping your whole repo into the prompt makes answers worse, not better. <sup>[5]</sup>

An agent driven by an ad-hoc prompt has no spec to meet, no rules it must follow, and no check that can tell "done" from "looks done." paqad-ai adds all three.

> Spec Kit and Kiro tell the agent **what** to build.
> paqad-ai makes it **prove it actually did**, with automatic checks, on your machine, across every agent you use.

---

## How it works

Three steps turn AI coding from a prompt you hope works into a pipeline you can trust.

```
   You ask for something
   "Add product search that filters by name and category"
            │
            ▼
   ┌─────────────────────────────────────────────┐
   │ 1. CODIFY                                     │   Your stack, rules, and spec become
   │    stack  ·  rules  ·  spec                   │   context every agent reads. Written once,
   └─────────────────────────────────────────────┘   reused everywhere.
            │
            ▼
   ┌─────────────────────────────────────────────┐
   │ 2. FOLLOW                                     │   The agent runs your workflow, not an
   │    route  →  plan  →  test  →  build          │   improvised prompt. Same process,
   └─────────────────────────────────────────────┘   every time.
            │
            ▼
   ┌─────────────────────────────────────────────┐
   │ 3. PROVE                                      │   Automatic checks confirm the work.
   │    ✓ tests   ✓ spec met   ✓ docs in sync     │   Code, not another AI. Nothing ships
   │    ✓ security  ✓ quality  ✓ no regressions   │   until they pass.
   └─────────────────────────────────────────────┘
            │
            ▼
        Done, and proven
```

| Step       | What happens                                                                              | Why it matters                                              |
| ---------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Codify** | Your stack, conventions, rules, specs, and workflows become version-controlled context.   | One source of truth, owned by the team and reviewed in PRs. |
| **Follow** | Agents run your workflows and rules the same way every time, instead of guessing.         | Represent a workflow once, and every agent follows it.      |
| **Prove**  | Automatic checks confirm tests, spec coverage, docs, security, and quality before "done." | "Done" means proven, not claimed.                           |

---

## Set up every agent once

Run `paqad-ai onboard` one time. It writes a thin, native config file for each tool you use, and they all point at the same shared instruction bundle. Change a rule in one place, and every agent sees it. Switch tools next month without losing anything.

| Tool                   | What it creates                                          |
| ---------------------- | -------------------------------------------------------- |
| **Claude Code**        | `CLAUDE.md` and MCP config                               |
| **Codex CLI**          | `AGENTS.md` and MCP config                               |
| **Google Antigravity** | `ANTIGRAVITY.md` and MCP config                          |
| **Gemini CLI**         | `GEMINI.md` and MCP config                               |
| **Junie**              | `.junie/AGENTS.md` and `.junie/mcp/mcp.json`             |
| **Cursor**             | `.cursor/rules/paqad.mdc` plus MCP, skills, agents       |
| **GitHub Copilot**     | `.github/copilot-instructions.md` and `.vscode/mcp.json` |
| **Windsurf**           | `.windsurfrules` plus MCP, skills, agents                |
| **Continue**           | `.continue/rules/paqad.md` plus MCP, prompts             |
| **Aider**              | `CONVENTIONS.md`                                         |

Pick one or pick all. Onboarding is multi-select.

## Run your workflows, not prompts

This is the core idea: the prompt is the unreliable part, so paqad-ai does not rely on it. Your team writes its process down as plain workflows and rules, and the framework runs them the same way every time.

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

Steps can run in order or in parallel, branch on complexity and risk, handle failure (abort, skip, or retry), and resume where they left off after a restart.

<details>
<summary><b>How a request flows through the framework</b></summary>

<br>

A built-in router reads each request, judges its complexity and risk, and sends it down the right track so simple work stays simple:

- **fast** lane for questions and small, low-risk fixes
- **graduated** lane for everyday features
- **full** lane for risky or wide-reaching changes, with a frozen spec and story breakdown first

Along the way it coordinates **20 built-in specialist roles**, each with one job and no conflicting incentives:

| Group             | Roles                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow (11)** | router, requirement-analyst, story-designer, test-planner, product-owner, verifier, gap-detector, adversarial-reviewer, context-curator, final-reviewer, market-researcher |
| **Coding (8)**    | solution-architect, database-expert, devops-engineer, doc-maintainer, integration-architect, performance-analyst, ux-ui-analyst, data-modeler                              |
| **Security (1)**  | security-auditor                                                                                                                                                           |

The requirement-analyst never writes code, the verifier never reviews, and the reviewer never implements. Keeping the roles separate is what keeps the output honest.

</details>

## Prove the work is done

Any agent will happily tell you it finished. paqad-ai checks reality instead, using code rather than another AI that can be talked into a "yes."

- **Spec coverage you can see.** A structured spec becomes a checklist of everything it promised. A plain scan then reads your test files for the matching evidence and reports exactly which acceptance criteria are actually proven, and which are not. An agent cannot claim a feature is tested when no test exists for it.
- **Gates that block bad changes.** Lint, types, tests, build, and rule checks run in order. Any failure stops the change and records what broke, where, and why.
- **Traceability both ways.** Every promise in the spec maps to the code and test that satisfy it, flagging untested promises and leftover code that nothing asked for.
- **Reproduce before you fix.** A bug has to be reproduced, fixed, proven fixed, and proven to break nothing else.
- **Mutation testing on changed code,** because a test that cannot catch a mistake is not really a test.
- **Flaky tests get quarantined, never deleted.** A suspected-flaky failure is re-run and held aside until it is fixed, so a green check actually means green.
- **A quality floor that only goes up.** Four measures (tangle, dead code, risky patterns, strictness) are pinned at today's level and can improve but never quietly slip.

<details>
<summary><b>Catch hallucinated rules without spending a token</b></summary>

<br>

paqad-ai can turn the plain rules in your `docs/instructions/rules/` into small validation scripts that run in a sandbox with no AI in the loop. They check the actual files and block a change when a rule is broken. Because there is no model involved, they are fast, free, and immune to the very hallucination they guard against.

</details>

## Security and design, as full workflows

Most tools treat security as a separate scanner you remember to run. paqad-ai treats it as part of the work.

**Security workflow.** A resumable pentest pass with full OWASP coverage, timed to the moment the industry is formalizing security for AI agents.

| Standard                    | Coverage         |
| --------------------------- | ---------------- |
| **OWASP Top 10 2025**       | A01 to A10 ✅    |
| **OWASP API Security 2023** | API1 to API10 ✅ |

It writes a local `curl` playbook to prove each finding (it never runs attacks for you), gives each finding a stable ID so it survives retests, scans only changed files after the first run, and replays findings later as fixed, still-open, or needs another look.

<details>
<summary><b>The 12 security checks</b></summary>

<br>

| Check                       | What it looks for                                                              |
| --------------------------- | ------------------------------------------------------------------------------ |
| dependency-advisory-triage  | Typosquatting, dependency confusion, abandoned and risky packages              |
| permission-boundary-review  | Broken object and function-level access, mass assignment                       |
| business-logic-abuse-review | Race conditions, workflow bypass, financial manipulation                       |
| runtime-surface-probing     | Headers, CORS, error leaks, open redirects, SSRF, TLS                          |
| stride-threat-model         | A structured STRIDE pass per module and surface                                |
| input-validation-review     | SSRF, IDOR, SQL and command injection, file upload, prototype pollution, ReDoS |
| auth-mechanism-review       | JWT flaws, session fixation, OAuth and OIDC issues, brute force, MFA bypass    |
| cryptographic-review        | Encryption at rest and in transit, key management, password hashing            |
| logging-monitoring-review   | Missing audit trails, log injection, gaps in alerting                          |
| rate-limiting-review        | Missing throttling and denial-of-service surfaces                              |
| finding-normalizer          | Stable finding IDs that hold across retests                                    |
| retest-verification         | Replays old findings against fresh evidence                                    |

</details>

**Design workflow.** The same rigor, pointed at the front end. The design-test pass audits your UI against your own design system, covering tokens, components, accessibility, responsive behavior, and motion, and design-retest replays the findings after you fix them. Pentest checks that the code is safe. Design-test checks that the interface is consistent.

## Documentation that stays current

Documentation is a real output here, not an afterthought you maintain by hand. Ask any connected agent to `create documentation` and the workflow re-reads your live stack, syncs anything that drifted, and writes stack, architecture, design-system, and per-feature docs. A differential refresh updates only what changed. When the code and the docs disagree, the framework treats that as a defect to fix. The result is documentation a new teammate, or a new agent, can actually rely on.

## The right context, with fewer tokens

Your agent does not need your whole repo. It needs the right files. And since every model gets worse on a bloated context, loading less is not just cheaper, it makes the answers better. paqad-ai cuts token use by **60-85%** through careful context loading.

- It splits files at natural boundaries (functions and classes), not at arbitrary line counts.
- It ranks each piece by five signals: meaning, keywords, the symbols involved, how close the file is to the task, and how deeply nested it is.
- It fills a token budget in tiers, evicts the least useful context first, and collapses duplicate material to a single reference.
- It compresses old conversation turns into a short, structured summary using plain pattern-matching, with no extra AI call to pay for.
- It tidies noisy test output into a compact result, so a huge test log does not flood the agent's context, and the checks read the clean version.

<details>
<summary><b>Optional hybrid retrieval (RAG)</b></summary>

<br>

Retrieval is an accelerator on top of the normal grep-and-read default, never a replacement. When you turn it on, paqad-ai builds a local search index over your code and docs and feeds the relevant slices into the prompt for you.

- It complements coding and never blocks it. The index is kept fresh in a background worker, so the prompt only ever reads a precomputed bundle. When retrieval is off, cold, or unsure, you fall back to exactly today's grep-and-read behavior.
- It sends slices, not whole files. Retrieval is scoped to your docs and module map first (the safest, highest-value content), capped to a handful of slices, and each one is marked as a hint to verify against the live file.
- Embeddings run locally by default. You can switch to OpenAI or Voyage if you prefer.
- Built-in evals decide whether it ships. An on/off comparison tracks hit rate, task success, correction turns, and tokens sent, and blocks any change that drops quality or spends tokens it does not earn back.

Run `paqad-ai rag init --provider local` to start. It stays off until you turn it on.

</details>

## Built for teams and enterprises

Everything above adds up to what a serious team needs before it lets AI near its pipeline.

- **It runs on your machine.** Analysis happens locally, embeddings default to a local model, and any remote keys you opt into live in a locked-down file and are scrubbed from logs. Your source never has to leave the building.
- **No vendor lock-in.** Ten agent platforms from one source of truth. Move between them whenever you want.
- **A real audit trail.** An append-only log, structured logging that redacts secrets, and decision records: architectural choices pause for a human and are saved with the reason and a timestamp, never decided silently.
- **Reproducible by design.** Onboarding is idempotent, detection reads lockfiles first, artifacts are schema-versioned, and drift tracking tells you when reality has moved away from what you onboarded.
- **A quality bar enforced by code,** not by good intentions, including the quality ratchet and a strict test-coverage standard.

## See what your AI sees

```bash
paqad-ai dashboard    # the management surface: health, approvals, trust, the Graph area, and web editors for everything you own
paqad-ai status       # the same report as JSON or Markdown, for an agent to read
```

The **Graph** area inside the dashboard is an interactive map of modules, files, symbols, imports, and similarity. It lives behind the same left rail as every other area.

One command, nothing extra to install. The server, the interface, and the layout engine all ship inside `paqad-ai`, run on loopback only, and send no telemetry.

---

## How it compares

paqad-ai sits in a space the others only touch the edges of: proof you can run locally, across every agent, driven by your own spec.

| Tool                | What it is                          | What it leaves to you                                |
| ------------------- | ----------------------------------- | ---------------------------------------------------- |
| **GitHub Spec Kit** | Write the spec before you build     | No check that the agent actually built it            |
| **AWS Kiro**        | Spec-driven, inside one IDE         | Tied to its own editor, not local or multi-tool      |
| **Tessl**           | A cloud spec registry               | Cloud-leaning, not a check on your own code          |
| **Cursor rules**    | Context for one editor              | Rules inform, they never verify                      |
| **Continue.dev**    | Checks as code, in CI               | AI-judged checks, no spec or security workflow       |
| **Qodo**            | AI review of pull requests          | Reviews at the end, does not set the agent up        |
| **paqad-ai**        | Spec, workflows, and proof, locally | ✅ Brings all of the above together, on your machine |

The short version: most tools tell the agent what to build, or review it after the fact. paqad-ai makes the agent follow your process and prove the result, before anything ships.

## Works with your stack

paqad-ai does not ask what you use. It reads your repo across nine ecosystems and figures it out, trusting your lockfiles first.

**Frameworks:** `laravel` `react` `vue` `flutter` `django` `fastapi` `rails` `spring-boot` `express` `angular` `svelte` `astro` `go-web` `rust-web` `dotnet` `nextjs` `flask` `nestjs` `kotlin-android`

**Plain Node projects:** `node-cli` `node-library` `node-service`

<details>
<summary><b>What it reads, by ecosystem</b></summary>

<br>

| Ecosystem  | Manifests and lockfiles                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| **Node**   | `package.json`, `package-lock.json`, `pnpm-lock.yaml`                                     |
| **PHP**    | `composer.json`, `composer.lock`                                                          |
| **Python** | `requirements.txt`, `pyproject.toml`, `Pipfile`, `Pipfile.lock`, `poetry.lock`, `uv.lock` |
| **Ruby**   | `Gemfile`, `Gemfile.lock`                                                                 |
| **JVM**    | `build.gradle`, `build.gradle.kts`, `pom.xml`, `gradle.lockfile`                          |
| **Go**     | `go.mod`, `go.sum`                                                                        |
| **Rust**   | `Cargo.toml`, `Cargo.lock`                                                                |
| **Dart**   | `pubspec.yaml`, `pubspec.lock`                                                            |

Each stack is a plain `pack.yaml` that drives detection, docs, MCP config, and security mappings. Don't see your framework? You can [write your own pack](./docs/modules/packs/features/authoring/technical.md).

</details>

## Commands

`onboard` is the one you start with. The rest keep the project honest over time. Full reference at [paqad.ai/docs.html](https://paqad.ai/docs.html).

| Command                 | What it does                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `paqad-ai onboard`      | Detect the stack, confirm, then generate the agent configs, rules, docs, and MCP          |
| `paqad-ai doctor`       | Check that everything paqad-ai manages is present and valid                               |
| `paqad-ai compliance`   | Pull obligations from a spec and check which ones the tests actually prove                |
| `paqad-ai refresh`      | Re-detect the stack and regenerate the derived docs                                       |
| `paqad-ai update`       | Regenerate framework-managed files after a version change                                 |
| `paqad-ai capabilities` | Turn `content`, `coding`, and `security` on or off                                        |
| `paqad-ai packs`        | List, install, validate, and scaffold stack packs                                         |
| `paqad-ai rag`          | Build, inspect, clear, and benchmark the optional search index                            |
| `paqad-ai dashboard`    | Open the management surface: pulse, approvals, trust, the Graph area, and the web editors |
| `paqad-ai status`       | Print the same health report for an agent to read                                         |
| `paqad-ai patterns`     | Query, prune, and export the reusable pattern library                                     |

```bash
# a few common runs
paqad-ai onboard --stack laravel --capability react tailwind --providers claude-code cursor copilot
paqad-ai onboard --providers github-copilot     # just one tool
paqad-ai compliance check                        # which promises are actually tested?
paqad-ai rag init --provider local               # free, on-device search
paqad-ai doctor                                  # exits 1 on failure, 0 on pass
```

## What paqad-ai creates

```text
your-project/
├── CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules, copilot-instructions, ...
│       thin config files, one per tool you picked, all pointing at the same knowledge
│
├── docs/
│   ├── instructions/
│   │   ├── rules/        your conventions and writing rules (the source for rules-as-scripts)
│   │   ├── stack/        generated stack docs: overview, frameworks, dependencies, drift, ...
│   │   ├── tools/        stack-specific tool guides
│   │   └── workflows/    your own resumable workflow templates
│   ├── modules/          per-feature docs kept in sync with the code
│   └── pentest/          security workflow output
│
└── .paqad/               framework metadata, machine-managed
    ├── project-profile.yaml   project facts: stack, commands, capabilities
    ├── .config.example        every framework knob, commented; copy lines into .config (git-ignored) to override
    ├── stack-snapshot.json, stack-drift.json, onboarding-manifest.json
    ├── compliance/        spec obligations
    ├── decisions/         human decision records
    ├── audit.log          append-only event log
    ├── vectors/           optional search index, with opt-in keys kept in a locked file
    └── session/, context/, cache/, workflows/
```

The config files stay short. The real knowledge lives in shared bundles that every tool and every built-in role reads the same way.

---

## Requirements

| Requirement | Version                       |
| ----------- | ----------------------------- |
| **Node.js** | `>= 22` (pinned via `.nvmrc`) |
| **pnpm**    | `10+` for local development   |

## Development

```bash
pnpm install
pnpm run format     # run before you finish
pnpm run ci         # typecheck, lint, format check, test at 100% coverage, build
```

Every change keeps 100% line, statement, function, and branch coverage, adds tests for the flows it touches, and updates the matching docs and website surfaces when a contract changes.

## Contributing

Issues and pull requests are welcome. The [release workflow](./docs/RELEASE-WORKFLOW.md) explains how changes ship: branch, open a PR, add a changeset, squash-merge, and the release is published automatically.

## Sources

The statistics in "The problem it solves" come from outside research, linked here so you can check them.

1. Stack Overflow 2025 Developer Survey, AI section, about 49,000 respondents: https://survey.stackoverflow.co/2025/ai
2. Harness 2026 State of Engineering Excellence, via ITPro, May 2026: https://www.itpro.com/software/development/ai-might-help-speed-up-software-development-but-81-percent-of-devs-now-spend-more-time-reviewing-code-and-its-creating-an-invisible-work-trend-thats-pushing-teams-to-the-limit
3. Package-hallucination study, USENIX Security 2025: https://www.usenix.org/system/files/conference/usenixsecurity25/sec25cycle1-prepub-742-spracklen.pdf
4. Veracode 2025 GenAI Code Security Report: https://www.veracode.com/resources/analyst-reports/2025-genai-code-security-report/
5. Chroma Research, "Context Rot," across 18 frontier models: https://www.trychroma.com/research/context-rot

---

<div align="center">

MIT License · [npm](https://npmjs.com/package/paqad-ai) · [Website](https://paqad.ai) · [Docs](https://paqad.ai/docs.html) · Built by [Eliyce](https://eliyce.com)

</div>
