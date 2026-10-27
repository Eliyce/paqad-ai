# Python Skills Plugin Testing

- Keep branch coverage of `build/`, `shared/scripts/` and `skills/*/scripts/` at 95% or higher, measured with `coverage.py --branch`. <!-- @rule RL-a02b -->
- Import every module under `build/`, `shared/scripts/` and `skills/*/scripts/` from at least one file in `tests/scripts/`. <!-- @rule RL-225f -->
- Write tests with `unittest` only. <!-- @rule RL-770f -->
- Put at least one assertion in every test method. <!-- @rule RL-fae2 -->
- Never use `skip`, `skipIf`, `skipUnless` or `expectedFailure`. <!-- @rule RL-d38c -->
- Make every test file pass when run on its own. <!-- @rule RL-c7e7 -->
- Make the suite pass on Python 3.9 and on the current Python release. <!-- @rule RL-9c09 -->
- Add a test that fails without the fix to every bug fix. <!-- @rule RL-f3f1 -->
