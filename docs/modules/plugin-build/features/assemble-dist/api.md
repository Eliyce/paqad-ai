# Assemble the plugin output: API

This feature has no network or HTTP API. Its programmatic surface is the build command-line.

## build.py

```
python3 build/build.py [--source <repo-root>] [--dist <output-dir>]
```

| Argument | Meaning |
|---|---|
| `--source` | Repository source root. Defaults to the parent of `build/`. |
| `--dist` | Output directory. Defaults to `<source>/dist`. |

### Behaviour

Reads `build/skills.yml`, copies each skill plus its declared shared imports into
`dist/plugins/<name>/skills/<skill>/`, and generates the manifests (see the generate-manifests
feature). The dist tree is wiped at the start of a run so removed inputs never linger. The build
is deterministic: two runs produce byte-identical output (CI-8).

### Output

Writes the `dist/` tree. Prints `build ok: <dist>` to stdout on success and exits 0. On a build
error it prints `build failed: <message>` to stderr and exits 1. Failure cases include an
undeclared shared import (PLG-10), a missing skill folder or `SKILL.md`, and a malformed
`skills.yml`.
