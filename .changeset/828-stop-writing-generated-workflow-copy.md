---
'paqad-ai': minor
---

paqad no longer writes a copy of the feature-development workflow to `docs/instructions/workflows/feature-development.yaml`, and no longer writes editor schemas to `.paqad/configs/schemas/` or a `# yaml-language-server` line at the top of each team file. paqad reads your settings straight from `.paqad/configs/`.

Your first `paqad-ai update` (or `paqad-ai join` on a teammate's machine) removes what older versions left behind and prints one line for each thing it removed: the workflow copy, its hash file, its line in `.git/info/exclude`, the `docs/instructions/workflows/` folder when nothing else is in it, the schemas folder, and the first schema line of each team file. Nothing else in your team files changes, and your own workflow files in that folder stay.

`paqad-ai config view` is gone. To see every setting and its value, run `paqad-ai config show`, or read the table in `.paqad/configs/README.md`. Stage agents now get their instructions in their brief; `paqad-ai stage brief <stage> --full` prints all of them when a brief was shortened.
