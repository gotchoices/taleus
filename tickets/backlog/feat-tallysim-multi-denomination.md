description: Let the network simulator hold tallies in several currencies and have some simulated people convert between them at their own private rates, to test and measure TallyNet's currency-crossing lifts before Taleus's real conversion code is connected.
prereq: tallynet-voter-model
files: packages/tallysim/, packages/tallynet/src/discovery/hooks.ts, packages/tallynet/docs/design.md, docs/architecture.md (§ Denominations and Exchange), packages/taleus-core/src/lift/convert.ts (read only)
----

TallyNet already has the hook shapes for crossing currencies (hop-context `negotiateIntent`, `annotateReturn` on the return path, pluggable `planSatisfies`; `packages/tallynet/docs/design.md` § Multiple denominations). Taleus's conversion math is pure functions in `taleus-core/src/lift/convert.ts`. Before binding, exercise the hooks in `tallysim` with simple simulated policies: tallies in several denominations, a fraction of entities holding directional quotes, conversion on the return path at each converter, rounding absorbed by the originator.

Measure: how lift success depends on the share of entities willing to convert and on how currencies cluster, plus rounding dust and path length. Settles the open question in `design.md` (how a hop beyond a currency boundary checks capacity on the outward pass) with data.

The real Taleus conversion is wired in `feat-tallynet-multi-denomination` after `feat-tallynet-bind-taleus-core`.
