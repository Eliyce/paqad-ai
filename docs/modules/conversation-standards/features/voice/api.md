# Short, plain replies: API

This feature has no network or HTTP API and no script of its own. It is a conversation rule held once in `shared/references/voice.md` and copied into
every skill at build time as `references/voice.md` (all 13 skills declare it in
`build/skills.yml`). It has no programmatic interface; the contract is the text the skills consume.

## Contract the skills consume

| Rule | What every reply must do |
|---|---|
| TALK-1 to TALK-7 | Short by default, no explaining unless asked, tables for lists, counts, steps and comparisons, answer first, no narration, plain words with sources on one line at the end, detail on request |
| TALK-8 | Every choice through the host's choice prompt: a few words each, the recommended one first and marked, its reason in one clause; a write-in when there are more choices than the prompt holds; a short list in the reply only when the host has no choice prompt |
| TALK-9 to TALK-12 | Talk like a person, a "How to talk" block at the top of every `SKILL.md`, compact previews, status in one line |
| TALK-13 | A closing question comes last, after the Sources line and the source line |
| TALK-14 | No pause to ask whether to carry on between steps; stop only for a real decision |
| TALK-15 | The record is never offered, named or described; a resume file only when the user asks to stop and come back later |

## How it is checked

| Check | Where |
|---|---|
| "How to talk" block present in each skill | `tests/scripts/test_authoring.py` `VoiceBlockTest` |
| `voice.md` copied into each built skill | `tests/scripts/test_build.py` `BuildOutputTest.test_voice_copied_into_each_skill` |
| TALK-8 and TALK-13 to TALK-15 present in the rule and the skills | `tests/scripts/test_conversation_feedback.py` |
