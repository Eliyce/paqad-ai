# Being bundled by another plugin: progress

The one place that says how far the work in [`REQUIREMENTS.md`](REQUIREMENTS.md) has got. Update it in the same pull request as the work it describes. The next slice to build is the first row of the Slices table, in delivery order, whose status is not **Done** and whose dependencies are all **Done**.

**Last updated:** 26 November 2026 (requirements written; nothing built).
**Priority:** a launch blocker for any product that bundles paqad (research D131). The research design is frozen (research D163), so build from these rulings without reopening them.

## Status words

- **Not started**: no code yet.
- **In progress**: a branch or pull request exists; link it.
- **Done**: merged to `main`, every "Done when" line met, evidence linked.
- **Blocked**: waiting on an unknown or an owner ruling; say which.

## Requirements

| # | Requirement | IDs | Owner | Status | Research ref | Pull request | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Display name for every person-facing word | NAME-1 to NAME-5 | paqad | Not started | D123, D131 item 1 | | |
| 2 | Bundling plugin's id in the project's host settings | PID-1 to PID-4 | paqad | Not started | D131 item 2 | | |
| 3 | Agent name prefix from a setting | AGT-1 to AGT-4 | paqad | Not started | D131 item 3 | | |
| 4 | Framework path resolved on every machine; loud warning when missing | FW-1 to FW-5 | paqad | Not started | D131 item 4, D146 | | |
| 5 | Codex hooks point into the bundle's own folder | CDX-1 to CDX-3 | paqad | Not started | D131 item 5 | | |
| 6 | Self-update off inside a bundle | UPD-1 to UPD-3 | paqad | Not started | D132, D146 | | |
| 7 | Version managed by the host product | VER-1 to VER-4 | paqad | Not started | D146 | | |
| 8 | Generic hint when another product manages the project | HINT-1 to HINT-4 | paqad | Not started | D131, D144 | | |
| 9 | Release notes say when a release is major | REL-1 to REL-3 | paqad | Not started | D162 | | |

## Slices

| Slice | What it delivers | Requirements | Depends on | Status |
| --- | --- | --- | --- | --- |
| B0 | Answers to the unknowns; the bundle config settled | U-1 to U-3 | none | Not started |
| B1 | Display name | NAME-1 to NAME-5 | B0 | Not started |
| B2 | Plugin id and agent prefix | PID-1 to PID-4, AGT-1 to AGT-4 | B0 | Not started |
| B3 | Framework path and Codex hooks | FW-1 to FW-5, CDX-1 to CDX-3 | B0, U-1, U-2 | Not started |
| B4 | Self-update off and managed version | UPD-1 to UPD-3, VER-1 to VER-4 | B0 | Not started |
| B5 | Hint and committed marker | HINT-1 to HINT-4 | B2 | Not started |
| B6 | Major releases marked in the notes | REL-1 to REL-3 | none | Not started |

## Unknowns

| ID | Question | Status | Answer and source |
| --- | --- | --- | --- |
| U-1 | How hooks and the agent entry file learn where the bundling plugin is installed on each host | Open | |
| U-2 | Whether Codex gives plugin hooks a stable, versioned root folder | Open | |
| U-3 | Which person-facing strings live outside `src/` | Open | |

## Owner rulings still open

| Question | Status |
| --- | --- |
| Does paqad used alone also get the loud warning instead of the silent fallback | Open |
| Casing of the default name ("Paqad" or today's "paqad") | Open |
| Name and place of the bundle config and the committed marker | Open |

## Context, not to build

- The read surface (S1) and heartbeat (S2) in [`../local-status-and-resume/PROGRESS.md`](../local-status-and-resume/PROGRESS.md) are no longer launch blockers for host products (research D99, shrunk by D123).
- `hud.band` through `config set` is no longer needed (research D88, superseded by D123).
- paqad's own Codex plugin, `Eliyce/paqad-codex-plugin`, is still planned for people who use paqad alone (research D96).
- `.paqad/` paths stay as they are (research D130).

## Log

- 26 November 2026: requirements v1.0 and this tracker added.
