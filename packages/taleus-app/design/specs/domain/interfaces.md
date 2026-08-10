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

## Tally lifecycle

States are **derived** from what the tally records, not stored as a status field. Because both
parties share one tally (`docs/architecture.md`, *one logical database*), there is no separate
"sent" or "acknowledged" step to track — a thing either exists in the tally or it does not.

| State | The tally holds | Who acts next |
|-------|-----------------|---------------|
| Forming | No offer yet | the party who invited |
| Offered | An unexpired offer signed by one party | the other party |
| Expired | An offer past its expiry, never countersigned | either — re-offer or abandon |
| Open | An agreement signed by both | either — trade |
| Amending | An agreement, plus a later offer awaiting a second signature | the party who did not make the later offer |
| Closing | A close request, balance not yet settled | either — settle |
| Closed | A close request and a settled zero balance | nobody |

"Who acts next" is what drives a party's attention list. It follows from which side made the
outstanding offer, so the apps never need a separate notion of whose turn it is.

## Vocabulary

User-facing terms map to platform terms: **tally** is a two-party strand, a party's devices form a
**cadre**. Stories and specs use the user-facing term.
