---
'paqad-ai': patch
---

The HUD now says Done, in green, as soon as paqad's work on a change is done: every stage finished, checks green and a verdict on record. It no longer waits for a commit, a push or a pull request. While the pull request's CI runs it reads "Coding Done: Watching CI". CI failing on the pull request's current head still turns the headline red, and a green run brings Done back. paqad's own record gaps show as a quiet note instead of holding Done back, and a change that loaded its rules no longer shows a false "could not record that the rules were loaded" note.

The headline stays on one line, cut with "…" to the band width. It reads "Waiting for your answer" whenever a decision for this change is pending, or the chat is asking you something or waiting for a permission.

While a subagent or background task runs, the band shows "Subagent:" and its task, with a calm breathing light, up to two lines of what it is doing (newest on top), and how many subagents finished on this change. With nothing running the normal headline comes back.

The delivery rail now follows your push and CI by itself. Push is marked when your branch's upstream or the pull request head matches your latest commit. While an open pull request's CI is pending, the HUD runs a new read-only command, `paqad-ai delivery-link refresh`, every 30 seconds for at most an hour, with your own `gh` login. If it stops early, the note says why: time limit, offline or signed out. A new push starts it again.

Merging is yours, so the HUD no longer shows a Merge step, a ready glow, a "Safe to merge" headline or a merged note. The receipt's verdict words and the delivery policy are unchanged.

Finished stages now turn green with a check mark, and the stage strip glows green once, for about two seconds, when the last stage finishes. Reopening the HUD never replays it, and reduced motion turns it off.
