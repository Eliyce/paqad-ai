# Testing Guide

Tests are `unittest` only and live in `tests/scripts/test_*.py`.

## Commands

| Goal | Command |
|---|---|
| Full suite | `python3 -m unittest discover -s tests/scripts` |
| Verbose full suite | `python3 -m unittest discover -s tests/scripts -p "test_*.py" -v` |
| One file | `python3 -m unittest discover -s tests/scripts -p "test_record.py"` |
| One test | `python3 -m unittest discover -s tests/scripts -k test_each_skill` |
| Python 3.9 floor | `/usr/bin/python3 -m unittest discover -s tests/scripts` on a machine where that is 3.9 |

## Habits

- Run the narrowest file while iterating, then the full suite before calling work done.
- Run every test file on its own at least once; a file that only passes inside the full suite is a hidden dependency.
- Use `tempfile.TemporaryDirectory()` for any test that writes files.
