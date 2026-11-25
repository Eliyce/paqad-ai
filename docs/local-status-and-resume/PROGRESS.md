# Local status, resume and housekeeping: progress

The one place that says how far the work in [`REQUIREMENTS.md`](REQUIREMENTS.md) has got. Update it in the same pull request as the work it describes. The next slice to build is the first row, in delivery order, whose status is not **Done** and whose dependencies are all **Done**; [`prompts/build-next.md`](prompts/build-next.md) picks it for you.

**Last updated:** 25 November 2026 (requirements written; nothing built).

## Status words

- **Not started**: no code yet.
- **In progress**: a branch or pull request exists; link it.
- **Done**: merged to `main`, every "Done when" line of the slice met, evidence linked.
- **Blocked**: waiting on an unknown or an owner ruling; say which.

## Slices

| Slice | What it delivers | Requirements | Depends on | Status | Pull request | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | Answers to the four unknowns | U-1 to U-4 | none | Not started | | |
| S1 | Read surface: schemas, samples, declaration, reader rules; readable settings | RS-1 to RS-7, RS-9, CFG-1, CFG-2 | none | Not started | | |
| S2 | Heartbeat with process and boot id, written while the band is hidden | HB-1 to HB-6 | S1 | Not started | | |
| S3 | Housekeeping and `paqad-ai prune` | HK-1 to HK-5 | S2 | Not started | | |
| S4 | Stage checkpoints in local refs | RES-1 to RES-3, RES-7, RES-8 | S1 | Not started | | |
| S5 | Continue after a usage limit | RES-4 to RES-6 | S4, U-1, U-2 | Not started | | |
| S6 | Estimate before a full lane and `paqad-ai estimate` | EST-1 to EST-8 | S1 | Not started | | |
| S7 | Schema export and marketplace target (SHOULD) | RS-8, MKT-1 to MKT-4 | S1 | Not started (owner chooses when) | | |

## Unknowns

| ID | Question | Status | Answer and source |
| --- | --- | --- | --- |
| U-1 | How a usage-limit stop shows itself, and whether the reset time is available | Open | |
| U-2 | What can continue a lane at the reset time without a person | Open | |
| U-3 | How the heartbeat writer learns the agent's process id, and a boot id per platform | Open | |
| U-4 | Checkpoint time on a large repository; ignored files stay out | Open | |

## Owner rulings still open

| Question | Status |
| --- | --- |
| Default numbers in HK-4 and EST-2 | Open |
| Automatic continue (RES-6) on by default | Open |
| When to build S7 | Open |

## Log

- 25 November 2026: requirements v1.0, this tracker and the build prompt added.
