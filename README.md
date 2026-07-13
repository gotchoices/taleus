# Taleus

<p align="center"><img src="docs/images/logo.svg" alt="Taleus" width="180"/></p>

Taleus is a peer-to-peer private credit system — a reboot of [MyCHIPs](https://github.com/gotchoices/mychips) on the [Sereus](https://sereus.org) platform. Two parties who trust each other form a **tally**: a digital credit agreement recorded in a shared database that only they control. Value moves by signed pledges (**chits**), and balances clear across the wider web of tallies through cooperative **lift** transactions — money as pure relationship credit, with no bank, token, or hosted server in the middle.

### Why Taleus

- **No hosts**: MyCHIPs required each user to have an account on a server. In Taleus, your presence is your own devices (a Sereus **cadre**) — phone alone works; add a cloud or home node for durability.
- **One shared ledger per relationship**: A tally is a private two-party Sereus **strand** — a replicated SQL database spanning both parties' devices. No dual-copy reconciliation protocol; consistency comes from the platform.
- **Rules enforced by the database itself**: Every tally rule — signatures, key rotation, balance chaining, insert-only history — is a declarative Quereus constraint. An invalid row simply cannot commit on any honest node.
- **Credit clearing without global visibility**: Lifts discover routes and commit atomically through the tally graph (via [ChipNet](https://github.com/gotchoices/chipnet)) while each party sees only their own relationships.
- **Any denomination**: Each tally's contract chooses its unit of account — CHIPs, a national currency, hours of labor. Party-posted exchange rates let lifts and payments route across denomination boundaries.

### Core Concepts

- **Tally**: a credit relationship between two parties (**stock** = vendor side, **foil** = client side), embodied as one closed two-party strand.
- **Chit**: a signed pledge of value; the tally balance is the running sum, in integer units of the tally's denomination.
- **Contract & terms**: a content-addressed legal agreement both parties sign, carrying the denomination and credit terms; trading variables and exchange rates govern automated lifts.
- **Lift**: an atomic transaction around a cycle of tallies that moves balances toward targets without changing anyone's net worth.

### Technology Stack

- **[Sereus](https://sereus.org)** — cadres, strands, invitation-based formation, hibernation, mobile wake (`../sereus`).
- **Quereus** — SQL engine with signature-verifying declarative constraints (`../quereus`).
- **Optimystic** — distributed storage and transactions (`../optimystic`).
- **ChipNet** — lift route discovery and consensus (callback-based; reuse under evaluation).
- **Client**: TypeScript + Svelte Native, embedding a cadre node directly.

### Repo Layout

- `docs/` — design and architecture. **Start with [`docs/architecture.md`](docs/architecture.md).**
- `docs/old/` — legacy docs from the pre-Sereus prototype (reference only).
- `schema/` — Quereus sApp schema.
- `tickets/` and `tess/` — AI-driven ticket workflow (see [`tess/agent-rules/tickets.md`](tess/agent-rules/tickets.md)).

### Status

Design phase. The architecture (tally-as-strand, schema-enforced integrity, Sereus formation) is settled; work is tracked as tickets in [`tickets/`](tickets/).

### Credits

Taleus is a project of the GotChoices Foundation, building on the MyCHIPs design by Kyle Bateman.
