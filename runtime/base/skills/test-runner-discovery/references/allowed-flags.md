# Allowed parallel-flag tokens

A discovered `test_parallel` may start with the project's own runner invocation (the shared leading
tokens of `commands.test`, including the runner executable), then add ONLY the tokens below. The
`<processes>` placeholder must appear exactly once and is substituted with the process count at run
time. Any other token, or any shell metacharacter (`;`, `|`, backtick, `$`, `(`, `)`, `>`, `<`), is
rejected by `paqad-ai checks record-runner` and nothing is stored.

| Token                                                       | Runner it fits                   |
| ----------------------------------------------------------- | -------------------------------- |
| `--parallel`                                                | Pest/PHPUnit (paratest), generic |
| `--processes=<processes>`                                   | Pest/PHPUnit (paratest)          |
| `-n` `<processes>`                                          | pytest-xdist                     |
| `--dist` `--dist=load` `--dist=loadfile` `--dist=loadscope` | pytest-xdist distribution mode   |
| `--workers=<processes>`                                     | Playwright, Jest-style           |
| `--maxWorkers=<processes>`                                  | Jest                             |
| `--concurrency=<processes>`                                 | Mocha, AVA-style                 |
| `-j` `--jobs=<processes>`                                   | make-style, tap                  |
| `--runner` `WrapperRunner` `--runner=WrapperRunner`         | tap parallel runner              |
| `--max-parallel-test-modules`                               | Vitest-style                     |
| `--test-threads=<processes>`                                | cargo test                       |
| `-p`                                                        | generic parallel flag            |

The chain operator `&&` and the argument separator `--` are structural and always allowed.
