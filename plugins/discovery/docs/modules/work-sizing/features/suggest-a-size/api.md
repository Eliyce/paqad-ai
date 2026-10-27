# Suggest a size: API

This feature has no network or HTTP API. All tracker reads and writes go through the host's own
connector. The feature's own programmatic surface is one read-only command-line script with two
subcommands; it writes nothing outside stdout.

## compare_sizes.py

```
compare_sizes.py suggest --target <target.json> --pool <finished.json> --scale <scale.json>
                         [--area-docs <docs.md>]
compare_sizes.py set --field-value <current> [--replace]
```

| Argument | Meaning |
|---|---|
| `--target` | The ticket being sized: `{ key, summary, description, labels }`. |
| `--pool` | Finished tickets to compare against: `[{ key, link, size, summary, description, labels }]`. |
| `--scale` | The team size scale: `{ "scale": [..] }` (or a bare list). |
| `--area-docs` | Optional. The target area docs; template or empty docs lower the confidence one notch (AC-36). |
| `--field-value` | For `set`: the current value of the size field. |
| `--replace` | For `set`: allow overwriting a size field that already holds a value (EST-6, AC-37). |

### Inputs

- suggest: reads `--target`, `--pool`, and `--scale` as JSON (via `canonical.load`), plus optional `--area-docs` text.
- set: takes the current `--field-value` string on the command line, no file.

### Output (stdout)

`suggest`:

```json
{ "ok": true,
  "suggestion": { "size", "range", "drivers": [..], "confidence", "confidence_reason",
                  "comparables": [{ "key", "link", "size" }], "label": "suggested size" } }
```

Comparables are scored by Jaccard token overlap and the up-to-five closest are returned. The result
is always labelled `suggested size` and is never a date (EST-5). When fewer than two comparables
exist, `size` and `range` are null with a low-confidence reason rather than an invented size
(EST-2/3). When comparables exist but none of them carries a size, the script likewise returns a
clean low-confidence result (`size` and `range` null, with a reason that the comparables carry no
size) rather than crashing. When comparables disagree it reports a `range` across the scale and
lowers confidence.

`set`:

```json
{ "ok": true, "write": true, "reason": "..." }
```

Exit 0 on a clean suggestion or an allowed write, 1 on a refused overwrite or an error.
