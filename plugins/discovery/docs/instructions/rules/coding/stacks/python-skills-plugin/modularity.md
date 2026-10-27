# Python Skills Plugin Modularity

- Keep each Python file at 300 lines or fewer. <!-- @rule RL-de26 -->
- Keep each function at 40 lines or fewer. <!-- @rule RL-d3b9 -->
- Keep each function at cyclomatic complexity 10 or lower. <!-- @rule RL-1eb5 -->
- Give each function at most 4 parameters. <!-- @rule RL-f5d6 -->
- Nest blocks at most 3 levels deep inside a function. <!-- @rule RL-f1e3 -->
- Put only imports, constants, functions, classes and the main guard at module top level. <!-- @rule RL-5666 -->
- Call `argparse`, `print` and `sys.exit` only inside `main()`. <!-- @rule RL-2692 -->
- End every script with `if __name__ == "__main__": sys.exit(main())`. <!-- @rule RL-3fb5 -->
- Never use the `global` statement. <!-- @rule RL-8323 -->
- Put logic that two scripts need once in `shared/scripts/` and import it; never copy a function body between files. <!-- @rule RL-f7c0 -->
- Import only the standard library, the skill's own `scripts/` modules, or `shared/scripts/` modules the skill declares in `build/skills.yml`. <!-- @rule RL-1547 -->
- Use no number literal other than 0, 1 and -1 inside a function body; name every other value as an UPPER_SNAKE_CASE module constant. <!-- @rule RL-6371 -->
- Give each file one responsibility that its name states. <!-- @rule RL-6a4d -->
