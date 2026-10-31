# S8 operate

verified: 2026-10-31

- `paqad-ai skill learn <name> "<correction>" --scope <where> --source <S-ID>` asks the owner whether to add a correction. On yes, `--decision <id>` adds it under Gotchas in an improve-mode draft; take that draft through S4 to S7 again.
- `paqad-ai skill drift <name>` lists externally verified facts past the freshness limit. Re-verify each one before the next release.
- `paqad-ai skill catalog` reports each installed skill's trigger rate from the activation log, the skills that never fired in the dark window with their listing cost, rivals that take each other's requests, and how many skills were added and refused. `--propose-retirement` asks the owner about each dark skill. On a host with no activation hook it says so.
