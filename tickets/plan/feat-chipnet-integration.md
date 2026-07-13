----
description: Work out how lift route discovery and atomic commit run in the serverless network — reusing the existing ChipNet library if it fits, including support for crossing denominations.
prereq: feat-exchange-rate-quotes, feat-schema-lift-chits
files: docs/architecture.md
----
ChipNet ([gotchoices/chipnet](https://github.com/gotchoices/chipnet)) provides route discovery and lift consensus for MyCHIPs, designed around callback-based transport. Architecture.md assumes it carries over; this ticket validates that and specifies the integration.

Requirements / questions to resolve:
- **Transport binding**: define `/taleus/chipnet/1.0.0` — a lightweight libp2p protocol between tally partners' cadres carrying ChipNet messages; map ChipNet's comms callbacks onto it. Decide which cadre node speaks for the party (the always-on lift-agent node; fallback behavior for phone-only parties).
- **Identity/address mapping**: ChipNet's node/link abstractions vs. Taleus's party `Sid`s and per-tally strands; ensure route queries don't leak more graph knowledge than MyCHIPs' model does.
- **Referee model**: who referees a lift in a serverless network — a mutually agreed third party's cadre, dedicated infrastructure nodes, or ChipNet's existing referee selection. The referee key must be nameable in each tally's pending lift chit (`feat-schema-lift-chits`) so every strand can verify the commit signature locally.
- **Denomination-aware discovery**: extend/configure route queries to carry per-hop denomination + rate (per `feat-denomination-argument` + `feat-exchange-rate-quotes`; the exact conversion+rounding formula and rate-quote structure are specified there and in `docs/architecture.md` § Denominations and Exchange) and accumulate the conversion product; capacity advertisement derives from trading variables + credit terms + pending chits.
- **Mobile/offline participation**: hibernating parties can't answer discovery; define opportunistic participation (answer while awake, push-wake for commit windows) and the bias toward routes through always-on agents.
- **Reboot criterion**: if the impedance mismatch (identity model, referee, denomination extension per `feat-exchange-rate-quotes`) exceeds the cost of a purpose-built implementation on Sereus primitives, recommend a reboot instead — with an explicit comparison, since this is the fork in the road for the whole lift subsystem.

Expected outcome: an integration design (or reboot recommendation) detailed enough to spawn implement tickets for the lift agent, transport, and referee flow.
