# Site map

This directory holds the application's verified behavioural map — `app-map.yaml` (surfaces,
navigation, guards, journeys index), the creation `answers.yaml`, and one
`journeys/<id>.journey.yaml` per curated journey. It is a living document, kept in sync by the
site-map workflow.

## Capture scripts (visual evidence, issue #551)

Alongside each **confirmed** journey the team wants captured, a sibling capture script
`journeys/<journey-id>.capture.yaml` turns that documented flow into an executable one. Capture
scripts are **compiled at agent time** from confirmed journeys (the rules-as-scripts model) —
they are never authored for a `proposed` journey, and only confirmed journeys ever produce
visual evidence. At runtime, deterministic scripts read them (no LLM) to drive a browser and
record screenshots into the change's feature bundle. See
[docs/modules/visual-evidence](../modules/visual-evidence/index/summary.md) for the full
capture-script shape, the `app_preview` boot contract, and the verification gate.
