---
'paqad-ai': minor
---

Make an onboarded `.paqad/` directory lighter and the auto-update hook cross-platform.

- **Cross-platform silent-update.** The session-start auto-update hook is now a Node `silent-update.mjs` that runs from the framework install, instead of a `silent-update.sh` copied into every project. The shell version needed bash, python3, and GNU coreutils; the Node version needs only Node, so auto-update works on minimal images and Windows. On re-onboard the old `.sh` entry is pruned from the provider config and the committed copy is removed.
- **Stop churning the tracked manifest.** `onboarding-manifest.json` no longer carries `framework_version` (the one field that changed on every version bump). The file stays tracked for its auto-update policy and onboarded-sentinel role.
- **Drop zero-reader artifacts.** `.paqad/version`, `.paqad/classifier-config.json`, and `.paqad/next-steps.md` are no longer written (the next-steps guidance is printed to the terminal at the end of onboarding). Repos onboarded before this change have these untracked and removed on re-onboard.
- **Quieter module health.** Profiles are created on demand as modules accrue evidence instead of seeding an empty profile per module at onboard, and consumed evidence files are deleted after they fold into a profile, so they no longer grow unbounded.
- **Close .gitignore gaps.** Per-machine runtime state created on first use of a later workflow (`patterns/`, `crs/`, `attachments/`, `traceability/`, module-map drift/events, and more) is now ignored so it never churns a team repo.
- **Fewer false health warnings.** The decision-workspace check no longer requires the git-ignored audit log, and a missing module-health directory is treated as healthy.
