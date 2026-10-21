---
id: "TD-01M5DSTMPPCAXKJ25R9162YBCR"
title: "HUD band, close and Ledger flows have no site-map journey"
kind: "gap"
severity: "low"
status: "open"
files:
  - "docs/site-map/journeys"
found_in:
  change: "01M5DHQYW9J0Y7ZGF6QN0E34GE"
  issue: "702"
  stage: "review"
found_by: "paqad-review"
session: "36416bc0-b415-43e8-943d-22b4b74f241f"
created_at: "2026-10-20T23:19:59.439Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The HUD v2 spec asked the band, close and Ledger flows to extend an existing HUD journey under docs/site-map/journeys/. No such journey exists: the folder holds map-the-app, onboard-first-run and ship-a-change, and none of them mentions the HUD or the band. So nothing could be extended and the flows have no journey yet.

Follow-up: author one HUD journey (band idle to card, minimise, close for now, hide always, /paqad show, Needs you line, Proof and brand opening the Ledger on Trust). This is not a parallel journey because none exists.
