<!-- managed by paqad-ai — generated from src/onboarding/agent-bootstrap-writer.ts; regenerate with `pnpm vitest run agent-bootstrap-writer -u`. Do not edit by hand. -->

# Paqad Framework Bootstrap

This is the framework entry that every provider's lean entry file points to (it is reached by resolving `.paqad/framework-path.txt` to the paqad install directory and loading this file from there). It resolves ONE thing — whether paqad is enabled for this project — and, when it is, points you at the router. Work through it top to bottom before doing any repository work.

## 1. Enablement check — do this first

Decide whether paqad is enabled for this project BEFORE loading anything else. If a host gate has already told you the enablement verdict this turn (some hosts, like Claude Code, resolve it in a prompt-time hook and state it), trust that and skip to the matching branch below. Otherwise resolve `paqad_enable` yourself across these surfaces, highest precedence first (first match wins):

1. **`PAQAD_DISABLED` environment variable** — if set to `1`, `true`, `yes`, or `on` (case-insensitive), paqad is **OFF**, full stop. (Most hosts do not expose environment variables to you. If you cannot read it, move to the next surface.)
2. **`PAQAD_ENABLE` environment variable** — if set, it wins over the files below.
3. **`.paqad/.config`** (your git-ignored, dev-local file) — a `paqad_enable=<value>` line.
4. **`.paqad/configs/.config.app`** (the tracked, team-shared file; if your team split knobs across several `.config.*` files, the one whose filename sorts last wins) — a `paqad_enable=<value>` line.
5. **Nothing set anywhere ⇒ ON** (the default).

A value of `false`, `0`, `no`, or `off` (case-insensitive) means **OFF**. `true`/`1`/`yes`/`on`, or any unrecognized value, means **ON**.

**If paqad resolves to OFF:** stop here. Load no `docs/instructions`, no `docs/modules`, no rules, and no contracts; write no sentinel; add no paqad behavior. Just act as a normal assistant. Do not block, warn, or mention paqad.

## 2. When paqad is ON — load the router next

paqad is enabled, so load `AGENT-ROUTER.md` from this same install directory next and follow it top to bottom. That is where the rest of the flow lives: it routes the message to exactly one workflow, lists what to load for that workflow, defines the sentinel you write to confirm the load, and carries the paqad narration contract and the Decision Pause Contract. Nothing about that flow changes per host — the only host difference is the one conditional above (trust a host gate that already stated the verdict, otherwise probe it yourself).
