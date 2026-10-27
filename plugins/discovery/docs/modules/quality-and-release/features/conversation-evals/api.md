# Conversation eval scenarios: API

This feature has no API and no runtime entry point yet. Its surface is the scenario files under
`tests/evals/scenarios/` and the fixtures under `tests/evals/fixture-repo/` (paqad-documented) and
`tests/evals/fixture-repo-code-only/` (real code, no paqad docs).

## Scenario shape

Each scenario is a YAML entry with: `id`, `title`, `acceptance` (the acceptance criterion it
proves), `entry_skill` (an entry skill only), `fixture` (a fixture module or `none`), `user` (one
message or an ordered list), and `expect` (a list of checkable, provider-neutral properties drawn
from the conversation contract).

## Runner

There is no runner wired in this repository. The scenarios are authored but not executed in CI
until S3, when the host eval runner (`claude plugin eval` on Claude) runs them against the built
plugin, the fixture repo and a fake tracker (CI-12). Properties are checked, never exact wording,
and each must hold in at least 3 of 3 runs.
