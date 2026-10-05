# Check documents and tracker are ready: business

## Overview

Step 0 of the idea journey. Before any drafting effort is spent, the plugin confirms it can read the project's documents, that the project is onboarded, and that the tracker can be written to. It then reads how the tracker project is set up (issue types, required fields, link types, size and sprint fields) so later steps match it. It runs only when the journey directs it.

## User Roles

| Role | What they do here |
|---|---|
| Business user | Makes the documents available and switches on the tracker connector |
| Engineering team | Onboards the repository if it is not yet set up |
| Tracker or workspace admin | Fixes connector or permission problems; the plugin never handles credentials |

## User Flows

| Step | What happens |
|---|---|
| 1 | The plugin reads the documents directly if it can; otherwise it asks the user to attach the repository or the docs folder, asking for the smallest set needed when it is large. |
| 2 | It checks the project is onboarded. If not, it stops with the onboarding message. |
| 3 | It checks the tracker connector can create issues in the target project and that the user is allowed to. |
| 4 | It reads the project's issue types, required fields, link types, and the size and sprint field ids. |
| 5 | It warns once that every created issue will carry a run label and that these labels build up in the site's label list. |

## Business Rules

| Rule | Detail |
|---|---|
| Onboarded check | Needs the module registry and at least one module summary (GRD-1). |
| By capability | The plugin uses whatever reading ability the host has, never a host-specific step (PLG-7, GRD-3). |
| Stop early | If the tracker cannot be written to, stop before drafting and offer the export fallback (PUB-7, PUB-8). |
| Discover, don't assume | Tracker setup is read from the project, never hard-coded; action names are resolved from what the connector offers (PUB-1). |
| No credentials | Login, connector authorization and admin approval stay with the user or their admin. |
| Read only | Never edits the repository; never reads runtime state, the rules folder, secrets or environment files. |
| Label warning once | The run-label warning is given once, here (PUB-4). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| The journey starts | Fills the setup part of the record; no tracker write |

## Error States

| Situation | What the user sees |
|---|---|
| Project not onboarded | "This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back." Nothing drafted (AC-1). |
| Connector not switched on | Plain explanation, who usually fixes it, export offered (AC-2) |
| Connector has read tools only | Same as above |
| No permission to create issues in the project | Same as above; no specific admin scope is asserted |

## Glossary

| Term | Meaning |
|---|---|
| Connector | The host's link to the tracker (for example Jira) |
| Run label | A label made from the run id in lowercase, added to every created issue |
| Export fallback | Downloading the approved tickets as Markdown or a CSV for the tracker's importer |

Sources: skills/get-connected/SKILL.md, skills/get-connected/references/connect-repository.md, skills/get-connected/references/connect-tracker.md
