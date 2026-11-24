# tallynet

Lift protocol library for Taleus: route discovery across the tally graph and atomic promise/commit of a lift across many tally strands. A port of [ChipNet](https://github.com/gotchoices/ChipNet), extended for tallies kept in different denominations.

**Status:** not yet scaffolded. This folder holds the design handoff; the code is built through the tess tickets named below.

- [docs/design.md](docs/design.md): what TallyNet is, its boundaries with `taleus-core`, the changes from ChipNet, the multi-denomination extension, and the testing approach.
- [docs/chipnet-review.md](docs/chipnet-review.md): the upstream ChipNet (and ChipCrypt, ChipCryptBase, ChipCode) assessment: architecture, data model, verified defects, unbuilt features.

## Work queue (tess)

Tickets live in the repo's [`tickets/`](../../tickets/) folder and are run with [tess](../../tess/README.md):

| Stage | Ticket | What |
|---|---|---|
| implement | `1-tallynet-scaffold` | Package skeleton, crypto ports, session codes, canonical digest, sequencing helpers |
| plan | `2-tallynet-discovery` | Unidirectional discovery port with fixes and durable/in-flight state split |
| plan | `3-tallynet-consensus` | Promise/commit state machine rewrite |
| plan | `4-tallynet-bind-taleus-core` | Replace `taleus-core`'s ChipNet stand-ins with TallyNet; rename sweep. Single-denomination lifts work end to end after this |
| plan | `5-tallynet-multi-denomination` | Hop-context negotiation, return-path conversion |
| plan | `6-feat-multi-referee-consensus` | Taleus schema verifies a referee set + majority, not one referee |
| backlog | `feat-tallynet-lift-identity-options`, `debt-referee-sees-tally-id`, `feat-tallynet-routing-hints`, `feat-tallynet-trust-query`, `feat-tallynet-bidirectional-search`, `feat-tallynet-propagation-timeouts`, `debt-tallynet-query-economics` | Deferred protocol features |

After that come the existing `feat-taleus-node-service` (the always-on agent) and `feat-portfolio-app-wiring` (quotes and lift journal at runtime).
