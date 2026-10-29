---
'paqad-ai': patch
---

The HUD mod passes the Claude plugin directory check again: no name spelled like a hook parameter is bound outside the hooks, and a test keeps it that way. A new session no longer takes over a change that another session is running a stage in. A bare `stage start` then stops, names that change and the running stage, and tells you to pass `--title` to open your own change. When you switch branches, the change from the other branch is set aside instead of receiving your rows, and it is picked up again when you switch back. A change whose pull request was merged, including a squash merge, now closes as done at the next session start, unless a stage is still running in it. The HUD quiet line, which tells the agent to skip its stage lines, only appears when the HUD actually shows a change.
