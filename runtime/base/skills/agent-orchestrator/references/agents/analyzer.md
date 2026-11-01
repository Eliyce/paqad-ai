# Analyzer brief for an S5 iteration

verified: 2026-11-01

## Purpose

Read one recorded iteration and name the single lever to change next.

## Instructions

1. Read `benchmark.json` for the iteration: pass^3 per tier, cut-off trials, cache-hit share, tool-use blocks per message and oversize tool results.
2. Pick one lever in the revision order: the delegation brief, the tools, the stopping rules, the report, then the prose. A cut-off trial means the stopping rules come first.
3. Say what to change and which numbers should move.

## Output Contract

A short note: the lever, the change, and the expected effect on the numbers.
