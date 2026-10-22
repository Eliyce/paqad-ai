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
| `ink`           | `#6E7D86`                          | `#C2CBD0`                     | done marks, Svg values                                                                          |
| `muted`         | `#8E979D`                          | `#97A1A7`                     | Svg caps and labels                                                                             |
| `faint`         | `muted` at 30% (fill)              | same                          | not yet                                                                                         |
| `faintStroke`   | `muted` at 45% (stroke)            | same                          | not-yet rings, dashed not-required lines                                                        |
| `hair`          | `muted` at 28%                     | same                          | dividers, rules, hairlines                                                                      |
| `accent`        | `#F90093` (paqad vivid pink)       | same                          | running, the shown tab                                                                          |
| `attention`     | `#F37748` (paqad coral)            | same                          | waiting on you only: a question, a permission, a pending decision, and the stage paused for it |
| `caution`       | `#C98A1B`                          | `#E3B04B`                     | needs a look: flags, marked stages, a late seat, inconclusive or skipped gates, PR closed      |
| `pass`          | `#2F8F6B`                          | `#5FC29C`                     | pass, all green, ready to merge                                                                 |
| `fail`          | `#D23B3B`                          | `#F08080`                     | fail                                                                                            |
| `onSignal`      | `#FFFFFF`                          | same                          | only on a solid signal: the ready node's icon, the High Table badge numbers, the running sheen |
| `PX_PER_COLUMN` | `8.5`                              |                               | strip width = `bodyColumns × 8.5`                                                               |
| `BREATH`        | alpha suffixes `FF CC 8C 66 8C CC` |                               | the live light, one step per 400 ms tick                                                        |

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

## Components

### Band card

Three rows in `Box flexDirection="column" rowGap="xs"`, nothing around them.

- **Identity row** (`Box` row, `alignItems="center"`, `columnGap="sm"`): one `Text` with `paqad`
  (semibold) and a dim footnote run of the parts that apply, joined by `  ·  `: the workflow, the
  lane (`Fast lane`, `Graduated lane`, `Full lane`), the change chip, and the cost
  (`<tokens> tokens · ~$<usd>`, `<tokens> tokens · whole session`, or
  `<tokens> tokens so far · ~$<usd>` while the turn is still being counted). Then `Box flexGrow`,
  then, only with open flags, an amber `⚑` `Text` and a plain dim `N flag(s)` Button, then the
  bordered dim `Ledger` Button and the plain dim `−` and `×` Buttons.
- **Message row**: one `Text wrap="truncate-end"`: `●` (heading size, the signal colour) + the
  headline (heading, semibold) + on live states a dim footnote clock `m:ss`.
- **Strip**: one plain-image `Svg`, no width or height props, markup width
  `round(bodyColumns × 8.5)` with a minimum of 480, height 52. Caps baseline 9, marks centre 25,
  labels baseline 47.
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
  - HIGH TABLE (only when the table sat): seats r 4, spaced at most 22 px, initials under each
    (`SA IA DO PO AA UF QA`, or the first letters of other roles), a 12 px hairline, then the chief
    r 5 labelled `CA`.
  - DELIVERY: one round node (r 8.5, the git icon at scale .625, stroke 1.9) per step of the
    delivery plan (Edit, Commit, Push, PR, CI, Merge as they apply), spacing capped at 96 px, inset
    12 px from both section edges. Edit is current while a file is being edited or any edit stage
    (Build, Checks, Docs) runs, and done once one of them has finished. Connectors run between circles only, 4 px clear of each, 1.2 px
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
`   Hidden`; `Box flexGrow`; plain dim `Show`. When something waits on the person (a question, a
permission or a pending decision) the words become coral `● Needs you`. `Show` reopens and
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
on Trust; the brand text and the strip image are not pressable.

