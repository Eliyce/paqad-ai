# Pack Schema (pack.yaml): API View

> Module: **Pack System** (`pack-system`) · Layer: `framework-internals` · Feature slug: `pack-schema`

## Surface

A stack pack is a `pack.yaml` file. The loader in `src/packs/loader.ts` reads it into a `StackPackManifest` (`src/core/types/pack.ts`). The file is checked against `src/validators/schemas/stack-pack.schema.json`, which is closed: any top-level key it does not list is an error. There is no CLI of its own. `paqad-ai packs` lists and installs packs, and `paqad-ai checks run` reads the fields below.

## Check-related fields

```yaml
build_outputs:
  - dist
format_changed:
  - default_command: pnpm format
    script: prettier --write .
    command: pnpm exec prettier --write --ignore-unknown {files}
```

- `build_outputs` (optional, list of strings): the project-relative folders the build writes. After a green build, `checks run` fingerprints the files in them. A later build is reused only while that fingerprint still matches. An absolute path, a drive-letter path or a path with a `..` segment is a load error.
- `format_changed` (optional, list of entries with exactly the keys `default_command`, `script` and `command`, each a non-empty string): a formatter that can run on only the changed files. `checks run` uses `command` only when the profile's format command equals `default_command` exactly and `package.json` `scripts.format` equals `script` exactly. Otherwise it runs the normal format command. A `command` that does not contain `{files}` exactly once, as its own argument, is a load error. So are two entries with the same `default_command`.

Both fields are optional. A pack without them still loads. Without `format_changed`, format runs the normal format command. The react and node-service packs declare `dist` and the pnpm and npm prettier entries.

## Errors

Validation returns a list of issues instead of throwing. Each issue has a `level`, a `path` that names the field (for example `/build_outputs` or `/format_changed`) and a plain message.
