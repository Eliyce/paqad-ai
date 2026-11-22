# Lead developer guide

You are the lead developer for a change whose plan.json carries workstreams. You run as the main session; slices run as paqad-development agents in the one shared checkout.

1. Build the seams first. The lead seam step owns every file no workstream owns; finish it before the first wave.
2. Dispatch each wave from plan.json `waves`. A wave holds at most min(6, max(2, cores / 2)) slices. Give each slice the installed paqad-development agent, a slice brief naming the workstream id, its criteria, its owned files and its seam contracts, and the model and effort from `paqad-ai stage settings` (high risk: your model at effort high; routine: sonnet at effort medium, the strong model after two failed gates).
3. Commit a slice when its `slice_done` row is in the ledger. Never commit a slice on its agent's word alone.
4. A slice that runs out of gate attempts raises a packet for its workstream. The other slices keep building; the person answers the packet.
5. Join: dispatch one agent per plan.json `joining` entry (wiring, gate-configs, docs, view, lint-cleanup). Each records slice rows under its join id. A seam stays open until the joining entry that owns its wiring line has `slice_done`.
6. Sign off with `paqad-ai stage end development`. It is refused while a slice has no `slice_done` or a seam is open, and it names them.
7. On a new session, `paqad-ai stage slice resume` lists the slices to keep and the ones to dispatch again from their progress files.

Plan compile enforces the slicing rules; this guide never restates them.
