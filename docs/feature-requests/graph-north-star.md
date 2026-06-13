# The graph as North Star: from "wow, then what?" to trust and confidence

Status: design direction, research-backed, ready to turn into build tickets
Relates to: [dashboard-one-stop-shop.md](dashboard-one-stop-shop.md) (where the graph lives), issue #146, issue #121
Research: deep-research run 2026-06-13, 22 sources fetched, 25 claims adversarially verified (23 confirmed, 2 refuted). Verified backbone is cited inline; product exemplars are labelled as precedent.

## The problem, named precisely

The graph today answers the engine's question ("here is your code's structure") when the end user is asking a different one ("is my codebase safe and well run under AI agents, and what do I do about it?"). A force-directed node-link diagram with a cosine-similarity slider, layer toggles, and a click-to-spec-sheet panel (`ast type`, `content_hash`, `risk_floor`, `complexity_correction`, raw source) is the engine talking to itself. People get excited by the picture, then hit the "then what" wall because nothing on screen answers a human question or tells them how to feel.

North Star reframe: the graph is not a structure explorer. It is the emotional centerpiece that makes a decision maker FEEL their codebase is understood and safe. The stage is the map; the story is trust.

## The verified evidence (the backbone, all 3-0 confirmed unless noted)

1. **Aesthetic-usability effect.** Beauty raises perceived usability and trust and buys forgiveness for minor friction, strongest at first impression, decaying with use. https://www.nngroup.com/articles/aesthetic-usability-effect/
   - Guardrail (refuted claim): manipulating "fluency/prettiness" does NOT causally make a thing more usable (0-3). So treat beauty as trust-on-arrival, not a substitute for legibility.
2. **Processing fluency drives the gain.** The effect is largely mediated by how instantly readable a thing is, so 5-second legibility is the lever, not decoration. https://dl.acm.org/doi/10.1145/3544549.3585739
3. **Do not render the whole graph.** Design backwards from the user's job and keep the hairball out of the UI. https://cambridge-intelligence.com/how-to-fix-hairballs/
4. **Martini-glass structure.** Lead with a tight author-driven story, then open to free exploration; unguided exploration is a failure mode for lay audiences. https://faculty.cc.gatech.edu/~stasko/7450/Papers/segel-tvcg10.pdf
5. **Aim for calibrated trust, not maximum trust.** Trust should track actual reliability: overtrust causes misuse, distrust causes disuse. https://journals.sagepub.com/doi/10.1518/hfes.46.1.50_30392
6. **More explanation is not always better.** Explanations can inflate trust regardless of correctness, so tie every explanation to something verifiable. https://pmc.ncbi.nlm.nih.gov/articles/PMC11573890/
   - Good news (refuted claim): the fear that rich provenance inflates capability and hurts accuracy did NOT hold up (1-2). Showing lots of evidence is fine here, as long as it is verifiable.
7. **Interface transparency beats exhortation.** Building the explanation into the interface improved accuracy, time, workload, trust, and usability; a "please slow down" nudge did nothing. https://www.tandfonline.com/doi/full/10.1080/10447318.2025.2487861
8. **Show what is broken AND the fix; make failing-state disclosure configurable.** Vanta's Trust Center exposes control state with presets for how much failing detail is shared. https://www.vanta.com/compare/drata

Product exemplars researched as precedent (illustrative, not independently verified in this run except Vanta): Spotify Wrapped (authored, self-relevant, shareable cards), GitHub contribution graph (self-relevant at-a-glance streak), Obsidian local graph (delight from seeing your own thing), Datadog service map (cluster-first, expand on demand), Linkurious (guided investigation over open canvas).

## The eight design moves (prioritized)

Each move: what to do, the psychology reason, the precedent, the source.

### 1. Open with an answer, not an empty canvas (highest priority)
Replace the cold force-directed hairball on load with an authored "state of your codebase" headline strip: a one-line verdict plus 2-4 framed facts ("Healthy. 2 areas need attention. AI agents shipped to 4 modules this week, all verified."). The canvas sits below/behind it and invites exploration after the story lands.
- Why: martini-glass; lay audiences fail at unguided exploration, so lead with the author's story. (Segel & Heer)
- Precedent: Spotify Wrapped opens with narrative cards before any raw data.

### 2. Default to the module map, never the full graph (semantic zoom)
The default view is ~5 to 15 named area/module clusters, not thousands of file/chunk/symbol nodes. Files, chunks, and symbols appear only on zoom or click. The current layer toggles default to "modules only".
- Why: 5-second legibility (processing fluency) and the explicit hairball fix. (CHI 2023; Cambridge Intelligence)
- Precedent: Datadog service map clusters first and expands on demand.

