---
name: script-writer
description: Write concise spoken-word scripts and narrative sequences optimized for pacing, transitions, and spoken clarity. Use when the deliverable will be performed aloud (video, podcast, demo).
---

# Script Writer

## What It Does

Drafts spoken-word scripts where each segment is timed, transitionally clean, and easy to perform aloud — never reads like written prose.

## Use This When

Use this when the output is meant to be spoken: video VO, podcast segment, conference demo, walkthrough.

## Inputs

- Brief or outline describing audience, runtime target, and tone.
- `references/spoken-checklist.md`.

## Procedure

1. Fill `assets/script.template.md` segment-by-segment; each segment has runtime estimate, beat, and transition.
2. Run `scripts/estimate-runtime.sh <script>` (default 150 wpm) and compare to the brief target.
3. Walk `references/spoken-checklist.md` (no syllable-heavy mouthfuls, no "this/that" antecedent loss, transitions read aloud cleanly).

## Output Contract

- Match `assets/script.template.md`: header (Audience, Runtime, Tone) + numbered segments with `Time:`, `Beat:`, `VO:`, `Transition:`.

## Resources

- `references/spoken-checklist.md`
- `scripts/estimate-runtime.sh`
- `assets/script.template.md`
