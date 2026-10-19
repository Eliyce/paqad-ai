---
'paqad-ai': minor
---

The paqad plugin for Claude Code now shows where your change stands, in a band above the prompt (#639). One line says what just happened and what comes next. Under it, the Stage row shows the eight stages from Intake to Deliver with a live clock on the one that is running, and the Ship row shows Edit, Commit, Push, PR, CI and Merge. Merge always stays yours. The band says one of nine states in words: Ready, Working, Branch warning, Needs you, Stopped, Inconclusive, Safe to merge, Needs your attention or Paused. Any open flag turns it amber, even at Safe to merge, and a pill counts the flags. Anything paqad has no record of yet reads "not yet", including the cost pill.

Type `/paqad` for the same picture as text, or `/paqad status`, `/paqad decisions`, `/paqad rules`, `/paqad receipt` or `/paqad cost`. They answer from paqad's own records and cost no model turn.

The band only shows. Every check is still one of paqad's hooks, and they block exactly as before whether the band is on, off or broken. It reads only `.paqad/`, never calls a model or the network, and starts no process.

It is on by default. To turn it off, set the plugin's `view` option to false in `/config`. It also stays away when the project was never onboarded, when paqad is turned off, in a cloud session, and on Claude Code older than 2.1.301.

The change's bundle now keeps each rule finding in `rule-run.jsonl` and each near-copy in `duplication.jsonl`, and the band counts the open ones in its flag pill.
