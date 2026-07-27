# paqad-ai — site map index (SAMPLE of the ≤1k-token agent orientation layer)

> Hybrid product: **CLI** + **local dashboard** + **LLM prompt workflows**. Mapped from `main@a7c3a30` (illustrative). 24 surfaces · 3 areas (+1 backstage) · 3 journeys · full map: `app-map.yaml`, journeys: `journeys/`.

**Consult-and-verify rule:** before adding or changing a CLI command, dashboard area, or routed workflow, read the matching section of `app-map.yaml`. Every claim carries `evidence: file:line` — if the evidence no longer matches the code, trust the code and flag map drift (SM finding), never edit around it.

## Where things start (entries)

- **Terminal**: `paqad-ai onboard` (first contact) · `doctor` · `dashboard` · ~17 more commands (registry: `docs/instructions/registries/commands.md`)
- **Agent chat**: any prompt in a connected agent → **router** picks exactly one of 11 workflows (bootstrap: `runtime/AGENT-BOOTSTRAP.md`)
- **Dashboard**: `http://127.0.0.1:5372` — loopback only, requires onboarded project

## Top journeys

1. **Onboard a project** (developer): onboard → doctor → dashboard. Success = agents follow the framework.
2. **Create documentation** (agent, prompted): prompt → router → documentation-update stages → **human map review pause**. Then "create module documentation" continues.
3. **Review trust evidence** (team lead): pulse → trust → export to SIEM.

## Guards that matter

`paqad-enabled` (kill switch, default ON) · `project-onboarded` (dashboard precondition) · `coding-capability` (gates feature-dev/pentest workflows) · dashboard is loopback-only.

## Gotchas an agent cannot infer cheaply

- Routing runs on **every** message and is stateful: switching pauses a workflow, it never resets it.
- Decision pauses surface in **chat and the dashboard Approvals inbox** — a paused workflow resumes only when the packet resolves.
- The Graph area maps **code structure**; this site map is **product behavior** — different questions, different artifacts.

*(Optional tier — drop under token pressure): background district (hooks, background harness), per-workflow stage detail, full command inventory.*
