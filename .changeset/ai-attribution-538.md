---
'paqad-ai': minor
---

feat(#538): keep the coding agent's vendor out of your commits and PRs

An onboarded project used to inherit whatever attribution its coding agent adds by default:
Claude Code appends a `Co-Authored-By: Claude` trailer and a PR body line, Cursor appends
"Made with Cursor", and so on. That trailer is what makes a git host list the AI vendor as a
**contributor** on the repository, which is the part an enterprise buyer rejects.

paqad now owns this, behind one floored policy knob: **`ai_attribution`** (`keep` | `strip`,
default **`strip`**). The team value is a floor, so a developer cannot quietly lower it.

Onboarding configures the two providers that expose a project-level switch: Claude Code gets
`attribution: { commit: '', pr: '', sessionUrl: false }` in `.claude/settings.json` (the
current key, never the deprecated `includeCoAuthoredBy`), and Aider gets `attribute-author`,
`attribute-committer` and `attribute-co-authored-by` set false in `.aider.conf.yml`. Both
merge rather than overwrite, so a value the team set by hand survives.

Cursor, Codex, Copilot and Gemini keep their switch in the developer's home directory or an
org policy, which paqad will not write. For those, the delivery check is the backstop: at the
completion seam it scans the branch's commit messages and the PR body and warns once per
vendor found, carrying that vendor's exact fix. It is advisory and never blocks.

paqad's own `Generated with paqad-ai delivery` footer is deliberately untouched by this knob,
and a human colleague's co-author trailer is never matched.
