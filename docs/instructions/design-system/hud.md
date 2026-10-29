# HUD Design System (Claude Code Desktop)

How the paqad HUD mod in `runtime/claude-plugin/mod/` draws on Claude Code Desktop: the band above
the prompt and the paqad Ledger side panel. The terminal keeps its own drawing (text marks, the
engine's named tones, one-letter hotkeys), described under "HUD mod Conventions" in
[overview.md](overview.md). Only the Desktop surface (`e.surface === 'desktop'`) follows this page.

The design is corporate, quiet and alive: neutral ink everywhere, colour only for state, no border,
background tint, logo or padding around the band, and motion only on what is live.

## Tokens

Every colour the Desktop drawing uses comes from `runtime/claude-plugin/mod/palette.ts`. No other
module writes a colour literal; `strip.ts` imports every Svg colour from the palette.

| Token           | Light                              | Dark (`prefers-color-scheme`) | Use                                                                                             |
| --------------- | ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `ink`           | `#6E7D86`                          | `#C2CBD0`                     | done delivery nodes and seats, Svg values                                                       |
| `muted`         | `#8E979D`                          | `#97A1A7`                     | Svg caps and labels                                                                             |
| `headline`      | `#1F2428`                          | `#E8ECEE`                     | the live headline in the band Svg                                                               |
| `faint`         | `muted` at 30% (fill)              | same                          | not yet                                                                                         |
| `faintStroke`   | `muted` at 45% (stroke)            | same                          | not-yet rings, dashed not-required lines                                                        |
| `hair`          | `muted` at 28%                     | same                          | dividers, rules, hairlines                                                                      |
| `accent`        | `#F90093` (paqad vivid pink)       | same                          | running, the shown tab                                                                          |
| `attention`     | `#F37748` (paqad coral)            | same                          | waiting on you only: a question, a permission, a pending decision, and the stage paused for it |
| `caution`       | `#C98A1B`                          | `#E3B04B`                     | needs a look: flags, marked stages, a late seat, inconclusive or skipped gates, PR closed      |
| `pass`          | `#2F8F6B`                          | `#5FC29C`                     | pass, done stage bars and their check, the one-time done glow                                   |
| `passText`      | `#26775A`                          | `#5FC29C`                     | done stage label text only (5.43:1 on white; `pass` is 3.99:1, too faint for 9 px text)        |
| `fail`          | `#D23B3B`                          | `#F08080`                     | fail                                                                                            |
| `onSignal`      | `#FFFFFF`                          | same                          | only on a solid signal: the High Table badge numbers, the running sheen                         |
| `PX_PER_COLUMN` | `8.5`                              |                               | strip width = `bodyColumns × 8.5`                                                               |
| `BREATH`        | alpha suffixes `FF CC 8C 66 8C CC` |                               | the live light, one step per 400 ms tick; the band headline dot steps through the same values  |

The status set is "B": the paqad brand palette plus one functional green and one red. Nothing uses
`gray` or `white` by name.

Type: `Text` uses the app's own colour, `dimColor`, `size` (`caption`, `footnote`, `body`,
`heading`, `title`) and `weight` (`medium`, `semibold`). A mod cannot load fonts. Svg text uses
`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif` with tabular
numerals.

## Desktop drawing rules

Each rule was a visible bug on Desktop before it became a rule.

