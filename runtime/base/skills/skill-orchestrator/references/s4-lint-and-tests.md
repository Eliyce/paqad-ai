# S4 lint and tests

verified: 2026-11-02

Run `paqad-ai skill lint <folder>` on the draft. It checks nineteen rules and blocks on generic phrases, capitalised commands, unknown frontmatter keys, secrets, interactive scripts and scripts with no test file. Fix every blocking finding in the draft and rerun `paqad-ai skill draft`.

Write the script tests in the project's own test framework, in `tests/skills/<name>/` (Laravel: `tests/Feature/Skills/<Name>/`). Name one test per contract check, as `<script> <check>`:

| Check          | What it proves                                                    |
| -------------- | ----------------------------------------------------------------- |
| help           | `--help` exits 0 and lists every flag                             |
| invalid input  | a missing or bad input exits non-zero and names what was expected |
| fixture output | each fixture input gives the expected structured output           |
| idempotency    | running twice gives the same result                               |
| dry run        | `--dry-run` changes nothing on disk                               |
| output size    | output stays under the size limit                                 |
| secrets        | no secret value appears in the output                             |

The draft is not released yet, so load the script from the folder in `PAQAD_SKILL_UNDER_TEST` and fall back to the host path.

`scripts/README.md` needs no tests, and neither does a helper listed under its `## Not entry points` section, unless the helper still has a runnable entry point.

`paqad-ai skill test <name>` lints again, scans the scripts for network, package-install and file-delete calls and asks the owner before anything runs, checks the references (named paths and scripts exist, runnable blocks pass, examples tagged `validates=<file>` match that file, each reference carries a `verified:` or `human-verified:` date), then runs the project's own test command.
