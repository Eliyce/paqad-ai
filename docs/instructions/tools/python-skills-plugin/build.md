# Build Guide

`build/build.py` reads `build/skills.yml`, copies each skill and its declared shared imports, and writes every manifest into `dist/`.

## Commands

| Goal | Command |
|---|---|
| Build | `python3 build/build.py` |
| Build to a chosen folder | `python3 build/build.py --dist /tmp/dist-a` |
| Prove determinism | `python3 build/build.py --dist /tmp/dist-a && python3 build/build.py --dist /tmp/dist-b && diff -r /tmp/dist-a /tmp/dist-b` |
| Compile check | `python3 -m compileall -q build skills tests` |

## Habits

- Never edit `dist/` by hand; change the source and rebuild.
- Add a shared file to a skill by declaring it under that skill's `imports` in `build/skills.yml`; the build fails on an undeclared reference.
