# Writing a plain-language summary

The summary in a commit subject or PR title is read by people who don't read code. Say
what changes for the user or the business, in plain words.

With `summary.style: plain`, paqad flags a summary that:

- contains code formatting (a backtick)
- names a file, like `cart/list.ts` or `seasons.json`
- uses code symbols: `::`, `->`, `=>` or `()`
- names a function or variable, like `loadSeasons` or `load_seasons`
- is longer than `summary.max_length`
- doesn't say what changed: `fix`, `update`, `wip`, `misc`, `cleanup`, `refactor` and the like
- is shorter than 3 words
- starts with an `-ing` word: start with what it does, like "Show", not "Showing"

## Good

- show all seasons when both blocks are active
- let people pay with a saved card
- stop the order page from timing out on large carts

## Bad

- fix bug
- update `SeasonList`
- refactor loadSeasons() in seasons.ts
- Showing seasons

These follow [Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html),
[GitLab](https://docs.gitlab.com/development/contributing/merge_request_workflow/) and
[cbea.ms](https://cbea.ms/git-commit/).
