---
name: dashboard
description: "Claude Code: Open the paqad dashboard, the local web view of this project's rules, evidence, approvals, graph, and trust signals. Use when the user wants to see the project's governance state in a browser."
compatibility: 'Claude Code with a project folder open (needs a shell)'
---

# Open the paqad dashboard

First check where you are running. If there is no shell and no project folder open, reply in one sentence that this works in Claude Code with a project folder open, and stop. Otherwise carry on with the steps below and do not mention this check.

The dashboard is a local web app for this project. It never leaves the machine.

1. Start it and print the address:

   ```
   paqad-ai dashboard --print-url
   ```

   It prints one line, `paqad dashboard: http://127.0.0.1:<port>/`, once the server is listening.

2. Give the user that URL to open, or open it for them if you can.

If a write in the dashboard reports that the project was set up by a newer paqad (HTTP 409), tell the user to update paqad: inside Claude Code run `claude plugin update paqad@eliyce`.

If `paqad-ai` is not found, use `npx paqad-ai` instead.
