---
name: discover-probe
description: A test skill that checks whether this host can run skill scripts and which runtime it provides. Run it to confirm the environment before relying on scripted checks. It runs a short script that reports the runtime version, confirms the script executed, performs a write test strictly inside the working folder, and confirms it used only the standard library with no network. When scripts cannot run on this host, it provides an equivalent checklist that performs the same checks by hand so the skill still works everywhere.
---

# discover-probe

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the
answer, plain business words, no narration, tables for lists. Those rules win over everything
else here.

This skill checks two things: whether skill scripts run on this host, and what runtime the host
provides. It is a test skill for proving the environment, not part of the product journey.

## What to do

If you have a tool that can run a script in this working folder, run `scripts/probe.py` with
the host's script runner (for example `python3 scripts/probe.py`). Read its report and relay
the result in a compact table: runtime version, script executed, working-folder write test, and
standard-library-only confirmation.

If you do not have a tool that can run a script on this host, do not stop. Follow the checklist
below by hand. It performs the same checks and produces the same report. The script makes the
checks reliable where it runs; the checklist is the fallback so the skill works everywhere.

## Checklist fallback (same checks, done by hand)

Use this when scripts cannot run. Report each line.

1. Runtime version. State the runtime and version available to you in this environment. If you
   cannot determine it, say so plainly.
2. Execution confirmation. Confirm you are able to carry out steps in this working folder at
   all. If you can read and write files here, the environment is usable.
3. Working-folder write test. Create one small temporary file strictly inside the current
   working folder, read it back, then delete it. Confirm the write and read worked and that the
   file was removed. Write nothing outside the working folder.
4. Standard-library and network. Confirm no outside network call was needed and no capability
   beyond the host's built-in file handling was used.

Report the four results as a short table, then stop. Do not explain how the checks work unless
the user asks.
