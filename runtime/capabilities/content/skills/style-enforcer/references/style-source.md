# Style Source of Truth

The project style at `docs/instructions/rules/writing-style.md` is authoritative whenever it exists. The bundled `assets/default-rules.txt` is only the fallback for projects that have not declared a style yet. Never override a project rule with a generic default.

When extending the project style file, prefer one rule per line in the form:

```
forbid: "literally"
warn: "in order to"
```

so `scripts/check-style.sh` can keep parsing it deterministically.
