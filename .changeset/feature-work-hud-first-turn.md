---
'paqad-ai': patch
---

Feature work now shows as feature work from the first message.

A prompt like "develop issue 830, do not create a PR" no longer routes to a question, and any message that starts with "develop" counts as a code request, the same as "add" and "fix". The first prompt of a session now tells the agent how the hook routed it, so a wrong guess gets corrected, and opening a change moves the session to feature development.

While no change is open yet, the Desktop HUD shows `Paqad Getting Ready` with every stage grey instead of an empty band or a Question pill. The terminal says the same on one line. A leftover turn from an earlier message no longer blanks the band.

A change is now judged only on its own files. Rule and duplication findings in files it never touched no longer fail it, and a change with no edits at all is no longer held at the end of a turn. A change that has done real work is still judged in full.
