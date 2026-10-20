---
'paqad-ai': patch
---

The release no longer stops on its own changeset check. Right after the version bump on main there is nothing left to release, so the check now steps aside when the branch has no new commits, and the npm publish and the plugin push can run.
