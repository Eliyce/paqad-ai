# Spec — S-325 One end-of-change paqad receipt

## Behavior
The end-of-change verdict is surfaced as ONE branded, honest receipt in paqad's own
vocabulary, and the duplicated per-stage chatter is cut. The verdict headline uses the
contract's words (Safe to merge / Needs your attention / Inconclusive) and glyphs; the
receipt adds a per-stage evidence line with provenance, and it is emitted as a visible
systemMessage rather than buried on stdout.

## Acceptance criteria
- **AC-1** (contract vocab): given a verification verdict, when the summary is
  formatted, then it uses `PAQAD_VERDICT` words and `PAQAD_STATUS_GLYPH` glyphs from
  `paqad-voice.ts` (never ad-hoc `✓/✗ verification passed/blocked`), led by the
  `**▸ paqad** ·` frame. A hard fail → "Needs your attention"; only-inconclusive →
  "Inconclusive"; all-clear → "Safe to merge".
- **AC-2** (per-stage receipt + provenance): given a folded change, when the receipt is
  composed, then it renders one line per mandatory stage (plus optional stages that ran)
  with a fixed glyph and an evidence note.
- **AC-3** (honesty): given a stage that is marker-only / carries no artifact / has a
  near-zero duration, when the receipt renders it, then it shows 🟡 "marked (no recorded
  work)" (or ⚪), never 🟢 "done".
- **AC-4** (systemMessage): given a passing completion run, when the backstop emits the
  result, then it writes the receipt as a `{systemMessage}` (visible), not bare stdout.
- **AC-5** (no duplication): given a marker recorded at a stage boundary, when narration
  is produced, then the per-marker END line is muted (the ledger write is kept) so the
  boundary is not spoken twice.
- **AC-6** (adapter honesty): given the generated narration contract, when it targets
  Codex/Gemini, then it states the record hook is silent there and the model must narrate
  its own markers — it no longer claims hook-driven ledger narration on those hosts.

## Invariants
- **INV-1**: the receipt never asserts a stage ran without evidence — it reflects the
  fold's honesty tags (inconclusive/unreliable → not 🟢).
- **INV-2**: verdict words come only from `PAQAD_VERDICT`; no new verdict strings.
- **INV-3**: on a block (exit 2) the receipt reaches the model via stderr (host physics).

## Out of scope
- Wiring the live #08 delivery-check state into the receipt (separate warn-only hook);
  the formatter leaves room for it.