| #   | Rule                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A `Button` with a `label` draws only the label; its children are ignored. Never pass `label` where the children must show.                                                                                                   |
| R2  | A `plain` Button draws flat body-size text and drops the styles of child `Text`. Only the Button's own `dimColor` works.                                                                                                      |
| R3  | A non-plain Button draws Desktop's native bordered button; with `dimColor` it reads as a button without shouting. Use it for `Ledger`, `Close for now`, `Hide always`, `Answer in chat`.                                    |
| R4  | `role="dismiss"` draws a bordered `Close` button, not an ×. Draw `×` as a plain dim Button.                                                                                                                                  |
| R5  | No `hotkey` on Desktop: it draws a letter chip and only fires once the band has the keyboard. Hotkeys stay on the terminal.                                                                                                   |
| R6  | An `Svg` with `isInteractive` sits in a fixed tall frame and scales the art up. Use plain-image Svg: it stays tight and its CSS and SMIL animations still run.                                                               |
| R7  | A plain-image Svg with no `width`/`height` props takes its markup size, capped to the slot. Give the markup the size you want. Full-width rules and bars: markup width 2000, `preserveAspectRatio="none"`, only a `height` prop. |
| R8  | A `Client` region ignores `Text size` and sits higher than text beside it. Never put a Client next to text; live text re-renders from the tick atom.                                                                        |
| R9  | Mixed sizes in one row go in one `Text` with nested `Text` children, so they share a baseline.                                                                                                                                |
| R10 | Every row starts with text, never a Button. The strip's last section is inset 7 px so its values line up with the `×` above.                                                                                                 |
| R11 | `backgroundColor` takes 8-digit hex tints; theme keys as backgrounds are solid and loud. The design uses no tints.                                                                                                           |
| R12 | `Box width` percentages are whole numbers: `"20%"` draws, `"20.00%"` is refused.                                                                                                                                              |
| R13 | In the prompt footer, a `SessionMode` hook can draw its own tree; `$.ui.status` prints the plugin's name first; `PromptHint` is not drawn on Desktop.                                                                        |
| R14 | Desktop reports band `bodyColumns` 57 to 93 and `maxRows` 12, and a docked pane `bodyColumns` 48, about 8.5 px per column. The terminal's 110-column row or column switch is never used on Desktop.                         |
| R15 | The `theme` row of `$.config.list()` is the terminal theme, not the Desktop appearance. Svg colours are mid tones that read on light and dark, with a `prefers-color-scheme: dark` block as a bonus.                      |
| R16 | A `Button` holds strings and `Text` only, never an `Svg`: the engine refuses the element and skips the whole draw. No image in the band is pressable; controls are text Buttons.                                         |

## Components

### Band card

Four rows in `Box flexDirection="column" rowGap="xs"`, 6 rows high in every state, nothing around them.

- **Identity row** (`Box` row, `alignItems="center"`, `columnGap="sm"`): one `Text` with `paqad`
  (semibold) and a dim footnote run of the parts that apply, joined by `  ·  `: the workflow, the
  lane (`Fast lane`, `Graduated lane`, `Full lane`), the change chip, and the cost
  (`<tokens> tokens · ~$<usd>`, `<tokens> tokens · whole session`, or
  `<tokens> tokens so far · ~$<usd>` while the turn is still being counted). Before any token
  figure is known an open window reads `counting`, never a final 0. Then `Box flexGrow`,
  then, only with open flags, an amber `⚑` `Text` and a plain dim `N flag(s)` Button, then the
  bordered dim `Ledger` Button and the plain dim `−` and `×` Buttons.
- **Message row**: on static states (Done, Waiting for your answer, Inconclusive, Next) one
  `Text wrap="truncate-end"`: `●` (heading size, the signal colour) + the headline (heading,
  semibold) + a dim footnote note. On live states (a stage running, a subagent) one plain-image
  `Svg` with no width or height props, markup as wide as the strip and 24 high: the dot (r 5.5 at
  6, 12, the signal colour), the title at x 20, baseline 17, 17 px, weight 600, in `headline`
  with the title sheen, then the note and the clock `m:ss` as 12 px `muted` runs 16 px apart.
  Its `alt` says the whole sentence, the note and the clock in words
  (`Building. Running for 2 min 1 s.`).
- **Body line**: the gap line's slot, one dim footnote `Text wrap="truncate-end"` with no indent,
  on the shared left edge. While a subagent runs it carries the newest subagent line; otherwise
  it carries the gap text. It is always drawn. It is blank when there is
  nothing to say, so the card keeps one height in every state and never gains or loses a row as
  the headline moves between running, waiting and the verdict. It blames nobody: a stage with no
  record yet reads `No record yet for: Spec, Build`, and nothing shows here while a stage runs,
  because nothing has truly gone unrecorded yet. `paqad could not record ...` is kept for real
  record faults.
