---
id: "TD-01M6VM5006BWKPA7MKFJPC98W0"
title: "HUD sign-off Button has no accessible name with the ref (NFR-2)"
kind: "gap"
severity: "medium"
status: "closed"
files:
  - "runtime/claude-plugin/mod/desktop-band.tsx"
  - "runtime/claude-plugin/mod/desktop-view.ts"
found_in:
  change: "01M6VGEQDK70S72RC2FNQFS63Q"
  issue: "835"
  stage: "review"
found_by: "paqad-review"
session: "9f50aa35-556a-4f5e-a9e0-7b142a0cf499"
created_at: "2026-11-07T18:25:51.073Z"
reopened_at: null
issue: null
closed_reason: "The Stage alt text now says the ref and the Button's full name from SignoffView.name (Design sign-off for PQD-12: Waiting 3h. Check button: Check design sign-off for PQD-12.). Keyboard reach and focus ring stay with AC-26 on a real Desktop band."
---

## What

The HUD sign-off Button (runtime/claude-plugin/mod/desktop-band.tsx signoffButton) carries only its
visible word (Check, View, Copy design). Desktop's Button draws only `label` when one is passed
(docs/instructions/design-system/hud.md rule R1), so there is no way today to give it a separate
accessible name. NFR-2 of change 01M6VGEQDK70S72RC2FNQFS63Q asks for a name that names the action and
the ref ("Check design sign-off for PQD-12"). `signoffView` already computes that name
(SignoffView.name in runtime/claude-plugin/mod/desktop-view.ts) but nothing renders it, and the strip
alt text says "Design sign-off: Waiting 3h. Check available." without the ref. The ref is only heard
in the headline ("Waiting for sign-off on <ref>").

Fix when the host Button gains an accessible-label prop that does not replace its children, or add
the ref to the sign-off sentence in the stage alt text now. Confirm with AC-26 on a real Desktop band.
