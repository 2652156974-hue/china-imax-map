# Data pipeline

## Source and grain

The source grain is one cinema/IMAX-screen record per Tencent-sheet data row. The audited `BB08J2` / `IMAX中国` tab contains 901 data rows and eight logical columns. The raw snapshot is retained locally for migration audit and is not the public website input.

## Layers

1. `data/raw/arvin-imax.json` — immutable internal source snapshot.
2. `data/derived/cinemas.json` — rule-derived 901-record cinema layer. Raw display text is retained in `nameRaw`, `projection.raw`, screen raw fields and `seatsRaw`.
3. `data/audit/` — reproducible integrity, vocabulary, status, geocoding and quality audits.
4. `data/derived/cinemas-final-internal.json` — optional internal publication candidate for later row-level review work.
5. `data/public/` — 901-record static fact output produced by an explicit builder; it must not be a blind copy of internal data.
6. `data/local/public-amap-reviewed-geocodes.json` — gitignored 901-row runtime marker decisions; current accepted GCJ-02 count is reported by `data/audit/public-amap-quality.json`.

The final internal layer is intentionally gated:

```text
node scripts/materialize-geocode-reviewed.mjs
node scripts/build-final-internal.mjs
```

The first command refuses to proceed without the complete row-level 219-record human review file. The second command refuses to proceed without the reviewed mainland layer and the 20-record Hong Kong/Macau/Taiwan audit. A failed gate writes a status audit and does not create a partial final dataset.

Before any public-branch commit, run `node scripts/validate-public-boundary.mjs`. Its manifest confirms that the static fact layer contains no coordinates, provider caches or raw candidate fields, and that the runtime marker layer is separate from the public static directory. A raw-bearing Git history remains a clean-branch handoff warning.

The AMap runtime route is part of the current publication candidate. Account/domain/commercial compliance and security-key rotation are production operations, not blockers for parser, frontend, local preview, tests or QA work.

## Internal local preview

`scripts/build-local-preview.mjs` is a development/QA-only builder. It reads the existing mainland audit, selects only `accepted-high` results (including existing reviewed overrides), and writes provider GCJ-02 plus a local WGS84 preview coordinate for legacy audit comparisons. It does not turn automatic-medium, ambiguous, location-only or unresolved rows into reviewed conclusions. The public and private AMap frontends use the original GCJ-02 fields directly.

The public frontend reads the static fact layer and then requests the minimal runtime marker layer from `/api/public/markers`. The legacy `?preview=local` path remains explicitly local-only. The private frontend reads `dist-private/`; neither frontend reads provider cache.

## Derivation rules

- Former names require explicit grammar. Other lines remain `unparsedNameLines` and the original name remains in `nameRaw`.
- Projection dimensions are separate: technology, GT/XT geometry, Dome, 3D, film and audio channels.
- Multiple screen values remain raw and structured values remain null unless a high-confidence rule selects one.
- Status events are parsed chronologically. Dated later reopen/open events supersede earlier closure; planned/future events do not establish current open status.
- AMap provider coordinates remain GCJ-02 and are never overwritten by converted WGS84 values.
- Venue and mall coordinates describe physical location only; they do not establish exact auditorium identity.

## Geocoding layers

Automatic, reviewed and unresolved decisions remain distinguishable. Each selected point carries decision origin, confidence, granularity, provider provenance and CRS. Provider caches are private and gitignored. See [GEOCODING.md](GEOCODING.md).
