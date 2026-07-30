# Interfaces

Where app-observable behavior comes from, and what stays authoritative elsewhere.

## Canonical sources (do not restate here)

| Concern | Lives in |
|---------|----------|
| System design, formation, lifts, recovery | `docs/architecture.md` |
| Data model + constraints | `packages/taleus/schema/draft1.qsql` |
| Trading variables | MyCHIPs `schema/tallies.wmt` |

## Engine boundary

Apps read and write tally/chit state only through the `taleus` engine. Quereus, Optimystic, and the
cadre are engine-internal; no target depends on them directly.

## Run modes

One switch point in the data layer. Screens distinguish only mock from engine.

| Mode | Behavior |
|------|----------|
| mock | Fixtures from `mock/data/*` with `variant=happy\|empty\|error`. No engine. |
| engine + local store | Engine over a local database, single device, no peers. |
| engine + cadre | Engine over the embedded cadre node: real strands, peers, lifts. |

## Vocabulary

User-facing terms map to platform terms: **tally** is a two-party strand, a party's devices form a
**cadre**. Stories and specs use the user-facing term.
