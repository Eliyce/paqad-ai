# Site-map helper skills

The helper skills that carry the `site-map` workflow's detail, in the order they run. Each keeps its own procedure; the verbs in the Procedure stay the source of proof.

| Helper                  | Job                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `site-map-readiness`    | grades whether the project is mappable and routes the unmappable case; always first |
| `surface-extraction`    | runs the extractors, then normalizes and fingerprints the raw surfaces              |
| `surface-modeling`      | names, types and attributes the surfaces to modules, with entry and exit marks      |
| `transition-tracing`    | evidences where navigation goes and what triggers it, with the proving file:line    |
| `guard-inference`       | evidences the guards on surfaces and transitions, and how each is satisfied         |
| `site-map-assembly`     | drives the compile verb that folds the layers into `app-map.yaml`                   |
| `map-verification`      | confirms or refutes the claims the deterministic checks could not settle            |
| `site-map-gap-analysis` | turns graph invariants and verdicts into `SM-*` findings and a gap report           |
| `journey-synthesis`     | proposes capped journeys over the verified map, all marked proposed                 |
| `finding-normalizer`    | keeps the finding entries and their vocabulary, including the `SM-*` categories     |
| `site-map-retest`       | runs the re-check for the Retest mode                                               |
