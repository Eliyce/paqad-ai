# paqad-ai update: API View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `update`

## CLI

```
paqad-ai update [--project-root <path>] [--silent] [--json]
paqad-ai update --last [--json] [--project-root <path>]
```

`update` migrates the `.paqad/` layout forward, regenerates the framework-managed files, refreshes the tracked config files, writes the framework version, refreshes the managed blocks of `.paqad/.gitignore` and `.paqad/.gitattributes` and the `.paqad/.config` line of `.worktreeinclude`, and prints a short summary: the versions, each file it changed, how many files it kept, any personal settings it removed, then the team setup and migration notes. The summary never holds file text, because a report with every kept file's text ran past 100 KB on a real project.

With `--json` it prints only the report below as JSON, and the notes are inside that report. With `--silent` it prints nothing, and `--silent` wins over `--json`. A successful run appends the `INFO` line to `.paqad/audit.log`; a failed silent run appends the `WARN` line:

```
[<ISO time>] INFO silent-update previous=<version or unknown> updated=<version>
[<ISO time>] WARN silent-update-failed previous=unknown target=<version> error="<message>"
```

A silent run that fails exits 1 after the `WARN` line. A silent run that succeeds also gives the Claude Code plugin move a chance to run (`maybeMigrateToPlugin`); that step never fails the update. Without `--silent` an error is not caught, so the CLI prints it and exits non-zero.

## `paqad-ai update --last`

`--last` shows what the last background update did. It reads `.paqad/state/last-update.json`, then `.paqad/state/last-update.seen.json`, and skips a file it can't read or that fails validation. It prints the same lines as a manual run, with one exception: the `Kept N files` line points to `paqad-ai update --last --json`, because `update --json` starts a new update. With no record it prints `No background update to report.` and exits 0.

With `--json` it prints the record, or `{"last_update":null}` when there is none.

`--last` only reads. It never runs an update, changes no file, adds no audit line and doesn't mark the record as seen, so the next session still mentions the update once.

## The record of a background update

A `--silent` run writes `.paqad/state/last-update.json` when it changed a file, has a note in either list, or pruned a setting. A run that only kept files, a run with nothing to report and a failed run write none. Both record files are git-ignored through the managed `.paqad/.gitignore` block.

```ts
export interface LastUpdateRecord {
  previous_version: string | null;
  target_version: string;
  changed_files: string[];
  skipped: string[];
  config_keys_pruned: string[];
  team_setup_notes: string[];
  git_workflow_notes: string[];
  updated_at: string;
}
```

`skipped` holds paths only. If an unseen record exists, a new silent run keeps its `previous_version`, takes the newer target and unions the lists.

At the next session start, the `agent-entry-session-start` hook renames the record to `last-update.seen.json` and adds one line to the session context. A `compact` session shows nothing and leaves the record unseen. The line takes one of these forms, with `1 file` for a count of one and `has notes for you` in place of `changed <n> files` when no file changed:

```
paqad updated itself from <old> to <new> and changed <n> files. Tell the developer, and run paqad-ai update --last to see the details.
paqad refreshed its files on <new> and changed <n> files. Tell the developer, and run paqad-ai update --last to see the details.
paqad updated itself to <new> and changed <n> files. Tell the developer, and run paqad-ai update --last to see the details.
```

## Lines the update output can hold

```
Removed an old copy of paqad's <stage> instruction from feature-development/workflow.yaml: <first 60 characters>
Removed an old copy of paqad's <stage> read path from feature-development/workflow.yaml: <first 60 characters>
<file>: <setting> was <value>, which this check doesn't have any more, so it is now <replacement>.
Removed .paqad/configs/feature-development/safety.yaml, which paqad doesn't read any more.
.paqad/configs/feature-development/safety.yaml holds notes your team wrote, so it stayed. paqad doesn't read it any more.
<file> was written by a newer paqad, so it wasn't changed. Update paqad-ai.
<file> still mentions <path>, which paqad removed. Update that line by hand.
Commit <files> together so your teammates don't repeat this change. This happens once. Everyone needs this version or newer, including the plugin inside sessions.
Your git hooks are in <dir>, which your repo tracks, so paqad didn't change them.
Add these lines to commit-msg and pre-push so people get the workflow check:
<the lines for each file>
The check is skipped in a terminal where paqad-ai is not on the PATH.
```

The `Commit` line prints on the run that swaps `paqad_version` for `schema_version` and names the files plus the git-workflow record.

An update on a project already on 1.119.0 doesn't remove the duplicate comment or the changed-outside warning. `paqad-ai git-workflow check --accept` clears the warning, once the team agrees. `paqad-ai config set` still re-renders the file it writes.

## `src/update/updater.ts`

```ts
export interface UpdateDiff {
  path: string;
  before: string;
  after: string;
}

export interface UpdateReport {
  previous_version: string | null;
  target_version: string;
  regenerated: string[];
  changed_files?: string[];
  skipped: UpdateDiff[];
  deprecated: string[];
  new_mcp_servers: string[];
  new_scripts: string[];
  config_keys_pruned: string[];
}

export class FrameworkUpdater {
  constructor(options?: {
    generateCandidates?: (projectRoot: string) => Promise<GeneratedFile[]>;
  });
  run(projectRoot: string): Promise<UpdateReport>;
}
```

`changed_files` lists what the run changed outside `regenerated`: the manifest, `.paqad/.config.example`, the configs README, team config files, git-workflow files, team setup files, `.paqad/.gitignore`, `.paqad/.gitattributes`, `.worktreeinclude`, the rule-script map, `.paqad/capability-lock.json`, `.paqad/schema-version.json` and removed files. `.paqad/framework-version.txt` and the git-ignored `settings.local.json` don't count. `Changed <n> files:`, `--last` and the session line all count `regenerated` and `changed_files` together, without repeats.

A file whose bytes already match what paqad would write is not written and appears in neither `regenerated` nor `skipped`, so a run changes no modified time and doesn't invalidate a running session's entry check. An executable file still gets its mode. `skipped` lists a file whose manifest entry says `auto_update: false` and whose bytes differ, with the bytes on disk and the bytes paqad would have written. `new_scripts` lists files under `scripts/` that did not exist before. `config_keys_pruned` lists the keys removed from `.paqad/configs/.config.*` because this version no longer knows them. `deprecated` and `new_mcp_servers` are always empty.

When the Claude Code plugin is installed, the Claude hook files the plugin owns are left out of `regenerated`. When the checkout was stamped by a newer paqad, the config files and the ignore blocks are left byte-identical.

## `src/update/audit.ts`

```ts
export function appendAuditLog(projectRoot: string, previous: string | null, updated: string): void;
export function appendAuditLogFailure(
  projectRoot: string,
  previous: string | null,
  target: string,
  error: string,
): void;
```