- **Strip**: a `Box flexDirection="row"` of one plain-image `Svg` per section, each in a `Box`
  at its whole-number width, no width or height props on the Svgs. Each section is a `viewBox` cut
  of one layout whose markup width is `round(bodyColumns × 8.5)` with a minimum of 480, height
  52, so every x is the same as in one image; a divider is drawn half a pixel inside its left
  section so the cut keeps it whole. Caps baseline 9, marks centre 25, labels baseline 47. Each
  section has its own `alt`.
  - Sections STAGE 40% · HIGH TABLE 26% · DELIVERY 34%; without a High Table STAGE 56% ·
    DELIVERY 44%. A 1 px hairline divides them with 18 px on each side. The last section's right
    edge is inset 7 px.
  - Each section has a cap (8.5 px, weight 600, letter-spacing 1.1 px, muted) on the left and a
    value (10.5 px, weight 500, ink) on the right, drawn only when the section is wider than
    150 px.
  - STAGE: one bar per stage the snapshot's `lane_stages` names, with Intake and Deliver on every
    lane but fast (graduated, full and unresolved: Intake, Plan, Spec, Build, Review, Checks, Docs,
    Deliver; fast: Plan, Build, Checks). An older engine with no `lane_stages` gets the same lists
    from the lane. Bars are 3 px tall, `rx 1.5`, 4 px
    gaps, a 9 px label under each.
  - HIGH TABLE (only when the table sat): at most 3 seats, ordered writing, late, newest done,
    seated (ties keep roster order), r 4, spaced at most 22 px (22 px at 57 columns), initials
    under each (`SA IA DO PO AA UF QA`, or the first letters of other roles), then a quiet `+N`
    (9 px, weight 500, `muted`) one step on for the seats left out, a 12 px hairline, then the
    chief r 5 labelled `CA`. The Ledger's High Table tab lists every seat.
  - DELIVERY: one round node (r 8.5, the git icon at scale .625, stroke 1.9) per step of the
    delivery plan (Edit, Commit, Push, PR, CI as they apply; merging is the owner's, so there is
    no Merge node), spacing capped at 96 px, inset
    12 px from both section edges. Edit is current while a file is being edited or any edit stage
    (Build, Checks, Docs) runs, or while a file is really being edited once Build has been
    reached (a review fix or a docs edit), and done once one of them has finished. An Edit or
    Write during Plan or Spec (a plan template, the spec text) is not this change's code being
    edited, so Edit is not current there. Connectors run between circles only, 4 px clear of each, 1.2 px
    wide, ink when the next node is reached and faint otherwise.
- **Close menu**: pressing `×` adds an inline row under the identity row: footnote
  `Close the paqad band?`, bordered `Close for now` (this session), bordered `Hide always` (this
  project, across sessions) and plain dim `Cancel`.

### Minimised row

One row: one `Text` of `paqad` (semibold), dim footnote `   Feature development   `, the light
`● `, and footnote stage and clock (`Build · 3:01`; static states say their word); then a 64 × 4
mini stage Svg of the lane's stages; `Box flexGrow`; dim footnote cost; `Ledger`, plain dim `⤢`
(restores) and `×`.

### Closed and hidden rows

One small row: footnote `Text` of `paqad` (semibold) + dim `   Closed for this session` or
`   Hidden`; `Box flexGrow`; plain dim `Show`. When something waits on the person (a question or a
pending decision) the words become coral `● Waiting for your answer`. `Show` reopens and
un-minimises. Hide always stays until the person presses Show or runs `/paqad show`.

### Workflow band

Every route other than feature development draws one row: one `Text` of `paqad` (semibold), the dim
footnote workflow words (Question, Discovery, Codebase health, Pentest, Design test, Site map, Docs,
Module docs, Root-cause analysis, Rules analysis), then a pink breathing `● ` with footnote
`running · m:ss` while the workflow's turn is in flight, or a dim muted `●` with dim `idle` between
turns; `Box flexGrow`; dim footnote cost (`counting` while tokens are unknown); and `Ledger`. No
strip, no `−` and no `×`. With no workflow nothing is drawn.