### 3. Encode health in pre-attentive, layperson cues; kill the jargon labels
Color (green / amber / red), size (importance), and plain words ("Healthy", "Needs attention", "At risk") instead of `risk_floor`, `complexity_correction`, `defect_density`, `ast type`. A non-specialist should read the map's emotional state without a glossary.
- Why: instant readability is what converts beauty into perceived trust; decoration alone does not. (NN/g; CHI 2023)
- Precedent: GitHub contribution graph reads in one glance with zero training.

### 4. Make every node and panel answer "so what / what do I do?"
The detail panel becomes a plain-language card: "Payments. Handles checkout and billing. Healthy. Last changed by an AI agent 3 days ago, verified by 2 checks. Nothing to do." Any worry-state names the issue in plain English and the recommended next action. Raw source and hashes move behind a "for engineers" disclosure.
- Why: calibrated trust plus transparency-beats-exhortation; explanations must connect to verifiable facts. (Lee & See; Lucas et al; IJHCI 2025)
- Precedent: Vanta states the problem and the fix in plain language.

### 5. Overlay "what the AI saw and changed" as the trust layer (the differentiator)
Light up the modules AI agents touched, and link each to its evidence receipt (verified, who accepted, when). This is the move that converts a pretty map into a trust signal unique to paqad: "the AI worked here, and here is the proof." Make it a first-class overlay, on by default for recent activity.
- Why: interface transparency improved trust and usability; and rich, verifiable provenance is NOT harmful (the overtrust fear was refuted). (IJHCI 2025; Lucas et al)
- Precedent: Vanta Trust Center pairs state with proof.

### 6. Show what is broken and the fix, with configurable disclosure
At-risk areas state the issue and the recommended fix in plain language. Provide presets for how much failing-state detail is shown (private working view vs. a shareable, board-safe view).
- Why: calibrated trust means never hiding failures (distrust drives disuse) and never overstating them (overtrust drives misuse). (Lee & See)
- Precedent: Vanta configurable failing-state visibility.

### 7. Sensible defaults over knobs; demote the engineer controls
Remove the similarity-threshold slider and layer toggles from the default surface into an "Advanced / for engineers" affordance. The non-specialist gets a curated, opinionated view; the engineer opts in to raw controls.
- Why: open exploratory power is a failure mode for lay audiences; defaults cut cognitive load. (Segel & Heer; Cambridge Intelligence)
- Precedent: Linkurious leads with guided investigation, not an open canvas.

### 8. Make it admire-and-share: a beautiful, self-relevant snapshot
A shareable "state of your codebase" snapshot card (ties directly to the shareable-snapshots feature already specced in the one-stop-shop doc). Their own codebase, rendered calm and legible, is psychologically sticky and is the thing they show their board.
- Why: aesthetic-usability first impression plus self-relevance of seeing your own data. (NN/g aesthetic-usability)
- Precedent: Spotify Wrapped and the GitHub graph are shared precisely because they are self-relevant and beautiful.

## What "North Star" looks like (target vision)

An engineering leader opens the graph and does not see a tangle. They see their codebase as a calm map of a handful of named areas, each glowing green, amber, or red, with a one-line story across the top: "Healthy. AI agents shipped to 4 areas this week, all verified." They feel the state in five seconds. They click an area and get plain language: what it does, how it is doing, what the AI changed, and the proof. If something needs attention, it says so and says what to do. They export a snapshot and show it to their board with pride. The graph has stopped being the engine's debug view and become the reason they trust that their codebase is understood and safe under AI agents.

## How this lands on the current code

Concrete starting points (the redesign is mostly in `graph-ui/src`):
- `views/GraphView.tsx`: add the authored headline strip (move 1); default the store's layer visibility to modules-only (move 2).
- `components/Sidebar.tsx`: collapse layer toggles + similarity slider under an "Advanced" disclosure (move 7).
- `components/GraphCanvas.tsx`: pre-attentive health color/size at the module level; semantic-zoom expansion on click (moves 2, 3).
- `components/DetailPanel.tsx`: rewrite the four `*Detail` blocks from spec sheets into plain-language "what / how / what the AI did / what to do" cards; demote hashes and raw source behind a "for engineers" toggle (moves 3, 4).
- New "AI activity" overlay wired to the evidence ledger / receipts the Trust view already reads (move 5), reusing the receipt data from issue #121.
- A copy pass: a plain-language label map replacing `risk_floor` / `complexity_correction` / `ast type` etc. (move 3), living in `graph-ui/src/lib/copy.ts`.

## Honesty notes

- The academic backbone (aesthetic-usability, processing fluency, martini glass, calibrated trust, transparency) is top-tier and unanimously verified.
- Two intuitive-sounding claims were refuted and are deliberately NOT used as written: prettiness does not causally create usability, and rich provenance did not cause harmful overtrust.
- The product exemplars beyond Vanta (Spotify, GitHub, Obsidian, Datadog) were researched but not independently verified in this run; they are cited as precedent, not as evidence.
- The aesthetic-usability effect is strongest at first impression and fades with use, so beauty gets them in the door but moves 1 to 6 (legibility, story, plain language, the trust overlay) are what keep them.
