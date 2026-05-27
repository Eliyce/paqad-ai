# Dashboard — Design brief (Phase 1)

**Status:** approved baseline for #64 implementation. Companion to the existing `graph-ui` design tokens.

## Purpose

A single read-only page that answers "where am I on this project?" — for the human running `paqad-ai dashboard` in the browser, and the agent running `paqad-ai status` in a prompt. Glance-first, drill-in optional.

## Visual hierarchy

```
┌──────────────────────────────────────────────────────────────────┐
│ paqad-ai · <project-name>           v1.2.0    ◐ theme    ⟳ live  │  ← chrome
├──────────────────────────────────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓▓░░ 73%      Needs your attention                       │
│  Overall                · Decision #42 pending 4d                │  ← summary band
│                         · Module `payments` health: red          │
│                         · Stack drifted (3 changes)              │
├──────────────────────────────────────────────────────────────────┤
│  [ Card ] [ Card ] [ Card ]                                       │
│  [ Card ] [ Card ] [ Card ]                                       │  ← section grid
│  [ Card ] [ Card ] [ Card ]                                       │
└──────────────────────────────────────────────────────────────────┘
```

Click any card → main pane swaps to the section detail; chrome and summary band stay. Architecture card → embedded sigma canvas (current graph view, unchanged).

## Section card anatomy

```
┌────────────────────────────────────┐
│  Section Name              ▣ 87%   │   ← title + score badge
│  one-line summary of state    ?    │   ← summary + helper-text affordance
│  ────────────────────────────────  │
│  · 5 expected · 4 present · 1 stale│   ← compact metrics
│                            Open →  │
└────────────────────────────────────┘
```

- **Title:** section name only. No prefix icons in v1.
- **Score badge:** color from existing module-status tokens — `mod-green` ≥ 80%, `mod-amber` 50–79%, `mod-red` < 50%, `mod-unknown` when section is N/A.
- **Summary line:** one sentence, ≤ 60 chars. State-derived, not generic.
- **Helper text (`?` icon):** popover with "what this section means" and "what good looks like." Never visible by default.
- **Compact metrics:** small, dimmed (`muted`). Three at most.
- **`Open →`:** opens the section detail. Keyboard: `Enter` on focused card.

## Score badge spec

- Pill, 36×20px equivalent, value text white on solid `mod-*` token.
- N/A sections show `mod-unknown` with em-dash, not 0%. Distinguishes "not applicable" from "broken."
- Tooltip on hover: "Score = X% (Y of Z artifacts present, weighted by freshness)." Always shows the math.

## Layout grid

- 3-column ≥ 1280px, 2-column 768–1279px, 1-column < 768px.
- 24px gutter, 16px card padding, 8px internal spacing.
- Summary band sticky on scroll.

## Typography

- System UI font stack. No custom font.
- Scale: 12 / 14 / 16 / 20 / 28px. Section titles 16px semi-bold; summary band score 28px; card body 14px; metrics 12px.

## Color usage (mapping to existing `graph-ui` tokens)

- App canvas → `--color-canvas`
- Cards / drill-in pane → `--color-surface`
- Borders / dividers → `--color-border`
- Body text → `--color-canvas-fg`
- Secondary text → `--color-muted`
- Accent (links, focus rings) → `--color-accent`
- Score badges → `--color-mod-green` / `--color-mod-amber` / `--color-mod-red` / `--color-mod-unknown`
- Dark mode: same names, dark values already defined.

**No new tokens introduced in phase 1.**

## Motion

- One animation: when SSE re-fetch updates a section, its card border pulses `accent` (200ms, ease-out). Nothing else animates.
- No fade/slide on initial load.

## Chrome (minimal)

- Top bar: `paqad-ai` wordmark (text only, no logo asset) · project name (from `project-profile.yaml`) · framework version (small, dimmed) · theme toggle · "live" indicator (dot, pulses when SSE connected).
- Footer: none.

## Empty / error states

- Project not onboarded: single card "Run `paqad-ai onboard` first." No partial render.
- Source files missing but project IS onboarded: card renders with `mod-unknown` badge + helper text "Not configured yet — run `<command>` to enable."
- SSE drop: "live" dot turns gray; banner "Reconnecting." No stale data shown.

## Sections to render (phase 1)

| Section | Source of truth | Score signal |
|---|---|---|
| Project profile | `.paqad/project-profile.yaml` | Required fields present, RAG configured, commands non-default |
| Rules | `docs/instructions/rules/**` | File presence vs. expected per stack, edited-from-default heuristic, freshness |
| Workflows | `docs/instructions/workflows/**` | Present workflows vs. expected for the stack |
| Decisions (living) | `.paqad/decisions/{pending,resolved,expired}/**` | Pending count weighted by age |
| Module health (living) | `.paqad/module-health/*.json` | Risk distribution; oldest stale |
| Module docs | `docs/modules/<m>/**` | Per-module: overview/api/runbook/ADR present + fresh |
| Architecture / graph | existing `paqad-ai graph` data | Coverage of detected modules in graph |
| Design system / stack / registries / tools / tech-debt | `docs/instructions/<area>/**` | Per-area expected files present + fresh |
| Stack drift (living) | `.paqad/stack-drift.json` vs `stack-snapshot.json` | Drift count; recent vs. acknowledged |
| Framework version | `.paqad/framework-version.txt` | Age vs. latest release |
| RAG status | `project-profile.yaml` + `.paqad/vectors/`, `.paqad/indexes/` | Enabled? Provider configured? Index freshness? |
| Pentest (when present) | `.paqad/pentest/runs/**` | Last-run age, open findings |
| Session continuity (when present) | `.paqad/session/**` | Last handoff age |

## Out of scope (phase 1)

- In-page file editing
- Marketing-grade brand chrome (logo, gradients, hero)
- Custom typography
- Animations beyond the SSE pulse
- Mobile-first layout
- Multi-project view
- Historical trend charts
- MCP server endpoint

## Open design questions (resolve in PR review, not blocking)

- Exact thresholds for green/amber/red (80/50 is the starting point)
- Whether the Architecture card opens an embedded canvas or full-page view
- Whether helper text is popover or a permanent secondary line
