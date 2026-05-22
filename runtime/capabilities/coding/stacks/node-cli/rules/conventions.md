# Node.js CLI Tool Conventions

## Command Structure and Argument Parsing

- Use a dedicated CLI framework (`commander`, `yargs`, `clipanion`, `citty`, or `cac`) rather than parsing `process.argv` manually.
- Define subcommands as separate modules; keep each command handler focused on orchestration, not business logic.
- Accept `--help` and `--version` flags at every command level. Never suppress them.
- Support `--` to pass-through arguments to child processes when the CLI wraps another tool.

## Exit Code Discipline

- Exit `0` only on success.
- Exit `1` for user errors (invalid arguments, missing required input, expected failure states).
- Exit `2` for system/unexpected errors (unhandled exceptions, I/O failures, dependency failures).
- Never `process.exit()` from inside library functions — only at the top-level command handler.
- Use `process.exitCode = 1` before throwing to ensure non-zero exit even when uncaught.

## stdout vs stderr Separation

- All data output (JSON, file content, result values) goes to **stdout**.
- All diagnostics, progress, warnings, and error messages go to **stderr**.
- Log libraries default to stderr; verify before using any logger in output paths.
- When piping is expected, detect `process.stdout.isTTY` and suppress progress indicators when not attached to a terminal.

## Interactive vs Non-Interactive Mode

- Check `process.stdin.isTTY` before prompting interactively.
- In non-interactive mode (CI, piped input), either fail fast with a clear error message or use `--yes` / `--no-interactive` flags as overrides.
- Never hang waiting for input when stdin is not a TTY.

## Signal Handling

- Register `SIGINT` and `SIGTERM` handlers to perform graceful cleanup (close file handles, remove temp files, restore cursor).
- Exit with code `130` on `SIGINT` (128 + signal number 2) to preserve shell conventions.
- Use `process.on('unhandledRejection', ...)` to catch async failures and exit non-zero.

## Configuration File Loading Precedence

Apply configuration in this order (later values override earlier):

1. Built-in defaults
2. Global config file (`~/.config/<tool>/config.json` or XDG equivalent)
3. Project-level config file (e.g., `.toolrc`, `tool.config.ts`)
4. Environment variables
5. CLI flags

Document the precedence in `--help` output.

## Error Message Formatting

- Lead with the error, not the stack trace. Show the stack only in `--debug` or `--verbose` mode.
- Use structured error messages: `error: <what went wrong>` followed by `hint: <how to fix it>`.
- Colour terminal output only when `process.stderr.isTTY` is true and `NO_COLOR` is not set.
- Never print a raw `Error` object to the user.

## Testing Patterns

### Unit Tests

- Test command parsing logic independently from I/O side effects.
- Mock `process.argv`, `process.env`, and `process.exit` to test flag handling.
- Test each exit code path explicitly — assert the thrown error code, not just that an error was thrown.

### End-to-End Tests

- Spawn the compiled CLI binary as a child process using `execa` or `child_process.spawnSync`.
- Assert on `stdout`, `stderr`, and `exitCode` for each scenario.
- Test both TTY and non-TTY mode by setting `stdio: 'pipe'`.
- Test `SIGINT` by sending the signal to the child process and asserting cleanup behaviour.

## Security

### Argument Injection Prevention

- Never interpolate user-supplied arguments directly into shell strings. Use `execFile` or `execa` with argument arrays, not `exec` with template literals.
- Validate and sanitize file path arguments — resolve to absolute paths and confirm they are within expected bounds before acting on them.
- Reject paths containing null bytes (`\0`) or path traversal sequences (`../`).

### Credential Storage

- Do not write credentials to files without encryption. Use the OS keychain via `keytar` or equivalent.
- Never log credentials, tokens, or secrets — scrub them from error messages and debug output.
- Accept secrets through environment variables or stdin prompts, not CLI flags (flags appear in `ps` output and shell history).

### Supply Chain Hygiene

- Commit your lockfile (`pnpm-lock.yaml` or `package-lock.json`).
- Run `pnpm audit` (or equivalent) in CI and fail the build on high/critical advisories.
- Pin tool versions in `package.json` engines field and document the minimum Node.js version.
- Avoid runtime `eval`, `Function()` constructor, or dynamic `require()` with user-controlled paths.