### Ready row

Before the first snapshot is read: `paqad` (semibold) + dim footnote `   Ready`, and no Ledger.

### Ledger

Opened with the title `paqad Ledger`, on Trust. The `Ledger` Button toggles it and the flags open it
on Trust; the brand text and the strip image are not pressable (R16).

- **Subtitle**: dim footnote `What happened, with proof  ·  <change chip>`.
- **Tabs**: a row of equal Boxes, each `${Math.floor(100 / n)}%` wide, holding a plain Button with
  the full label, dim unless shown, over one tab rule Svg (2000 × 2, `preserveAspectRatio="none"`,
  `height={2}`): a 1 px hair line and a 2 px pink segment 60% of the tab's width centred under the
  shown tab. Order Trust · High Table · Delivery · Record · Cost; High Table is left out when the
  table did not sit. When a seat writes, the chief rules or the chief has questions, the High
  Table tab comes forward once per sitting. A tab the person picked during that sitting stays
  where they put it, and only the shown tab changes: focus is never moved.
- **Record tab**: only this change's decisions, one row per decision, each with its local date and
  time so rows from other days read as such, newest first.
- **Delivery tab**: commits already on the branch when the change opened are earlier work. They
  get one quiet dim line (or, with none, where the files are measured from), never a flag, never
  amber, and never count as this change's commits. A pull request number (a `#` and digits, in
  brackets or not) names a pull request, not a ticket. The `Open PR #N` link sits on the PR row
  while the PR is open; there is no Merge row.
- **Cost tab**: one token figure per High Table seat, the same one the seat drill-down shows: the
  exact run Claude Code reported for the seat, else the figure read from its transcript, else the
  note's own estimate. Each line says whether it is exact. A seat whose host figure differs drops
  its money figure rather than show two numbers.
- **Heading**: `Text size="caption" weight="semibold" dimColor`, capitals, `marginTop={1}`.
- **Row**: a `Box` column: a row with a left `Box flexGrow` (label in body, an optional dim footnote
  under it) and a right verdict word (footnote, weight medium: green `Pass`, red `Fail`, amber
  `Open`, pink `writing…`, dim for the rest), then a hairline Svg (2000 × 1, `height={1}`).
- **Table ring**: 150 × 150, r 52, one 7 px round-capped arc per seat (ink done, pink pulsing
  writing, faint seated, amber late), a 1 px spoke from each started seat to r 30 (dashed pink
  while writing), initials at r 67, a findings badge (ink disc r 6.5, count in `onSignal`) on each
  landed arc, and the chief ring r 24 in the centre with `Chief` and its state word.
- **Node**: 24 × 24, the strip's node art and states.
- **Meter**: 2000 × 4, `height={4}`, `rx 2`: a faint 18% track and a fill (ink done, pink running).

Control keys: `paqad-ledger`, `paqad-minimise`, `paqad-expand`, `paqad-close`, `paqad-close-now`,
`paqad-close-always`, `paqad-close-cancel`, `paqad-show`, `paqad-flags`, `paqad-tab-<id>`,
`paqad-answer`, `paqad-sides`, `paqad-seat-<role>`, `paqad-workflow-ledger`. Tab ids are `trust`,
`table`, `ships`, `record`, `cost`; the `ships` tab is labelled `Delivery`.

## Motion

All motion lives in plain-image Svg CSS or SMIL, or in the 400 ms tick. Only live things move;
nothing settled moves.

