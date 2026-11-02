# S7 release

verified: 2026-11-02

`paqad-ai skill release <name>` refuses unless every earlier gate passed or holds an owner override. It recomputes the hash of every input a gate judged and names the stage to rerun when the folder changed since. It refuses while an externally verified fact is older than the freshness limit, naming each fact.

On success it copies the skill into the host skills folder, writes the tracked `evidence.json` and a `CHANGELOG.md` entry, and records `skill-<name>.json` in the change bundle. Rerunning it on the same content changes nothing.

When the draft came from the release target itself (a paqad runtime skill released in place), release copies nothing and leaves that folder untouched, but still writes `evidence.json`, the `CHANGELOG.md` entry and the bundle record. It refuses if that folder changed after S3 drafted it; rerun `paqad-ai skill draft <name> --dir <folder>` and the stages after it.

Overrides come only from an answered override decision: `paqad-ai skill override <name> --gate <gate> --decision <id>`. Ask for one with `--ask "<why>"` when the owner wants to skip a gate or the host has no subagents. The skill is then labelled unverified and stays in this project.

`--portable` also writes a copy for claude.ai or the Skills API, with the Claude Code fields moved under `metadata`, and checks it with quick-validate. An unverified skill, or one with an allowed risky script, gets no portable copy.
