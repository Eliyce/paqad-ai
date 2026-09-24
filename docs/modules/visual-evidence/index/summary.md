# Visual Evidence

> **Layer:** `framework-internals` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `visual-evidence`

## Purpose

Visual evidence (issue #551). When a feature-development change touches frontend files,
paqad captures ordered screenshots of the **documented** user flows the change affects,
pairs each with a business-language caption, stores everything in the feature's evidence
bundle, assembles an overview GIF, and verifies the evidence at end-of-change like every
other bundle artifact. The reviewer sees exactly what changed, in the right order, described
in business terms.

Everything at runtime is deterministic scripts — **zero LLM calls in the execution path**.
The only agent-time work is authoring the capture scripts from confirmed site-map journeys
(the rules-as-scripts model).

Off by default. Turn it on with the `visual_evidence` flag; `visual_evidence_mode`
(`warn` | `strict`, floored) governs how firmly the gate enforces. With the flag off (or the
`coding` capability absent) the whole feature is inert: no capture, no writes, and the gate
reports `skipped`.

## How a change flows through it

1. **Trigger** (`trigger.ts`) — the change is *frontend-triggering* when a changed file
   (from the git-reconciled change evidence) matches an active stack pack's
   `visual_evidence.frontend_globs`. Non-frontend ⇒ everything downstream is `not-frontend`.
   If the profile declares frameworks but paqad loads none of its built-in packs, that is an
   install fault (`PackRegistryEmptyError`), not a clean change: the gate reads `fail` under
   `strict` and `inconclusive` under `warn`, and `run` / `plan` print the fault and exit 1
   (issue #579). It is never reported as `not-frontend`.
2. **Plan** (`resolve-plan.ts`) — deterministic: changed frontend files → owning modules
   (module-map) **and** surfaces whose `evidence[].file` anchors match → union of surfaces →
   the **confirmed** journeys that reference those surfaces → their capture scripts. No match
   ⇒ `no-documented-flow`; a matched journey with no script ⇒ `no-capture-script`.
3. **Capture scripts** (`capture-script.ts`) — `docs/site-map/journeys/<id>.capture.yaml`,
   validated against `journey-capture.schema.json` plus cross-checks (the journey exists and
   is `confirmed`, every `journey_step` is real, steps ascending). A script pointing at a
   `proposed` journey is invalid and reported (`capture-script-invalid`), never used.
4. **Provision + boot** (`provision.ts`, `boot.ts`) — Playwright + Chromium are provisioned
   into `~/.paqad-ai/ve-runtime/` (never a paqad dependency, never imported from the target
   project) and the app is booted from the profile's `app_preview` block.
5. **Runner** (`runner.ts`): writes the scripted captures. Boots, captures each flow's steps
   (a failed selector stops only that flow and keeps its prior steps), assembles the GIF, and
   atomically replaces `screenshots/` + `visual-evidence.json`. Screenshots added with
   `visual-evidence attach` survive every run path: their folders, files and hashes are carried
   into the new manifest, and scripted folders are numbered after them (issue #579). Both
   writers go through the one manifest writer in `manifest.ts`.
6. **Gate** (`verification/gates/visual-evidence.ts`) — reads the manifest at end-of-change
   and returns pass / skipped / inconclusive|fail, verifying existence + manifest integrity +
   every referenced screenshot's size and SHA-256 (never the screenshot content).

## When a capture cannot run here (issue #579)

A frontend change on a machine with no confirmed journey, no capture script, the `site_map`
flag off, or no provisioned browser used to find out only at the Stop gate. Now it hears
about it at every stage:

- **Planning.** Plan steps can list the `files` they expect to touch. When visual evidence is
  on, the plan step files plus the changed files include a frontend file, and the shared
  readiness check (`readiness.ts`, the same checks `paqad-ai doctor` reports) finds a problem,
  `plan compile` opens one decision pause ("Visual evidence is on, but I can't capture
  screenshots here yet") with three options: set it up now, attach my own screenshots, or
  record a waiver. A re-run of `plan compile` for the same change opens no second pause.
- **Specification.** `spec freeze` refuses a spec for a frontend change with no acceptance
  criterion marked `(proof: visual)`, naming the frontend files.
- **Development.** The first frontend edit of the change carries one model-facing reminder to
  run `visual-evidence run` or attach screenshots. It is sent once per change, and the marker
  lives under `.paqad/session/`, never in the bundle.
- **Stop gate.** Under `strict`, a manifest whose only skips are `no-documented-flow` or
  `no-capture-script` now fails. Attached screenshots make it pass (the detail says how many
  are agent-attached). A resolved readiness pause with the `waive` option makes it read
  `skipped` with "waived by D-<id>", never pass. Under `warn` these stay skipped, and the
  verdict prints a "⚪ visual evidence: skipped (<reason>)" line so a turned-on gate that
  skipped is visible.

A change with no frontend files still reads `skipped (not-frontend)`: no pause, no block.

## Artifacts (inside the feature bundle)

```
visual-evidence.json                 <- rigid manifest, bundle root
screenshots/
  01-<slug>/image.png                <- clean screenshot, no overlays ever
  01-<slug>/caption.txt              <- plain UTF-8 business-language caption
  02-<slug>/image.png
  02-<slug>/caption.txt
  overview.gif                       <- all steps in order, 2000ms/frame, caption bar ABOVE the page pixels
```

`NN` is a continuous, zero-padded 2-digit position across all flows (flows ordered by
journey id ascending, steps in capture-script order). `<slug>` is Windows-safe kebab-case
(`[a-z0-9-]`, no `:`, max 40, deduplicated). All stored paths are posix-form. The per-step
`image.png` is byte-identical to what Playwright produced — captions live only in
`caption.txt`, the manifest, and the GIF frames.

Attached screenshots use the same folder layout. Their steps carry `journey_id:
agent-attached` and an optional `ac` (the criterion they prove), and the manifest gains a
`source` of `agent-attached` (only attached steps) or `mixed` (attached and scripted). A
manifest with only scripted captures has no `source`. The report and the gate label attached
steps as agent-attached so they are never read as scripted captures.

## Config knobs

| Knob | Default | Meaning |
| --- | --- | --- |
| `visual_evidence` | `false` (app flag) | Master switch. ON also requires the `coding` capability. |
| `visual_evidence_mode` | `warn` (floored policy) | `warn`: an environmental miss reads Inconclusive, and documented skips stay skipped with a skip line. `strict`: an environmental miss fails the change, and so does nothing captured because no documented flow or capture script exists, unless you attach screenshots or record a waiver. Team value is a floor; local/env may only raise `warn` to `strict`. |

## Skip reasons

`not-frontend` / `flag-off` / `no-documented-flow` / `no-capture-script` /
`capture-script-invalid` / `playwright-not-provisioned` / `app-preview-not-configured` /
`app-not-reachable` / `env-var-missing` / `selector-not-found`.

`no-documented-flow` / `no-capture-script` / `capture-script-invalid` are documented "nothing
to capture" outcomes and read `skipped` under `warn`. Under `strict` (issue #579), a manifest
whose only skips are `no-documented-flow` or `no-capture-script` fails unless screenshots were
attached or a waiver was resolved. A waiver is any resolved decision that chose `waive` and
carries the change's `[paqad-ve-readiness <bundle>]` token: the readiness decision planning
opened, or, when planning opened none, one created with `paqad-ai decision create` (the failing
gate prints the exact command). `capture-script-invalid` stays skipped in both modes. The
rest are environmental: `inconclusive` under `warn`, `fail` under `strict`.

## Authoring a capture script

`docs/site-map/journeys/<journey-id>.capture.yaml` (one per confirmed journey you want
captured):

```yaml
schema_version: 1            # integer const 1
journey: checkout-flow       # must equal the sibling journey id, and resolve to a confirmed journey
setup:                       # optional; runs once before steps (auth/seed). No journey_step, no screenshot.
  - goto: /login
    actions:
      - { selector: "#email",    do: fill,  value: "$VE_USER" }
      - { selector: "#password", do: fill,  value: "$VE_PASSWORD" }
      - { selector: "button[type=submit]", do: click }
steps:                       # ordered; each maps to ONE journey step (its caption source)
  - journey_step: 1          # 1-based index into the journey's steps[]
    goto: /goals             # optional path relative to app_preview.url
    actions:                 # optional interactions, run before the screenshot
      - { selector: "#goal-select", do: select, value: "savings" }
    screenshot: true         # default true; false = interaction-only step
```

- `do` is one of `click | fill | select | press | wait_for`. `value` is required for `fill` /
  `select` / `press` (a key name) and `wait_for` (`visible` | `hidden`).
- `value` may reference environment variables as `$VE_*` — resolved at runtime, so credentials
  never land in tracked files. An unresolvable `$VE_*` gives `env-var-missing`.
- The **caption** is the journey step's `action` text, with `". " + expect` appended when the
  step has an `expect`. Its language is whatever the journeys carry (`app.language`).

## The `app_preview` boot contract

A new optional block in `project-profile.yaml` — the single shared boot contract for visual
evidence (and, going forward, design-test):

```yaml
app_preview:
  url: http://localhost:3000   # required; the base URL steps' goto paths resolve against
  command: ""                  # optional; defaults to commands.dev; "" with a reachable url = attach only
  wait_ms: 30000               # optional; max wait for the url to respond after starting the command
```

## CLI

- `paqad-ai visual-evidence run` — resolve plan, provision check, boot, capture, write the
  bundle artifacts. Keeps every agent-attached step. Exit 0 on captured/partial/skipped (skips
  are honest outcomes); exit 1 on the empty-pack-registry install fault; non-zero on an
  internal error.
- `paqad-ai visual-evidence attach <png...> [--ac AC-3] [--label "..."]`: copy your own PNG
  screenshots into the active bundle as agent-attached steps (numbered folders, caption,
  SHA-256 and size recorded), merging into an existing manifest. Refuses a non-PNG, a missing
  file, no active bundle, or visual evidence off, with one line and exit 1, writing nothing.
  `run` and `attach` are the only writers of `visual-evidence.json` + `screenshots/`.
- `paqad-ai visual-evidence plan` — print the resolved plan (journeys, matched files, capture
  scripts, skips including invalid/stale scripts) without a browser or app boot. `--json` for
  machine output.
- `paqad-ai visual-evidence setup` — provision the browser runtime, idempotent, prints status.

## Out of scope (v1)

PR/MR image attachment (the agent surfaces evidence in chat; the user shares it onward),
video/screen recording, drawing on page pixels, and retention/pruning of evidence.
