---
'paqad-ai': minor
---

Tech debt, organization rollout, and the rest of the paqad HUD (closes #645, #620 and #639).

**Problems a change finds but does not fix now have a home (#645).** `paqad-ai debt add` records each one as a `TD-<ULID>` file under `docs/instructions/tech-debt/`, ties it to the change that found it, and lists the open ones on the overview page. Review findings that are out of scope go there instead of being fixed on the spot or forgotten. The receipt, the HUD and the PR body show what the change raised, and `debt list`, `debt promote` and `debt close` keep the list honest.

**One file puts paqad on every machine in your organization (#620).** `paqad-ai managed-settings --write <dir>` writes a Claude Code managed settings file that runs paqad's edit gates through `paqad-ai hook --managed` before every edit. Developers cannot turn it off locally, a repository without `.paqad/` is left alone, and a missing or slow paqad-ai blocks the edit and says how to fix it. The README has a new "Deploy for your organization" section with the folders, the checks and the rollback.

**The plugin has one home.** `Eliyce/paqad-claude-plugin` is now the only plugin and marketplace. Each release builds the plugin here and pushes it there, with its own marketplace file, only after npm publish succeeds. The repository secret `PAQAD_PLUGIN_PUSH_TOKEN` must be able to push to `Eliyce/paqad-claude-plugin` before the first release after this one: a missing token or a failed push now fails the release job instead of skipping quietly. If you added the old `eliyce` marketplace by hand, add `Eliyce/paqad-claude-plugin` instead.

**The HUD answers more questions (#639).**

- A rule stop can be answered once in the HUD: "Let Claude fix it" by default, or "Allow once, recorded", which `paqad-ai rules override` writes to the change's evidence and the receipt shows. A stop your organization enforces is never offered.
- A fix that changes behaviour now needs proof: `paqad-ai fix prove red` before the fix and `fix prove green` after it. Red then green passes; anything less reads Inconclusive with the missing step.
- `delivery.json` says what really ships: the commit the change started from, its own commits, the commits riding along from other tickets, and the push, PR and CI. paqad warns when a branch carries other tickets' work, and `paqad-ai delivery-link commit-decision` records how the commit question was answered.
- The paqad pane gains Trust, Ships and Record tabs, `/paqad receipt` draws a sealed card, decision questions show their evidence, paqad's own commands read as short chips, the spinner names the running stage, the footer names the lane, and the chat skips per-stage lines the HUD already shows.
- `hud_chime=true` plays one short chime when a verdict lands. It is off by default.
