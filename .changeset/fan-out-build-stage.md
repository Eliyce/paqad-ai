---
'paqad-ai': minor
---

The full-lane build stage now fans out: a lead developer splits the plan into slices and several development agents build them at once. Only the lead ends the stage, Stop waits while slices run, decisions stay in their slice, each slice's model follows the plan's risk tag, heavy runs take turns, and the checks report keeps full failing output. No new settings: every default is fixed in code.
