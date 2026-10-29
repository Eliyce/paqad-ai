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

Works with Claude Code, Cursor, GitHub Copilot, Gemini, Codex, Windsurf, Junie, Continue, Antigravity, Aider, and JetBrains AI Assistant.

Built by [Eliyce](https://eliyce.com)

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

## Install in Claude Code (plugin)

Inside Claude Code you can install paqad as a plugin, with no npm package and no separate setup:

```text
/plugin marketplace add Eliyce/paqad-claude-plugin
/plugin install paqad@eliyce
```

Then use it:

- `/paqad:onboard` if you are setting the project up for your team (the lead).
- `/paqad:join` if the project is already onboarded and you are setting up your own machine.

<details>
<summary>All the skills in the plugin</summary>

- For developers: `/paqad:onboard`, `/paqad:join`, `/paqad:dashboard`.
- For product owners (these also work in claude.ai chat and Cowork): `/paqad:start` is the one
  place to begin. It routes to `/paqad:ask`, `/paqad:discover`, `/paqad:refine-ticket`,
  `/paqad:size-work` and `/paqad:plan-sprint`. The idea journey uses the step skills
  `/paqad:get-connected`, `/paqad:understand-idea`, `/paqad:ground-in-project`,
  `/paqad:shape-idea`, `/paqad:decide-together`, `/paqad:write-tickets`, `/paqad:check-tickets`
  and `/paqad:post-tickets` on its own.

The product owner skills ship only in the plugin, not in the npm package.

</details>

A few things worth knowing:

- This is Claude Code only. If you also use Codex, Gemini, Cursor, or another tool on the same project, keep the npm package (`npm install -g paqad-ai`) so those tools stay wired. Removing npm is fine when Claude Code is the only tool you use here. When both are installed, only one of them runs its hooks in a session, so nothing runs twice.
- The plugin keeps itself current. Claude Code updates it through `/plugin`, so you do not run an update command by hand.
- Onboarding from the plugin writes no paqad hooks into the project's `.claude/settings.json`, because the plugin brings its own. The plugin keeps a copy of itself in its data folder (`~/.claude/plugins/data/paqad-eliyce/runtime`) and points `~/.paqad-ai/current` there, so the framework link keeps working when Claude Code cleans up an old plugin version.
- The optional RAG engine installs on first use, in the background, only if you turn RAG on. If you turn RAG on during `/paqad:onboard`, RAG stays on, onboarding says "search index is installing in the background; text search until it is ready", and the index is built once the engine is in. Until then search falls back to plain text, and `paqad-ai doctor` shows `not ready: installing`. If the index cannot be built for another reason, onboarding turns RAG off and tells you why. To remove the engine later, delete `~/.paqad/` (the shared model and engine cache).
- To open the dashboard, run `paqad-ai dashboard` from a terminal in the project. The plugin puts `paqad-ai` on your shell path inside a Claude Code session.
- The plugin shows where the change stands in a band above the prompt. To hide it, set `hud_view=false` in `.paqad/.config` (just you) or in `.paqad/configs/.config.app` (the team), or set `PAQAD_HUD_VIEW=false`. Its pane has tabs for the High Table, Cost, Trust, Ships and Record, and `/paqad receipt` draws the receipt as a card. For a short chime when the verdict lands, set `hud_chime=true` (or `PAQAD_HUD_CHIME=true`); it is off by default and never speaks.
- **Already on the npm setup?** paqad can move you to the plugin automatically in the background, with nothing to do on your side. The npm package stays installed as a fallback, so paqad is never off at any point. It is off by default today; `plugin_migration=on` or `claude_install_mode=plugin` turns it on, `paqad-ai plugin rollback` moves a machine back to the npm setup and removes the plugin, and `claude_install_mode=settings` in your team config keeps a project on npm.
  - paqad checks your organization's managed policy first. If it blocks the plugin or paqad's hooks, paqad stays on npm and writes nothing.
  - If the Desktop app already synced the plugin from claude.ai, the move is simply marked done. If the plugin is already installed some other way, paqad turns it on in your own Claude settings and then waits for it to run, like any other install.
  - When `claude` is on your path, paqad runs `claude plugin marketplace add Eliyce/paqad-claude-plugin` and `claude plugin install paqad@eliyce --scope user`, then checks that Claude Code recorded the plugin. With no `claude` on your path, it runs the same two commands with the `claude` that ships inside the Claude Desktop app (`~/Library/Application Support/Claude/claude-code/<version>/` on macOS, `%APPDATA%\Claude\claude-code\<version>\` on Windows). If neither is there, or the install fails, paqad stays on npm, records why, and tries again a day later. It never edits a project file.
  - paqad then watches your next Claude Code sessions. Once the plugin runs, the move is done. A session only counts once Claude Code has installed the plugin, because the Desktop app can take a few starts to do that. Until then paqad waits, and if the plugin is still not installed 7 days later it undoes the move and tries again later. After the install, three sessions with no sign of the plugin also undo the move, and paqad tries again a day later, up to five attempts.
  - If you turn the plugin off in your Claude settings, paqad records that you declined it and never turns it back on.
  - `paqad-ai plugin rollback` removes the plugin with `claude` on your path, or with the Desktop app's `claude`. If neither can run, it turns the plugin off and tells you the one command to remove it.
  - `paqad-ai doctor` shows where the move stands, including when it is still waiting for Claude Code to install the plugin, and `~/.paqad-ai/logs/plugin-migration.log` has the details. If a settings file still wires the npm hooks, doctor names it: your own `~/.claude/settings.json` (or the one in `CLAUDE_CONFIG_DIR` when that is set), the project's `.claude/settings.json`, or both. That project keeps running the npm hooks while the plugin stays quiet.
- **Organizations (Team or Enterprise):** add the `paqad` plugin in Organization settings > Plugins & skills and set it to Installed by default or Required. Members then do nothing and nothing on their machine is edited by paqad.
  - The Claude Desktop app picks up a plugin added on claude.ai, but a `claude` session in a terminal does not load plugins uploaded to claude.ai. Terminal users install it themselves with the two `/plugin` commands above, or IT deploys it as a managed plugin.
  - The plugin and its `eliyce` marketplace live together in the public repo `Eliyce/paqad-claude-plugin`. You never edit that repo: every npm release builds the plugin here, writes its marketplace file, and pushes it there with a `v<version>` tag, but only after npm publish succeeds. When nothing in the plugin changed, it pushes no new commit. The release job needs the repository secret `PAQAD_PLUGIN_PUSH_TOKEN`, a token that can push to `Eliyce/paqad-claude-plugin`. Without it, or when the push fails, the release job fails, so a missing plugin release never goes unnoticed. To see what would be pushed, run `pnpm build && node scripts/assemble-plugin.mjs <folder>`.

## What paqad runs, writes and sends

paqad runs on your machine. There's no paqad account, no paqad server, and no telemetry.

**What it runs.** Node scripts inside the plugin, as Claude Code hooks: at session start, when you send a prompt, before Edit, Write and NotebookEdit, when Claude stops, and when a subagent stops. Some of them block an edit on purpose:

- before paqad has loaded in the session
- before planning on a feature change, and before the spec when the change needs one
- while a decision is waiting for you
- inside a closed evidence folder

When a gate hits an unexpected error, it blocks the edit instead of letting it through. Turn paqad off for a project with `paqad_enable=false` in `.paqad/.config`, or everywhere with the `PAQAD_DISABLED=1` environment variable.

**What it writes.** Files under `.paqad/` in your project (settings, rules, the evidence record and logs), plus `docs/instructions/` when you onboard. It also uses the plugin's own data folder under `~/.claude/plugins/data/` for the optional search engine.

**What it sends.** Nothing from your project leaves your machine unless you turn on one of the services in the last three rows of this table:

| Destination                 | When                                                                                                                                                                     | What is sent                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `registry.npmjs.org`        | In the background, the first time paqad needs its optional search engine (when you turn on RAG, or a feature that uses it runs), retried at most once a day if it failed | A normal npm install of `@huggingface/transformers` and `openai` into the plugin's data folder |
| `huggingface.co`            | The first time local search or local reranking runs                                                                                                                      | Requests for the model files. Nothing from your project                                        |
| `raw.githubusercontent.com` | When indexing a Laravel project                                                                                                                                          | A request for Laravel's public upgrade guide. Nothing from your project                        |
| `api.osv.dev`               | When you run a codebase health check or a pentest workflow                                                                                                               | Package names and versions from your lockfiles                                                 |
| `api.openai.com`            | Only if you set `rag_embedding_provider=openai`                                                                                                                          | The doc and code passages being indexed, with your OpenAI key                                  |
| `api.cohere.com`            | Only if you turn on reranking with the `cohere` backend                                                                                                                  | Your search query and the candidate passages, with your Cohere key                             |

**API keys.** The OpenAI and Cohere keys in the last two rows are optional. In Claude Code, set them as the plugin's options; they go to your system's secure credential store and reach paqad's hooks as environment variables. paqad uses the first key it finds, in this order: the key saved in the plugin options, then the environment variable (`OPENAI_API_KEY` or `COHERE_API_KEY`), then the project file (`.paqad/secrets.env` for OpenAI, created with mode 600 and ignored by git, and your paqad config for Cohere). A plugin option left empty counts as not set. With the npm package there are no plugin options, so paqad reads the environment and the project file exactly as before. Plugin options reach paqad's hooks, not the commands Claude runs in its shell, so a command such as `paqad-ai spec pipeline start` run there reads the environment or the project file. paqad sends a key only to the service it belongs to.

The dashboard and graph views run on `127.0.0.1` only.

### What the HUD does (Claude Code)

The HUD is a Claude Code mod that ships inside the plugin. It only draws and asks; paqad's hooks do the enforcing, and they keep working when the HUD is off.

- **Reads:** this project's `.paqad/` files (the session status, the evidence snapshot, pending decisions and the last rule stop), the environment variables `PAQAD_DISABLED`, `PAQAD_ENABLE`, `PAQAD_HUD_VIEW`, `PAQAD_HUD_CHIME` and `CLAUDE_CODE_REMOTE`, the session's tool calls, so it can show which stage is running, and the session's agent list (`$.agent.list()`) with the rows and tool calls of its subagents, so it can show which subagent runs, a one-line summary of what it is doing and how many finished. None of that is stored or sent anywhere.
- **Writes:** two files in `.paqad/session/hud/`: `<session>.live`, a heartbeat (written when you send a prompt and once a minute) that tells paqad the HUD is open, and a mark in `<session>.last-block.json` when you answer a rule stop. No other files, nothing outside `.paqad/`, and never a build, settings, start-up or instructions file. In Claude Code's own mod store it keeps three view preferences: whether the band is minimised, whether you hid it for a project, and which changes already opened the ledger pane.
- **Runs:** two programs, both paqad's own command from this plugin, and each run times out after 15 seconds.
  - When a rule stops an edit, only after you choose **Allow once, recorded**: `paqad-ai rules override --rule <id> --file <path> --token <one-time token> --tool-use-id <id> --session <id> --project-root <path>`, plus `--reason=<your words>` if you typed a reason. It adds one line to the change's `rule-overrides.jsonl` evidence file and contacts no network host. After the edit runs again, it runs the same command once more with `--outcome landed` or `--outcome still-blocked` and the same rule, file, tool call, session and project, which adds a second line saying whether the edit went through.
  - `paqad-ai delivery-link refresh --session <id> --project-root <path> --min-age-seconds <n>`, only while an open pull request's CI is pending, so the delivery rail can mark Push and CI after the turn ends. It checks every 30 seconds, for at most 60 minutes, one run at a time, and again after a `git push` from this session or when the pull request gets a newer head. It stops when CI passes or fails, the pull request is closed or merged, `gh` fails twice in a row (signed out or offline), the HUD closes, or paqad is off. It runs `git` and your own `gh` login, which contacts GitHub to read the pull request and its checks; it never pushes, comments or re-runs CI, and writes only the push, pull request and CI reading in the change's `delivery.json`. It is always on, with no setting.
- **Sends:** nothing of its own. The only network contact is the `gh` read above, made by your `gh` with your login. The chime (off unless you set `hud_chime=true`) is a short sound built into the plugin as bytes, not fetched from anywhere.
- **Commands:** `/paqad`, or `/paqad-hud` when another plugin already owns `/paqad`. It answers from this session's record (`/paqad help` lists the subcommands) and only changes the HUD's own view: `show` and `hide` bring the band back or hide it. It edits nothing in your project.
- **Its hooks on your edits:**
  - When one of paqad's rules stops an Edit, Write or NotebookEdit, the HUD asks you what should happen. If you allow it once, paqad records the override and runs the same edit again. paqad's own gate then asks Claude Code to show you its permission dialog for that one edit, and you approve it there. The HUD never approves an edit and never changes a permission answer. A deny from your settings rules, from another tool's hook or from a stop your organization enforces still blocks the edit. If anything fails, the edit stays blocked.

### Try it in 2 minutes

1. Install the plugin, then open Claude Code in any project with a git repository (a new folder after `git init` works too).
2. Run `/paqad:onboard` and accept the suggested setup. paqad does nothing in a project until it's onboarded.
3. Ask Claude one of these:
   - "Add a CSV export button to the orders list" (paqad plans it, writes the spec, then builds, checks and records evidence)
   - "Review the changes on this branch against our rules"
   - "Run a codebase health check and show me the top risks"

## Deploy for your organization

If you run Claude Code for a team, you can put paqad's edit-time rule block on every machine with one file that nobody on the machine can loosen. It uses Claude Code's managed settings, which IT pushes with the MDM tool you already use.

1. Turn on the team features (`enterprise=true` in `.paqad/.config`, or `PAQAD_ENTERPRISE=true`) and write the file:

   ```bash
   paqad-ai managed-settings --write ./managed
   ```

   This writes `./managed/paqad.json`. Run it without `--write` to print the file instead, and add `--no-plugin` if you install the paqad plugin some other way.

2. Install paqad-ai globally on every machine through MDM (`npm install -g paqad-ai`). Do this before the file goes out: the file calls `paqad-ai` on every edit.

3. Push `paqad.json` into the managed settings folder for each OS:

   | OS            | Folder                                                        |
   | ------------- | ------------------------------------------------------------- |
   | macOS         | `/Library/Application Support/ClaudeCode/managed-settings.d/` |
   | Linux and WSL | `/etc/claude-code/managed-settings.d/`                        |
   | Windows       | `C:\Program Files\ClaudeCode\managed-settings.d\`             |

4. Check it on one machine. Start `claude --debug` and look for the two `paqad-ai hook --managed` commands among the loaded hooks, then run `/status` inside Claude Code to see the managed settings it picked up.

<details>
<summary>What developers will notice</summary>

- In a repository that has no `.paqad/` folder, nothing happens. The hook checks for the folder, finds none, and steps aside before loading anything else.
- In a paqad project, the rule block runs before every edit, even if someone sets `PAQAD_DISABLED=1` or `paqad_enable=false` locally. A stop says "This rule is enforced by your organization's settings." and cannot be allowed once from the HUD.
- If `paqad-ai` is missing, broken, or takes longer than 30 seconds, the edit is blocked, not waved through. When paqad-ai itself cannot run its check, the message names the fix: "paqad-ai must be installed globally on this machine; ask IT to install it." If the command is not installed at all, the block shows the shell's "command not found" error instead, and the fix is the same.
- The file also turns on the `paqad` plugin from `Eliyce/paqad-claude-plugin`.

</details>

**Rolling back.** Delete `paqad.json` from the managed settings folder through MDM. Claude Code goes back to normal on its next start, and there is no paqad state to clean up.

## What you get, at a glance

| Area                         | What it means for you                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| **One setup, every tool**    | Configure Claude, Cursor, Copilot, Gemini, and the rest from one source of truth       |
| **Workflows, not prompts**   | Your team's process runs the same way every time, instead of being re-typed            |
| **Proof, not promises**      | Automatic checks confirm tests, specs, docs, and security before "done" counts         |
| **Security as a workflow**   | An OWASP WSTG-structured security self-review, with retests, built in                  |
| **Design as a workflow**     | Your UI audited against your own design system                                         |
| **Docs that stay current**   | The framework keeps your documentation in sync with the code                           |
| **Fewer tokens, on purpose** | Loads a lean resident slice, not the whole repo. Measured 49-61% smaller resident load |
| **Runs locally**             | Your code stays on your machine, with an audit trail you can keep                      |

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

When you turn the flags on, the spec itself can be produced by a pipeline: it grounds the request in your own docs, brings in the domain experts the request needs, asks one small batch of plain-language questions, and writes the spec with every line traced to where it came from.

---

## Set up every agent once

Run `paqad-ai onboard` one time. It writes a thin, native config file for each tool you use, and they all point at the same shared instruction bundle. Change a rule in one place, and every agent sees it. Switch tools next month without losing anything.

| Tool                       | What it creates                               |
| -------------------------- | --------------------------------------------- |
| **Claude Code**            | `CLAUDE.md`                                   |
| **Codex CLI**              | `AGENTS.md`                                   |
| **Google Antigravity**     | `ANTIGRAVITY.md`                              |
| **Gemini CLI**             | `GEMINI.md`                                   |
| **Junie**                  | `.junie/AGENTS.md`                            |
| **Cursor**                 | `.cursor/rules/paqad.mdc` plus skills, agents |
| **GitHub Copilot**         | `.github/copilot-instructions.md`             |
| **Windsurf**               | `.windsurfrules` plus skills, agents          |
| **Continue**               | `.continue/rules/paqad.md` plus prompts       |
| **Aider**                  | `CONVENTIONS.md`                              |
| **JetBrains AI Assistant** | `.aiassistant/rules/guidelines.md`            |

paqad never writes another tool's MCP config file, so the servers you set up stay yours. The MCP servers it suggests for your stack go in `.paqad/mcp-recommendations.json`.

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

Along the way it coordinates **22 built-in specialist roles**, each with one job and no conflicting incentives:

| Group            | Roles                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow (9)** | context-curator, product-owner, market-researcher, implementer, reviewer, verifier, test-planner, gap-detector, requirement-analyst                                                                            |
| **Coding (12)**  | solution-architect, application-architect, db-expert, ux-ui-analyst, devops-engineer, doc-maintainer, performance-analyst, data-modeler, integration-architect, qa-engineer, user-flow-writer, chief-architect |
| **Security (1)** | security-auditor                                                                                                                                                                                               |

Plus six personas the roles reuse: router, story-designer, final-reviewer, adversarial-reviewer, app-cartographer, journey-designer.

The requirement-analyst never writes code, the verifier never reviews, and the reviewer never implements. Keeping the roles separate is what keeps the output honest.

</details>

## Prove the work is done

Any agent will happily tell you it finished. paqad-ai checks reality instead, using code rather than another AI that can be talked into a "yes."

- **Spec coverage you can see.** A structured spec becomes a checklist of everything it promised. A plain scan then reads your test files for the matching evidence and reports exactly which acceptance criteria are actually proven, and which are not. An agent cannot claim a feature is tested when no test exists for it.
- **Gates that block bad changes.** Lint, types, tests, build, and rule checks run in order. Any failure stops the change and records what broke, where, and why.
- **Traceability both ways.** Every promise in the spec maps to the code and test that satisfy it, flagging untested promises and leftover code that nothing asked for.
- **Reproduce before you fix.** A bug has to be reproduced, fixed, proven fixed, and proven to break nothing else.
- **Mutation testing on changed code, if you turn it on,** because a test that cannot catch a mistake is not really a test. It is off by default. Set `mutation_mode` to `warn` or `strict` and call paqad's backstop from your own CI or pre-push hook: your test command runs first, then the mutation tool you install for your stack, and under `strict` a surviving mutant fails that step. No agent host runs it at the end of a turn: on Claude Code and Codex the end-of-turn check reads it as not required, Gemini records the turn without a mutation verdict in chat, and on the advisory hosts paqad claims no mutation enforcement.
- **Flaky tests get quarantined, never deleted.** A suspected-flaky failure is re-run and held aside until it is fixed, so a green check actually means green.
- **A quality floor that only goes up.** Four measures (tangle, dead code, risky patterns, strictness) are pinned at today's level and can improve but never quietly slip.

<details>
<summary><b>Catch hallucinated rules without spending a token</b></summary>

<br>

paqad-ai can turn the plain rules in your `docs/instructions/rules/` into small validation scripts that run in a sandbox with no AI in the loop. They check the actual files and block a change when a rule is broken. Because there is no model involved, they are fast, free, and immune to the very hallucination they guard against.

</details>

## Security and design, as full workflows

Most tools treat security as a separate scanner you remember to run. paqad-ai treats it as part of the work.

**Security workflow.** A resumable, OWASP WSTG-structured security self-review that hardens code before a certified pentest, timed to the moment the industry is formalizing security for AI agents.

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

**Design workflow.** The same rigor, pointed at the front end. The design-test pass audits your UI against your own design system, covering tokens, components, accessibility, responsive behavior, and motion, and design-retest replays the findings after you fix them. The security self-review hardens the code. Design-test checks that the interface is consistent.

## Documentation that stays current

Documentation is a real output here, not an afterthought you maintain by hand. Ask any connected agent to `create documentation` and the workflow re-reads your live stack, syncs anything that drifted, and writes stack, architecture, design-system, and per-feature docs. A differential refresh updates only what changed. When the code and the docs disagree, the framework treats that as a defect to fix. The result is documentation a new teammate, or a new agent, can actually rely on.

## The right context, with fewer tokens

Your agent does not need your whole repo. It needs the right files. And since every model gets worse on a bloated context, loading less is not just cheaper, it makes the answers better.

paqad-ai keeps the session-start load lean: a rule manifest plus the files a task actually touches, instead of the whole rule tree. Measured across two projects, that resident load is **49-61% smaller** than loading everything (paqad-ai's own repo: 61%; a fresh React onboard: 49%). Both used the char/4 heuristic tokenizer, so treat them as an honest floor, not a marketing ceiling. The method, the per-project numbers, and the caveats are in [`docs/instructions/benchmarks/measured.md`](docs/instructions/benchmarks/measured.md), and you can reproduce them in your own repo:

```
node scripts/measure-footprint.mjs --project .
```

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
- Embeddings run locally by default. You can switch to OpenAI if you prefer.
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

Each stack is a plain `pack.yaml` that drives detection, docs, MCP recommendations, and security mappings. Don't see your framework? You can [write your own pack](./docs/modules/packs/features/authoring/technical.md).

</details>

## Commands

`onboard` is the one you start with. The rest keep the project honest over time. Full reference at [paqad.ai/docs.html](https://paqad.ai/docs.html).

| Command                                  | What it does                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `paqad-ai onboard`                       | Detect the stack, confirm, then generate the agent configs, rules, docs, and MCP                  |
| `paqad-ai doctor`                        | Check that everything paqad-ai manages is present and valid                                       |
| `paqad-ai compliance`                    | Pull obligations from a spec and check which ones the tests actually prove                        |
| `paqad-ai refresh`                       | Re-detect the stack and regenerate the derived docs                                               |
| `paqad-ai update`                        | Regenerate framework-managed files after a version change                                         |
| `paqad-ai capabilities`                  | Turn `content`, `coding`, and `security` on or off                                                |
| `paqad-ai packs`                         | List, install, validate, and scaffold stack packs                                                 |
| `paqad-ai rag`                           | Build, inspect, clear, and benchmark the optional search index                                    |
| `paqad-ai dashboard`                     | Open the management surface: pulse, approvals, trust, the Graph area, and the web editors         |
| `paqad-ai status`                        | Print the same health report for an agent to read                                                 |
| `paqad-ai patterns`                      | Query, prune, and export the reusable pattern library                                             |
| `paqad-ai debt`                          | Record a problem the change will not fix as a tracked item, then list, promote, or close it       |
| `paqad-ai fix prove`                     | Record that a fix's test fails before the fix (`red`) and passes after it (`green`)               |
| `paqad-ai report speed`                  | Show where each change's time went: busy time, waiting for you, and the edit gate                 |
| `paqad-ai rules override`                | Record a person allowing one edit past a rule stop, once, with the reason                         |
| `paqad-ai delivery-link commit-decision` | Record how the "commit this change?" question was answered                                        |
| `paqad-ai delivery-link refresh`         | Read the push, pull request and CI of the branch change from git and gh (read-only toward GitHub) |
| `paqad-ai managed-settings`              | Print or write the managed settings file that puts paqad on every machine in your organization    |
| `paqad-ai hook`                          | Run one of paqad's edit gates; the managed settings file calls it                                 |

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

| Requirement | Version                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Node.js** | `>= 22` to install and run. Building from source needs 22.18 or later (24.11 or later on Node 24), pinned via `.nvmrc` |
| **pnpm**    | `10+` for local development                                                                                            |

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
