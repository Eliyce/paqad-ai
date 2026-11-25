# Build the next slice: local status, resume and housekeeping

Paste this prompt into your coding agent at the root of this repository.

---

You are building the next slice of paqad's local status, resume and housekeeping work.

1. Read [`../REQUIREMENTS.md`](../REQUIREMENTS.md) in full, then [`../PROGRESS.md`](../PROGRESS.md).
2. Pick the slice: the first row of the Slices table, in delivery order, whose status is not **Done** and whose dependencies are all **Done**. If it depends on an unknown that is still **Open**, build S0 for that unknown first. If it waits on an owner ruling, stop and ask that one question, with your recommendation.
3. Say in two lines which slice you picked, and why it is next.
4. Before writing code, read the files the requirements name for that slice, and check that every **Fact** they state is still true. If one is not, stop and report the difference instead of building on it.
5. Build the slice through this repository's own paqad workflow (its feature lane, stages and checks), on a branch named `feat/<slice-slug>`. Meet every MUST of the slice; meet each SHOULD or record why not in the pull request.
6. Keep paqad generic: the code and docs name no other product, and every behaviour is something a paqad user wants on its own.
7. Add the tests the slice's "Test approach" names. Run the full checks (`pnpm ci`). If the slice changes a public entry point or `package.json` `exports`, update [`../../extension-surface.md`](../../extension-surface.md) in the same change.
8. Add a changeset when the slice changes shipped behaviour (see `CONTRIBUTING.md`, "What needs a changeset").
9. Update `PROGRESS.md` in the same pull request: the slice's status, the pull request link, the evidence for each "Done when" line, and a dated log line. Record any unknown you answered, with its source.
10. Open the pull request with a summary of what the slice delivers to the user, the requirement IDs it meets, and anything left open.

Stop after one slice.
