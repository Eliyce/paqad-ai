# Python Skills Plugin Build And Repository

- Generate `dist/` only with `build/build.py`; never edit it by hand. <!-- @rule RL-ccf1 -->
- Make two consecutive builds produce byte-identical `dist/` trees. <!-- @rule RL-8951 -->
- Ship no `agents/`, `hooks/`, `commands/`, `bin/`, `.mcp.json`, `mcp.json`, `.app.json`, `__pycache__` or `*.pyc` in `dist/`. <!-- @rule RL-3591 -->
- Keep `dist/` under 5 MB and under 300 files. <!-- @rule RL-755d -->
- Read name, version, description, license and display text only from `build/skills.yml`. <!-- @rule RL-1d61 -->
- Declare every shared file a skill uses in that skill's `imports` in `build/skills.yml`. <!-- @rule RL-e433 -->
- Commit no string that matches a secret pattern. <!-- @rule RL-5a02 -->
- Assign every skill folder and every `sources` path in `docs/instructions/rules/module-map.yml` to exactly one module. <!-- @rule RL-a8ae -->
- Change `docs/modules/<slug>/` in the same change that alters the source of module `<slug>`. <!-- @rule RL-53ca -->
