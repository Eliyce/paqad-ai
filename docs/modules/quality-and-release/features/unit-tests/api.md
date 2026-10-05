# Script and authoring tests: API

This feature has no network or HTTP API. Its surface is the test command.

## Run

```
python3 -m unittest discover -s tests/scripts
```

A single file runs with `python3 -m unittest tests/scripts/test_<name>.py`. CI adds
`-p "test_*.py" -v`. Standard library only; no third-party runner.

### Contract

Exit 0 when every test passes, non-zero on any failure. The suite covers each skill script, the
build (determinism and undeclared-import rejection), and the authoring rules (frontmatter, no
vendor names, no dashes, the voice block). It needs a working Python 3.9 or newer; on a machine
whose `python3` alias is broken, run it with an explicit interpreter such as `/usr/bin/python3`.
