---
'paqad-ai': minor
---

The discovery plugin now installs from `Eliyce/paqad-product-discovery-plugin` in Claude Desktop and in Codex (`codex plugin marketplace add Eliyce/paqad-product-discovery-plugin`), with no hooks, so Claude shows no "runs code" warning. Every release publishes it at the paqad-ai version. It ships only discover and ask; refining, sizing and sprint planning stay in the paqad plugin.

The skills already publish as `discover`, `ask` and `start`; only the plugin name changes, from `paqad-product-discovery` to `paqad`. Commands move from `/paqad-product-discovery:discover`, `/paqad-product-discovery:ask` and `/paqad-product-discovery:start` to `/paqad:discover`, `/paqad:ask` and `/paqad:start`.

Install this plugin or the paqad plugin, not both: both are named `paqad`. `paqad-ai doctor` fails, and `paqad-ai update` and `paqad-ai install` warn, when both are installed.

Step 0 now finds the Jira project from the repository's branch names and commit subjects, and asks when they do not point to one; it never searches Jira broadly. Discovery reads the business docs first, then the code, and never the technical notes; `refine-ticket` and `size-work` in the paqad plugin read the same way, business docs then code. When both the code and the tickets are read, the playback opens by showing where they agree and differ, and the code and docs win.
