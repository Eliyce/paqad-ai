# Python Skills Plugin Python Platform

- Import only standard library modules and modules that live in this repository in shipped scripts. <!-- @rule RL-13c9 -->
- Never import `socket`, `http`, `urllib.request`, `ssl`, `smtplib`, `ftplib` or `subprocess` in a shipped script. <!-- @rule RL-9e8b -->
- Write code that parses with `ast.parse(source, feature_version=(3, 9))`. <!-- @rule RL-8961 -->
- Pass `encoding="utf-8"` to every `open()`, `read_text()` and `write_text()` call. <!-- @rule RL-00a4 -->
- Call `json.dumps` only inside `shared/scripts/canonical.py`. <!-- @rule RL-9edb -->
- Exit with 0 when a script finds no issues, 1 when it finds issues, and 2 on a usage error. <!-- @rule RL-06a6 -->
- Never write a bare `except:`, `except Exception` or `except BaseException`. <!-- @rule RL-b4db -->
- Never use `assert` in a shipped script. <!-- @rule RL-1334 -->
- Write files only to paths the caller passes on the command line. <!-- @rule RL-5c42 -->