| What                                           | How                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Live light (band, minimised, workflow band)    | the `●` colour cycles the `BREATH` alpha suffixes, one step per tick (2.4 s cycle); in the band headline Svg the dot steps its opacity through the same values over 2.4 s, from the shared clock |
| Live headline title                            | an accent sheen sweeps the title every 3.6 s: 2.2 s on `cubic-bezier(.4,0,.2,1)`, then a 1.4 s rest; phase from the shared clock; off under reduced motion, which leaves the title solid `headline` and the dot at full opacity |
| Live clock                                     | re-rendered each tick, in whole seconds                                                              |
| Running stage                                  | opacity pulse 1.6 s, a 5 px glow from .55 to .15, a sheen sweep 2.2 s on `cubic-bezier(.4,0,.2,1)` |
| Writing seat, chief needing answers            | opacity pulse 1.6 s                                                                                  |
| Chief ruling, a running delivery step          | rotation 4 s linear (`transform-box: fill-box`); CI pending with no count is a still 30% arc instead |
| CI arc                                         | its length is the share of jobs done, updated on refresh                                             |
| CI job running                                 | an indeterminate pink sheen sweeping a 30% segment, 2.2 s                                            |
| The last stage finishing (the one exception)   | a blurred green copy of the done bars, opacity .5 to 0 over 2 s, played once                         |

One `tick` state atom is advanced every 400 ms by a `$.clock.every` timer that also sets the `now`
atom from `$.clock.now()`. It runs only while a live state is drawn and stops when none is. The
1.5 s snapshot ticker is separate and unchanged.

The done glow is the single named exception to "nothing settled moves". It plays when the last
mandatory stage turns done while this HUD is watching: the mod notes the first time it draws every
stage done for a change, and the glow plays only if that is within 10 s of the last stage's
`ended_at`. It runs about 2 s (SMIL, `repeatCount` 1, `fill` freeze), then nothing moves. It
plays at most once per change in a HUD's life, so reopening a finished change or reloading the HUD
never replays it. It carries the `motion` class, so `prefers-reduced-motion` hides it. It is a
light effect only: no size change, border, tint fill or layout shift. The terminal draws no
animation for it.

Strip motion keeps its place. Every animation reads one shared clock, and a redraw starts it at
its current phase (a negative delay), so a refresh continues the motion instead of restarting it.
Running, paused and marked stages share one skeleton (glow, bar, sheen); a state flip only
changes classes, and the glow and sheen show only while running.

## Patterns

### Band state and headline

The band resolves its state from the snapshot and the mod's live session state in this order; the
first match wins. `signal` picks the light's colour; live states breathe and show the clock. State 1
still draws the identity row with its `Ledger`, `−` and `×` controls, so the Ledger's Trust tab can
give the reason. A feature route with no change open draws nothing. While a newer turn runs, a
verdict written before that turn started is skipped (rows 12, 13 and 16), so the running stage
leads. The same holds while a stage runs in a live stage agent of the change: nothing is asked of
the person, so a verdict written meanwhile never leads over the running stage. A stage left running
with no live agent still shows its verdict. The verdict words stay as they are in the receipt and
the Ledger. A rule stop is never a
row: Claude handles it, and the Trust tab keeps it as history.

A feature change that is running keeps its band and its recorded lane, even when a new prompt
reads like another workflow or a lower lane; a route written before the prompt just sent belongs
to the previous turn, so the band waits for the fresh snapshot instead of flashing that
workflow's band. An open change with a live stage stays qualified: its card is kept while the
stage agent runs. Flags appear only after their stage has ended, never while it still runs.