- **Subtitle**: dim footnote `What happened, with proof  ·  <change chip>`.
- **Tabs**: a row of equal Boxes, each `${Math.floor(100 / n)}%` wide, holding a plain Button with
  the full label, dim unless shown, over one tab rule Svg (2000 × 2, `preserveAspectRatio="none"`,
  `height={2}`): a 1 px hair line and a 2 px pink segment 60% of the tab's width centred under the
  shown tab. Order Trust · High Table · Delivery · Record · Cost; High Table is left out when the
  table did not sit.
- **Heading**: `Text size="caption" weight="semibold" dimColor`, capitals, `marginTop={1}`.
- **Row**: a `Box` column: a row with a left `Box flexGrow` (label in body, an optional dim footnote
  under it) and a right verdict word (footnote, weight medium: green `Pass`, red `Fail`, amber
  `Open`, pink `writing…`, dim for the rest), then a hairline Svg (2000 × 1, `height={1}`).
- **Light**: one `Text` of `●` (heading, signal colour) + title (heading, semibold), then a dim
  footnote reason.
- **Gate ring**: 92 × 92, one arc per gate. Required gates are 5 px round-capped arcs (green pass,
  red fail, amber inconclusive or did not run, `faintStroke` not judged); not required gates are
  2 px dashed faint arcs. The centre reads `passed/required` (19 px semibold ink) over `REQUIRED`
  (8.5 px muted).
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
| Live light (band, minimised, workflow band)    | the `●` colour cycles the `BREATH` alpha suffixes, one step per tick (2.4 s cycle)                   |
| Live clock                                     | re-rendered each tick, in whole seconds                                                              |
| Running stage                                  | opacity pulse 1.6 s, a 5 px glow from .55 to .15, a sheen sweep 2.2 s on `cubic-bezier(.4,0,.2,1)` |
| Writing seat, chief needing answers            | opacity pulse 1.6 s                                                                                  |
| Chief ruling, delivery running without a count | rotation 4 s linear (`transform-box: fill-box`)                                                      |
| CI arc                                         | its length is the share of jobs done, updated on refresh                                             |
| CI job running                                 | an indeterminate pink sheen sweeping a 30% segment, 2.2 s                                            |
| Ready to merge                                 | green glow opacity .5 to .15, 2.4 s                                                                  |

One `tick` state atom is advanced every 400 ms by a `$.clock.every` timer that also sets the `now`
atom from `$.clock.now()`. It runs only while a live state is drawn and stops when none is. The
1.5 s snapshot ticker is separate and unchanged.

## Patterns

### Band state and headline

The band resolves its state from the snapshot and the mod's live session state in this order; the
first match wins. `signal` picks the light's colour; live states breathe and show the clock. State 1
still draws the identity row with its `Ledger`, `−` and `×` controls, so the Ledger's Trust tab can
give the reason. A feature route with no change open draws nothing. While a newer turn runs, a
verdict written before that turn started is skipped (rows 12, 13, 16 and 17), so the running stage
leads; the verdict words stay as they are in the receipt and the Ledger. A rule stop is never a
row: Claude handles it, and the Trust tab keeps it as history.

