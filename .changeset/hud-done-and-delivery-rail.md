---
'paqad-ai': patch
---

The HUD now says Done, in green, as soon as paqad's work on a change is done: every stage finished, checks green and a verdict on record. It no longer waits for a commit, a push, a pull request or CI, and paqad's own record gaps show as a quiet note instead of holding Done back. CI failing on the pull request still turns the headline red, and a pushed fix brings Done back.

The delivery rail now follows your push and CI by itself. Push is marked when your branch's upstream or the pull request head matches your latest commit. While an open pull request's CI is pending, the HUD runs a new read-only command, `paqad-ai delivery-link refresh`, in the background with your own `gh` login: after 30 seconds, then less often, for at most an hour. If it has to stop early, the HUD says why.

Merging is yours, so the HUD no longer shows a Merge step, a ready glow or a "Safe to merge" headline. A merged pull request shows as a quiet "PR merged" note. The receipt's verdict words and the delivery policy are unchanged.

Finished stages now turn green with a check mark, and the stage strip glows green once, for about two seconds, when the last stage finishes. Reopening the HUD never replays it, and reduced motion turns it off.
