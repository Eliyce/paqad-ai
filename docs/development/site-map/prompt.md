# Site Map Rebuild: session prompt

Paste the block below into a fresh session, unchanged, every time you want to continue this
work. It is the same prompt every time. The session works out where it is from
`progress.md`, so you never have to remember or edit anything.

---

## The prompt

```
Continue the site-map rebuild in this repository.

Read these first, in this order (the rules you must follow are below, already in this prompt):
  1. docs/development/site-map/progress.md   (where the work stands, and the next action)
  2. docs/development/site-map/plan.md, these parts, every session:
       - §1 Rules of engagement, §4 Repository conventions, §8 Things that will bite you.
         These are cross-cutting and short. A pasted session is always a fresh first commit,
         so read them every time; this is where mistakes happen.
       - §5 The one open decision, only when your task is S3.
       - the section for the single task progress.md names as next, and only that task.

Then do exactly ONE task from the plan: the one progress.md names as the next action.
Not two. Not "while I'm here". One task, one commit, then update progress.md.

Rules that are not negotiable:

- ONE branch for the whole rebuild: feat/site-map-rebuild, created from a freshly fetched
  origin/main. ONE pull request against main. If the branch does not exist yet, create it.
  If the PR is not open yet, open it after the first commit. Never force-push, never rebase
  after the PR is open.
- Small commits. Use the exact commit message the plan gives for that task, including the
  task id, for example: fix(rules): recompile the rule store when it goes stale (S1)
- Every commit must leave the repo green. Run `pnpm run ci` before you push. Never run two
  test suites at the same time: concurrent runs report fake failures with impossible timings.
- Before your first edit, record the stages. This work is feature-development, so paqad will
  not let you edit code until planning and specification are recorded with real artifacts.
  Run `export SE_SESSION=$CLAUDE_SESSION_ID`, then follow plan.md §4: `stage start planning`
  -> `plan compile` (its template needs a `reuse` section) -> `stage end planning`, and the
  same for specification (`spec freeze` on a spec with `## Functional requirements` and
  `- INV-1:` entries, colon included). Narrate a `paqad` line as you enter each stage.
- This PR is releasable, so it needs a changeset. If `.changeset/` has no entry for this
  rebuild yet, run `npx changeset` once (a `minor` bump summarising the whole rebuild), commit
  it with your task, and check `npx changeset status`. Add it early, never at the end.
- Satisfy every numbered acceptance criterion for the task. They are the specification.
  Write the test the criterion describes, then make the code pass it. Do not write a test
  that merely asserts what the code already does.
- Coverage floors: 95% repo-wide, 100% for src/stage-evidence/**. Every new branch needs a
  test, so do not add an unreachable branch "for safety".
- Do not refactor code the task does not name. Do not add a dependency. Do not change public
  API shapes, config defaults or exit codes unless the task says to. If you find a real
  problem outside the task, write it under "Found on the way" in progress.md and keep going.
- If a task cannot be finished as written, finish every part that can be done, then write
  plainly in progress.md what you could not do and why. Do not quietly narrow the task, and
  never fabricate a passing run, a coverage number, or evidence.

When you are done with the task:

- Update progress.md: set the task to done with its commit hash, tick any defect now fully
  closed, and rewrite "State of play" so the next session knows the single next action.
- Speak the paqad end-of-change receipt in your final message: the verdict in the contract
  words (Safe to merge / Needs your attention / Inconclusive), then one line per stage with
  its honest evidence state.

Before you start, tell me in three lines: which task you are doing, what it will change, and
anything in the plan that looks wrong or ambiguous to you. Then go.
```

---

## Notes for the human pasting this

- **Nothing to edit.** The prompt is identical every session. The state lives in
  `progress.md`.
- **If a session ends mid-task**, the next paste picks it up: `progress.md` will say
  `in progress` and the next-action line will say what remains. If the previous session
  forgot to update `progress.md`, run `git log --oneline feat/site-map-rebuild` to see what
  actually landed, and fix `progress.md` before continuing.
- **DEC-1 blocks S3 only.** Everything else can proceed while it is open. When the session
  reaches S3 with DEC-1 unresolved, it will raise the packet and ask you. Answering it once
  is enough; the answer is recorded in `.paqad/decisions/resolved/` and committed.
- **Expect the framework to gate the first edit.** The session must record its planning and
  specification stages before it can edit code, and the very first edit on a clean tree scans
  the whole tree and can block on unrelated pre-existing violations. Both are covered in
  `plan.md` §4 and §8. A session that gets stuck there should read those sections rather than
  improvising.
- **If a session proposes doing several tasks at once, say no.** The whole point of the
  one-task rule is that each commit stays reviewable and the branch never ends up in a state
  nobody can reason about.
- **Reviewing as you go:** after each session, `git log --oneline` on the branch should read
  as a clean list of task ids in plan order. If it does not, something skipped ahead.
