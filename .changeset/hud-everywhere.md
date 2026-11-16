---
'paqad-ai': minor
---

Existing Claude Code users now move to the paqad plugin automatically. Set claude_install_mode=settings to stay on npm.

Every Claude Code user now sees the paqad HUD, and it follows every workflow change. Team repos that turn the plugin on in `.claude/settings.json` now get the plugin installed for the user too, because project settings alone never fetch it; teammates on the team launcher get it installed in the background, and paqad says once to type /reload-plugins to see the HUD now, or it shows next session. Every opt-out still holds: the plugin turned off in your user or local settings, claude_install_mode=settings, a managed policy, CI or headless runs, and cloud sessions. The plugin migration and the HUD now need the same Claude Code, 2.1.301 or later.

The HUD band no longer goes blank: it binds on the first prompt after /clear, /resume or /branch, keeps a running change's band through questions and research, keeps a paused change paused, shows Getting ready for a change picked up from another session, and draws a defined row for every scope. A cloud session says once, in one plain line, that the HUD cannot draw there while paqad's checks still run, and `paqad-ai doctor` warns with one fix when the HUD is not attached or the plugin is not loaded, and reads the plugin version that applies to this repo.

The paqad discovery plugin is now named paqad-discovery, so its commands read `/paqad-discovery:start`, `/paqad-discovery:ask` and `/paqad-discovery:discover` and it no longer clashes with the paqad plugin. Doctor still warns about an old discovery plugin named paqad, with the fix to update or remove it.