| #   | When                                                                             | Signal          | Live | Headline                                                                                                  |
| --- | -------------------------------------------------------------------------------- | --------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| 1   | paqad is on but the session id could not be read, or the snapshot does not parse | attention       | no   | `paqad cannot read this session's record`                                                                 |
| 2   | the route is another workflow                                                    | (workflow band) |      |                                                                                                           |
| 3   | a question is on screen                                                          | attention       | no   | `Waiting for your answer`                                                                                 |
| 4   | a permission prompt waits for a person                                           | attention       | no   | `Waiting for your permission`                                                                             |
| 5   | the chief ruled and has open expert-conflict decisions                           | attention       | no   | `The chief architect has N questions for you`                                                             |
| 6   | other decisions pending                                                          | attention       | no   | `N decision(s) are waiting for you`                                                                       |
| 7   | the PR is merged                                                                 | pass            | no   | `PR #N is merged`                                                                                         |
| 8   | everything is green                                                              | pass            | no   | `PR #N is ready for your merge`                                                                           |
| 9   | the PR was closed                                                                | caution         | no   | `PR #N was closed`                                                                                        |
| 10  | CI failed                                                                        | fail            | no   | `CI failed on PR #N`                                                                                      |
| 11  | the push failed                                                                  | fail            | no   | `The push failed`                                                                                         |
| 12  | the verdict is fail                                                              | fail            | no   | the failure phrase of the first failing required gate, plus ` and N more`                                 |
| 13  | the verdict is inconclusive                                                      | caution         | no   | `Inconclusive: <first reason>`                                                                            |
| 14  | CI is running on the change's PR                                                 | accent          | yes  | `Watching CI on PR #N`                                                                                    |
| 15  | a stage is running                                                               | accent          | yes  | the stage's running words (`Planning the change`, `N of M plan steps built`, `Reviewing the change`, ...) |
| 16  | the verdict is pass and the commit was declined                                  | pass            | no   | `Done: the edit is in your working tree`                                                                  |
| 17  | the verdict is pass                                                              | pass            | no   | `Safe to merge`                                                                                           |
| 18  | a stage is done and one is not yet                                               | idle            | no   | `<last done stage> done. Next: <next mandatory stage>`                                                    |
| 19  | nothing is done                                                                  | idle            | no   | `Next: Plan`                                                                                              |
| 20  | every stage is recorded                                                          | idle            | no   | `Every stage is recorded. Waiting for the verdict.`                                                       |

With paqad off nothing is drawn. The terminal keeps its own headline, except that its idle header
says `Getting ready`.

### Strip states

| Stage state                                 | Bar                      | Label     | STAGE value        |
| ------------------------------------------- | ------------------------ | --------- | ------------------ |
| done                                        | ink                      | ink       |                    |
| running                                     | pink, glow, pulse, sheen | pink 650  | the stage word     |
| running while something waits on you        | coral, no motion         | coral 650 | `<Stage> · paused` |
| marked                                      | amber                    | ink       | why it is marked   |
| failed                                      | red                      | red 650   | `<Stage> failed`   |
| not required                                | dashed faint line        | muted     |                    |
| not yet                                     | faint                    | muted     |                    |

When every drawn stage is done the value is `Delivered` once merged, else `All stages done`.

| Delivery step state | Node                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| done                | ink ring on a 10% ink disc                                                                                      |
| current             | faint ring, a faint outer ring at r + 3 and a pink arc on it: the CI share when counted, else a spinning 30% arc |
| todo, unknown       | faint ring and icon                                                                                             |
| failed, closed      | red ring and icon                                                                                               |
| ready               | solid green disc, `onSignal` icon, a soft green glow                                                            |

High Table seats: done ink disc; writing pink 22% disc with a 1.4 px pink ring, pulsing; seated a
faint 1.2 px ring; late an amber ring. Chief: waiting a dashed faint ring; ruling a pink dashed ring
spinning; needs answers a coral 25% disc and ring, pulsing; done an ink disc.

## Responsive

- The band's `bodyColumns` runs from 57 to 93 on Desktop; the strip's markup width is
  `round(bodyColumns × 8.5)` with a minimum of 480, and the image scales down to fit the slot.
- Row cost: identity 1, message 1, strip 3, so 5 rows, plus 1 while the close menu is open. Below
  that `maxRows` the minimised row is drawn instead; with the menu open and no room, the minimised
  row is drawn with the menu row under it.
- The docked Ledger is about 48 columns wide. Tabs keep their full labels in whole-number widths.
- Nothing on Desktop switches layout at the terminal's 110 columns.

## Accessibility

- Every Svg carries an `alt` that states its facts in words: the strip says the headline, the stage
  value and each section's value; the gate ring says `N of M required gates pass`.
- Every state is said in words as well as by colour (WCAG 2.1 SC 1.4.1).
- Motion is slow breathing, pulsing, sweeping or spinning at 1.6 s or slower; nothing flashes
  (SC 2.3.1).
- Every control is a native Desktop `Button` or `Link` whose words are its name (SC 4.1.2).