| #   | When                                                                             | Signal          | Live | Headline                                                                                                  |
| --- | -------------------------------------------------------------------------------- | --------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| 1   | paqad is on but the session id could not be read, or the snapshot does not parse | attention       | no   | `paqad cannot read this session's record`                                                                 |
| 2   | the route is another workflow                                                    | (workflow band) |      |                                                                                                           |
| 3   | a question is on screen                                                          | attention       | no   | `Waiting for your answer`                                                                                 |
| 6   | a decision packet of this change is pending                                      | attention       | no   | `Waiting for your answer`                                                                                 |
| 7   | a subagent or background task is running                                         | accent          | yes  | `Subagent: <newest task's description>`, with a dim `N finished`; one dim line in the gap line's slot      |
| 9   | the PR was closed                                                                | caution         | no   | `PR #N was closed`                                                                                        |
| 10  | CI failed on the open PR's current head                                          | fail            | no   | `CI failed on PR #N`                                                                                      |
| 11  | the push failed                                                                  | fail            | no   | `The push failed`                                                                                         |
| 12  | the verdict is fail and a judged required gate of the work failed                | fail            | no   | the failure phrase of the first failing required gate, plus ` and N more`                                 |
| 13  | the work is not done and the verdict is inconclusive, or fail with no failing gate the Ledger can name, or a stage ended unproven | caution | no | `Inconclusive: <first reason>` |
| 14  | the paqad work is done and the open PR's CI is pending                           | pass            | no   | `Coding Done: Watching CI`                                                                                |
| 15  | a stage is running                                                               | accent          | yes  | the stage's running words (`Planning the change`, `N of M plan steps built`, `Reviewing the change`, ...) |
| 16  | the paqad work is done (see below)                                               | pass            | no   | `Done` (with a dim `not committed` when the edit is not committed)                                        |
| 18  | a stage is done and one is not yet                                               | idle            | no   | `<last done stage> done. Next: <next mandatory stage>`                                                    |
| 19  | nothing is done                                                                  | idle            | no   | `Next: Plan`                                                                                              |
| 20  | every stage is recorded                                                          | idle            | no   | `Every stage is recorded. Waiting for the verdict.`                                                       |
| 21  | paqad itself could not record part of the change                                 | dim             | no   | `paqad could not record ...` (paqad's gap, not the work's)                                                |

One headline engine, `computeHudHeadline`, picks the row; the mod only renders it.

There is no row for Claude Code's own permission dialog: the plugin directory accepts no mod hook
that reads Claude Code's permission answer, so the HUD cannot see that dialog. A running stage reads
paused only while the person owes it an answer (a pending decision of this change or a question on
screen).

Row 16 `Done` holds once the paqad work is done: no stage is running, every mandatory stage is
complete or redone, the checks are green, a verdict is on record and no judged required gate of
the work fails. Done comes before any commit or push and does not wait for CI: whether the work is
committed, pushed or has an open PR, the headline stays `Done`, and push, PR and CI live in the
delivery rail. While the open PR's CI is pending it reads `Coding Done: Watching CI`. The reasons of gates that were never judged (the fast lane's
implementation review, where no review stage runs) and paqad's own record gaps go to the neutral
gap line as `paqad could not prove ...` or `paqad could not record ...`; they never turn the
headline amber or red. Real failures still win: CI failing on the current head of the open PR
turns the headline red (`CI failed on PR #N`), and a pushed fix whose CI is pending or passes
brings `Done` back. A CI result read for an older head is not current and never raises row 10.

The done ladder keeps its rung for the receipt (`done`, `committed`, `pr-open`), but every rung
reads `Done` on the band, or `Coding Done: Watching CI` (row 14) while the open PR's CI is
pending. There is no merge rung and no merged note: after a merge the rail just names the PR.

The delivery rail follows push and CI by itself. The Stop-time reader marks Push when the branch
upstream or the PR head is HEAD. While an open PR's CI is pending the mod runs
`paqad-ai delivery-link refresh` in the background every 30 s with no back-off, for at most 60 min,
one at a time. When that watch stops without an answer, the gap line adds
`CI updates paused: <reason>`, where the reason is one fixed phrase: `time limit` (60 min ran out),
`signed out` or `offline` (two failed gh reads in a row); a `git push` from this session or a newer
PR head starts it again.

The headline is one line on both surfaces. When it would wrap it is cut to the band width with a
trailing `…`; on Desktop the strip `alt` keeps the whole sentence.

Rows 3, 4 and 6 all read `Waiting for your answer` and win over the subagent title, Done and CI.
Row 7 leads while any subagent or background task from `$.agent.list()` is working: the light
breathes calmly (the live light, no blinking), and one dim line in the gap line's slot says what
the subagents are doing, the newest `session.append` row or `tool.call` that carries an
`agentId`. A text block that starts with `<system-reminder>` is skipped, so a reminder never
shows. `N finished` counts the agents the HUD saw leave the list while this change
was current, kept per change by the mod because the engine gives no start time and drops finished
agents. With nothing running the normal headline and its rows come back.

