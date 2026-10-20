# paqad-ai update: API View

> Module: **Project Lifecycle Commands** (`cli-lifecycle`) · Layer: `cli-commands` · Feature slug: `update`

## CLI

```
paqad-ai update [--project-root <path>] [--silent]
```

`update` migrates the `.paqad/` layout forward, regenerates the framework-managed files, refreshes the tracked config files, writes the framework version, refreshes the managed blocks of `.paqad/.gitignore` and `.paqad/.gitattributes` and the `.paqad/.config` line of `.worktreeinclude`, and prints the report below as JSON.

With `--silent` it prints nothing. A successful run appends the `INFO` line to `.paqad/audit.log`; a failed silent run appends the `WARN` line:

```
[<ISO time>] INFO silent-update previous=<version or unknown> updated=<version>
[<ISO time>] WARN silent-update-failed previous=unknown target=<version> error="<message>"
```

A silent run that fails exits 1 after the `WARN` line. A silent run that succeeds also gives the Claude Code plugin move a chance to run (`maybeMigrateToPlugin`); that step never fails the update. Without `--silent` an error is not caught, so the CLI prints it and exits non-zero.

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

`skipped` lists a file whose manifest entry says `auto_update: false`, with the bytes on disk and the bytes paqad would have written. `new_scripts` lists files under `scripts/` that did not exist before. `config_keys_pruned` lists the keys removed from `.paqad/configs/.config.*` because this version no longer knows them. `deprecated` and `new_mcp_servers` are always empty.

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
