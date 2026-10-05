#!/usr/bin/env python3
"""discover-probe: report whether this host runs skill scripts and which runtime it uses.

Standard library only. No network calls. Writes nothing outside the current working folder.

The report is produced by build_report() so tests can assert its shape without spawning a
process, and printed by main() when the script is run directly.
"""

import os
import sys
import tempfile

# Markers the report always contains, so callers and tests can look for them by name.
VERSION_PREFIX = "Runtime version:"
EXECUTED_LINE = "Script executed: yes"
WRITE_TEST_PREFIX = "Working-folder write test:"
STDLIB_LINE = "Standard library only, no network: yes"


def working_folder_write_test():
    """Create, read and delete one temp file strictly inside the current working folder.

    Returns a tuple (ok, detail). Writes nothing outside the current working folder: the
    temp file is created with dir=os.getcwd() and removed again before returning.
    """
    cwd = os.getcwd()
    path = None
    try:
        fd, path = tempfile.mkstemp(prefix=".discover-probe-", suffix=".tmp", dir=cwd)
        payload = b"discover-probe write test"
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
        with open(path, "rb") as handle:
            read_back = handle.read()
        os.remove(path)
        path = None
        if read_back != payload:
            return False, "read-back did not match what was written"
        return True, "created, read and deleted a temp file inside the working folder"
    except OSError as exc:
        return False, "write test failed: {0}".format(exc)
    finally:
        if path is not None and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


def build_report():
    """Return the probe report as a single plain-text string."""
    ok, detail = working_folder_write_test()
    write_line = "{0} {1} ({2})".format(
        WRITE_TEST_PREFIX,
        "pass" if ok else "fail",
        detail,
    )
    lines = [
        "discover-probe report",
        "---------------------",
        "{0} {1}".format(VERSION_PREFIX, sys.version.replace("\n", " ")),
        EXECUTED_LINE,
        write_line,
        STDLIB_LINE,
    ]
    return "\n".join(lines) + "\n"


def main():
    sys.stdout.write(build_report())
    return 0


if __name__ == "__main__":
    sys.exit(main())
