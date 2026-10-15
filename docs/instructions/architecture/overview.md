# Architecture overview

Normative source: [REQUIREMENTS.md](../../../REQUIREMENTS.md) sections 6, 11 and 12. This page
describes what is built today and how the parts fit.

## Shape: one plugin, many skills

The plugin is a bundle of 13 focused skills. Five are entry points a user can start directly;
eight are journey steps that run only when the `product-discovery` coordinator directs them
(PLG-8). Each skill owns one responsibility and carries its own references, assets and scripts.

```
User message
   |
   +-- question ----------------> ask-project ----------(hand-over)---+
   |                                                                  v
   +-- idea / problem ----------> product-discovery (coordinator) ----+
   |                                 step 0 get-connected
   |                                 step 1 understand-idea
   |                                 step 2 ground-in-project
   |                                 step 3 shape-idea
   |                                 step 4 decide-together
   |                                 step 5 write-tickets -> check-tickets
   |                                 step 6 post-tickets
   |
   +-- "make ABC-142 ready" ----> refine-ticket
   +-- "how big is this?" ------> size-work
   +-- "what fits the sprint?" -> plan-sprint
```

Every path reads the target project's onboarded `docs/` and, where needed, the tracker, through
the host's own connectors. Which repository to read is settled once by one shared rule
(`shared/references/connect-repository.md`, GRD-3) and its state checked by one shared script
(`shared/scripts/check_onboarded.py`, GRD-1). Nothing in this repository talks to a network.

## Source layout

| Path | Role |
|---|---|
| `skills/<name>/` | One skill: `SKILL.md` plus optional `references/`, `assets/`, `scripts/` |
| `shared/references/` | Text held once and copied into skills at build time (voice, consulting stance, plain language, writing rules, docs map, template markers, repository choice and onboarded check, Jira and GitHub profiles) |
| `shared/scripts/` | Python modules held once and copied into skills at build time (record, digests, prose and read-back checks, onboarded check, related-module ranking, placeholder detection) |
| `build/skills.yml` | Single source of truth: plugin metadata and each skill's declared shared imports |
| `build/build.py` | Assembles `dist/` and generates every manifest |
| `hosts/*.md` | Human install notes and manual verdict harness per host; not shipped |
| `tests/scripts/` | Unit tests for every script, the build and the authoring rules |
| `tests/evals/` | Fixture onboarded repo, fake tracker data, and conversation scenarios |
| `.github/workflows/` | CI, nightly verify, release |
| `dist/` | Generated output; gitignored |

## Build pipeline

`build/build.py` (PLG-9 to PLG-11):

1. Parses `build/skills.yml` with a restricted stdlib reader.
2. Wipes the target `dist/` so removed inputs never linger.
3. For each skill, fails if `SKILL.md` mentions a `shared/` file it did not declare (PLG-10),
   then copies the skill folder (skipping `__pycache__` and `*.pyc`) and its declared shared
   files into `dist/plugins/paqad-product-discovery/skills/<name>/`.
4. Writes four manifests from the same values, with sorted keys and fixed separators:

| Manifest | Read by |
|---|---|
| `dist/.claude-plugin/marketplace.json` | Claude org sync, ChatGPT workspace import |
| `dist/.agents/plugins/marketplace.json` | Codex local marketplaces, ChatGPT import |
| `dist/plugins/<name>/.claude-plugin/plugin.json` | Claude plugin manifest |
| `dist/plugins/<name>/plugin.json` | OpenAI primary manifest (`extensions.com.openai`) |

The build is deterministic: two runs produce byte-identical output (CI-8). It never emits
`agents/`, `hooks/`, `commands/`, `bin/`, `.mcp.json`, `mcp.json` or `.app.json` (PLG-1, PLG-2).

## State: the discovery record

Web chat has no hooks and no server, so the record is the only state (REC-1 to REC-7).
`shared/scripts/record.py` owns it:

- Blocks: `setup`, `idea`, `glossary`, `today`, `playback`, `decisions`, `assumptions`,
  `outcome`, `ticket_set_ref`, `readiness`, `posted`, plus the existing-work blocks `existing`,
  `changes`, `sizing`, `sprint_plan`.
- Modes: `build` (idea journey), `refine`, `size`, `plan`. Each mode has its own required
  blocks per step.
- Optimistic concurrency: every update states the revision it expects; an older revision is
  refused.
- Going back marks later blocks in the dependency chain
  (`idea -> today -> playback -> decisions -> ticket_set_ref -> readiness -> posted`) stale.
- Approvals (`post it`, `apply it`, `set it`) are bound to a content digest
  (`shared/scripts/canonical.py`); any change to the content voids the approval.

## Control model (honest limits)

The plugin guides; it cannot enforce in web chat (section 6.5). Control layers, weakest to
strongest: step order and exit conditions, the record's required blocks, checking scripts
where the host runs them, a digest-bound explicit approval before any write, the host's own
write-approval prompt, and read-back after writing.

Every script-backed check also exists as a written checklist in its skill, so a skill still
works on a host that cannot run scripts (PLG-6).

## Tracker writes

Write paths are planned and checked by scripts but executed by the host connector:

| Flow | Planner / guard | Read-back |
|---|---|---|
| Post new tickets | `post-tickets/scripts/plan_posting.py` (order, claims, receipts, reconcile lost replies) | `shared/scripts/check_readback.py` |
| Refine existing tickets | `refine-ticket/scripts/diff_ticket.py` (field-by-field diff, conflict and rich-content guards) | `shared/scripts/check_readback.py` |
| Set a size | `size-work/scripts/compare_sizes.py set` (refuses overwrite unless asked) | in-skill |
| Assign to a sprint | `plan-sprint/scripts/fit_sprint.py apply` (digest-checked, chosen set only) | `shared/scripts/check_readback.py` |

## Delivery slices

| Slice | Scope | State |
|---|---|---|
| S0 | Spike, repo skeleton, honest CI stubs | Built |
| S1 | Idea journey and question answering on claude.ai | Built |
| S1b | `refine-ticket`, `size-work`, `plan-sprint` | Built |
| S2 | ChatGPT and Codex parity | Not started |
| S3 | Full CI (CI-1 to CI-20), evals in CI, release channels | Not started |
| S4 | Public directories, more tracker profiles | Not started |
