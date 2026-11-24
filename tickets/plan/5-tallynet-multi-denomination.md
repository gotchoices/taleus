description: Let a lift pass through someone who holds credit in two different currencies and is willing to convert between them, with each step of the route quoting and checking its own conversion.
prereq: tallynet-bind-taleus-core, tallynet-denomination-policy
files: packages/tallynet/, packages/tallynet/docs/design.md, packages/taleus-core/src/lift/discovery.ts, packages/taleus-core/src/lift/terms.ts, packages/taleus-core/src/lift/convert.ts, docs/architecture.md, docs/denominations.md, packages/taleus-core/schema/portfolio.qsql
difficulty: hard
----

Each tally is kept in one denomination (CHIP, a national currency or a custom unit). A lift that crosses from a tally in one denomination to a tally in another needs the party holding both to convert, at a rate it sets privately (`ExchangeRateQuote` in its portfolio). The system rules (payment stated in the payee's unit, backward conversion `req_in = ceil(req_out · RateNum · d_in / (RateDen · d_out))`, BigInt, originator absorbs the rounding, a missing or expired quote prunes the route, amounts fixed at commit) are in `docs/architecture.md` § *Denominations and Exchange* and are implemented as pure functions in `taleus-core/src/lift/convert.ts` and `discovery.ts`.

What TallyNet must provide: `packages/tallynet/docs/design.md` § Multiple denominations. Hop-context negotiation, a return-path annotation hook where each bridging node converts with its own quote, a pluggable plan-satisfaction predicate, and a promise-time per-node check. Discovery (`tallynet-discovery`) leaves the hook shapes in place and `tallynet-bind-taleus-core` wires `taleus-core` to TallyNet with the originator-side conversion that exists today; this ticket makes the hooks carry conversion end to end, changing both packages.

**Read the decisions in `tallynet-denomination-policy` first** (it must be out of `blocked/` before this runs). In particular, whether conversion happens at each bridging node on the way back (quotes stay private) or at the originator (today's `taleus-core` `accumulateRoute`, which needs every hop to disclose its quote).

## Design points to settle in this plan

- Exact hook signatures in TallyNet, and which `taleus-core` functions implement them. `convertBoundary` is reused per hop; `accumulateRoute` either becomes per-hop or stays as the originator's verification of the annotated route.
- What a plan carries back: per-edge required units (decimal strings) in each edge's own denomination, plus whatever the originator needs to show the exact source cost before commit.
- How `selectRoute` (`taleus-core/src/lift/discovery.ts:364`) compares candidates whose source edges are in different denominations (its parked NOTE says it assumes one source denomination).
- Promise-time check: a bridging node re-derives `req_in` from `req_out` with the quote it used in discovery (pinned by quote revision), not whatever is current, per architecture.md ("a quote that expires between discovery and commit still binds the discovered terms").
- Fees from trading variables compose alongside conversion (architecture.md § Cross-denomination conversion). Make sure the order of operations is the same in discovery and at promise.

## Edge cases & interactions (carry into the implement ticket(s))

- Single-denomination route: byte-identical results to before (regression).
- Two boundaries in one route; the same pair converted twice in opposite directions (A→B then B→A).
- Missing quote, expired quote, quote that expires between discovery and promise.
- Divisors differ on the same denomination (USD at 100 vs USD at 1).
- Huge amounts × huge rates (BigInt, no overflow); rate not in lowest terms.
- Rounding: dust accrues only upstream, to the originator; every intermediary and the payee get at least their exact due.
- A bridging node lies in its annotation (amounts inconsistent with any rate it could hold): its neighbours can't detect the rate, but the originator sees the total and each edge's counterparty sees its own edge. State what is and isn't checkable.
- Circular clearing lift whose cycle crosses denominations (per the policy decision).
