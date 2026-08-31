# Quality audit

## Frozen geocode baseline

The mainland baseline contains 881 records: 574 automaticHigh, 109 automaticMedium, four reviewedOverrideHigh and 194 unresolved. The frozen matcher and component hashes are recorded in [geocode-mainland-freeze.json](../data/audit/geocode-mainland-freeze.json).

The automaticHigh blind sample contains 150 unique rows, all with `overrideUsed=false`. A 150/150 external-review claim was supplied in task context, but its row-level evidence file is not present in this worktree; therefore it is not materialized as a local approval result. This is evidence for the sampled set when the underlying review artifact is supplied, not a mathematical guarantee for all 574 automaticHigh records.

## Data quality checks

- 901 unique source rows and continuous source-row sequence.
- Raw display fields preserved after derivation.
- No invalid or NaN coordinates.
- Null location is an accepted state, not a failed fabrication target.
- Duplicate POI IDs are flagged for review and do not automatically delete source records.
- 785 and 786 are kept as separate Urumqi cinema records.
- Status and former-name parser regressions are covered by tests.

## Current known gates

The engineering work is not globally blocked by these gates. Parser, frontend, local preview, tests and QA remain open; only the corresponding materialization or publication action is gated.

- AMap public-coordinate publication: blocked pending written provider permission.
- Human risk-review decisions: must be present as `data/audit/geocode-risk-human-review-219.json` before reviewed geocode decisions can be materialized; aggregate counts are deliberately insufficient.
- A final public dataset must pass the publication builder and security scan; internal data is not copied blindly.
- `scripts/validate-public-boundary.mjs` verifies the current public JSON has no provider response arrays, provider coordinates or credentials, and records that the safe base commit `fba4dcd` predates the raw-bearing history. The current feature worktree remains intentionally blocked for publication.

Five high-value unresolved mainland records now have an advisory evidence audit in [geocode-mainland-evidence-review.json](../data/audit/geocode-mainland-evidence-review.json). The evidence confirms venue/capability or historical-address facts, but row-level POI review is still required; all five remain null and no reviewed override or coordinate was added.
