---
name: discover-read
description: A test skill that checks whether this host can read repository files on demand. It reads a known document path from the attached project and echoes one fact back with its source, proving the read-by-capability path. When no file-reading tool is available, it asks the user to attach the docs folder instead. Use it to confirm the host can reach project documentation before relying on grounded answers.
---

# discover-read

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the
answer, plain business words, no narration, one short sources line at the end. Those rules win
over everything else here.

This skill checks one thing by capability: whether this host can read repository files on
demand. It is a test skill for proving the environment, not part of the product journey. It
carries no script.

## What to do

If you have a tool that reads repository files, read
`docs/instructions/registries/modules.md` and echo one module name back with its source path on
a short sources line. Keep the reply to that one fact.

Otherwise, ask the user to attach the `docs/` folder to the chat or project, or to upload it as
files or a zip, then read the same path once it is available. Ask for the smallest set that
answers the check when the whole folder is large.

Work only from what you actually read. If the file is not available, say so plainly and name
what you need, rather than guessing a module name.