With paqad off nothing is drawn. The terminal keeps its own headline, except that its idle header
says `Getting ready`.

### Trust tab

The Trust tab shows the proof of the work, stage by stage.

- **Stage heading row**: the stage name as a caption, semibold, dim, capitals, with a right
  footnote state word.
- **Done stage**: a finished stage shows a green `✓` beside the word `Done`. The check carries the
  green and the word stays in the text colour so it reads at full contrast, and done is never told
  by colour alone.
- **Step lines**: a footnote mark then the step: `✓` in default ink, `✕` in red, `○` dim, with a
  dim detail `  ·  N ...`.
- **Gate rows** use Row.
- Then, only when present: the neutral `paqad could not record ...` line, the dim
  `paqad repaired its own record: ...` line, CLAIMS and FLAGS.
- Empty state: `Nothing to prove yet`.

### Strip states

| Stage state                                 | Bar                      | Label     | STAGE value        |
| ------------------------------------------- | ------------------------ | --------- | ------------------ |
| done                                        | green (`pass`)           | green (`passText`) with a `✓` in the same centred run |  |
| running                                     | pink, glow, pulse, sheen | pink 650  | the stage word     |
| running while something waits on you        | coral, no motion         | coral 650 | `<Stage> · paused` |
| marked                                      | amber                    | ink       | why it is marked   |
| failed                                      | red                      | red 650   | `<Stage> failed`   |
| not required                                | dashed faint line        | muted     |                    |
| not yet                                     | faint                    | muted     |                    |

When every drawn stage is done the value is `All stages done`.

| Delivery step state | Node                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| done                | ink ring on a 10% ink disc                                                                                      |
| current             | faint ring, a faint outer ring at r + 3 and a pink arc on it: the CI share when counted, a still 30% arc for CI with no count, else a spinning 30% arc |
| todo, unknown       | faint ring and icon                                                                                             |
| failed, closed      | red ring and icon                                                                                               |

High Table seats: done ink disc; writing pink 22% disc with a 1.4 px pink ring, pulsing; seated a
faint 1.2 px ring; late an amber ring. Chief: waiting a dashed faint ring; ruling a pink dashed ring
spinning; needs answers a coral 25% disc and ring, pulsing; done an ink disc.

## Responsive

- The band's `bodyColumns` runs from 57 to 93 on Desktop; the strip's markup width is
  `round(bodyColumns × 8.5)` with a minimum of 480, and the image scales down to fit the slot.
- Row cost: identity 1, message 1, body line 1, strip 3, so 6 rows in every state, plus 1 while
  the close menu is open. The subagent line takes the body line's slot and adds no row. Below
  that `maxRows` the minimised row is drawn instead; with the menu open and no room, the minimised
  row is drawn with the menu row under it.
- The docked Ledger is about 48 columns wide. Tabs keep their full labels in whole-number widths.
- Nothing on Desktop switches layout at the terminal's 110 columns.

## Accessibility

- Every Svg carries an `alt` that states its facts in words: the live headline says the sentence,
  the note and the clock; the stage section says the headline, the stage value and the finished
  stages (`Plan, Build, Checks done`); the High Table section says its value and seats
  (`High Table: Chief is ruling, 11 seats, 3 shown.`); the delivery section says its value.
- Done never relies on colour alone: the word `Done` and the check mark carry it. `passText` is
  at least 4.5:1 for the 9 px labels and `pass` at least 3:1 for bars and the check glyph.
- Every state is said in words as well as by colour (WCAG 2.1 SC 1.4.1).
- Motion is slow breathing, pulsing, sweeping or spinning at 1.6 s or slower; nothing flashes
  (SC 2.3.1).
- Every control is a native Desktop `Button` or `Link` whose words are its name (SC 4.1.2).
