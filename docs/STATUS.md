# Taleus — Status & Open Items

A working checklist of items that are awkward to file as individual tickets, plus **cross-repo**
items (Sereus / Optimystic / Quereus) that Taleus depends on but cannot fix itself. This file is
**not timeless** — prune entries as they land. Timeless design lives in [`docs/`](.); discrete work
items live in [`tickets/`](../tickets/).

## Cross-repo: stack hardening Taleus depends on

Taleus's entire safety model rests on the Sereus/Optimystic/Quereus substrate enforcing signature-
and existence-constraints on every write. The following are **not** Taleus bugs — they are
dependencies to confirm or harden in the sibling repos. A fuller write-up (with file:line
citations) is prepared separately for transmission to Nathan; this is the digest.

- [ ] **Read-dependency validation must be live on the consensus commit path.** The schema's
  concurrency safety (concurrent double-revocation not locking a party out; single-finalize;
  finalize-vs-void exclusion) relies on Optimystic rejecting a transaction whose read set went
  stale, then forcing a retry that re-evaluates correctly. The core stale-read check appears
  implemented, but wiring it fully into cluster consensus is flagged as partly future work.
  **Acceptance:** a two-node integration test that fires the concurrent double-revocation and
  asserts exactly one transaction commits.
- [ ] **Transactor-backing rule (load-bearing safety invariant).** Tally strands **must** bind to
  the synchronous Optimystic **network transactor**. The stack also has a `quereus-sync`
  last-write-wins CRDT/KV replication path that writes column deltas straight to storage and
  **does not fire SQL constraints at all**. Routing a tally strand through that path would silently
  void every signature gate, credit gate, and balance-chain check. This choice belongs in the
  runner/wiring layer that does not exist yet, so it is easy to get wrong by default — pin it.
- [ ] **Partition behavior for time-sensitive actions.** Optimystic is CP: a cadre in the minority
  partition cannot commit, so a party **cannot revoke a stolen key while partitioned**, widening
  the key-compromise race window by the partition duration. Understand and document the bound.
- [ ] **Per-node latch-deadlock bug** on concurrent writes to the same block (Optimystic internals):
  a local liveness bug, not an isolation-correctness hole. Track its fix upstream.

## Taleus design docs — written (this pass)

- [x] `docs/index.md` — front door / table of contents (`AGENTS.md` repointed).
- [x] `docs/trading-variables.md` — two-sets (4-per-party) model and number-line economics.
- [x] `docs/denominations.md` — UoA quantification (designator / integer sub-units / multiplier + descriptor).
- [x] `docs/tally-lifecycle.md` — negotiation state machine, contract governance, rights invariant, wedged-state taxonomy.
- [x] `docs/concurrency-model.md` — CRDT lens + the isolation finding above.
- [x] `docs/drafts/credit-terms.md` — **draft** (not settled): rich-terms roadmap (interest / amortization / vesting).

Possible future split: break `architecture.md` into topic files if it grows unwieldy (manageable as one
file for now).

## Taleus open decisions / small items

- [ ] **Rename `chipnet` → `tallyNet`** (or similar): branding sweep across docs, code (`src/lift/`,
  `src/transport/`, `/taleus/chipnet/1.0.0`), and tickets. (Noted in `docs/index.md`; sweep not yet done.)
- [ ] **Rational vs. decimal denomination multiplier** — decide whether to extend beyond `10^n` for
  non-decimal units, and if so carry the rational in the `cid:` descriptor's `canonicalUnit`. Captured in
  `docs/denominations.md`; decision open.
- [x] **Contract-governance principle** — captured in `docs/tally-lifecycle.md § Contract governance`
  (direct chits grantor-authorized anytime; lift chits per signed trading variables; good-faith timing).
- [x] **Lift-chit ↔ trading-variable conformance is agent-enforced, not schema-gated** — documented in
  `docs/trading-variables.md` (pledge is self-signed; `LiftLading` is advisory; hard gate is the credit
  limit). Confirm-no-schema-guard stands as the resolved position; revisit only if a concrete attack appears.

## Apps (planned)

The engine (Nathan's work) is consumed by apps. Kyle authors these using the **appeus** format
(story-driven app authoring, as in `ser/health`, `ser/chat`).

- [ ] Build an `apps/` folder in the repo to house engine-consuming apps.
- [ ] Initialize the appeus format there.
- [ ] Author the initial user stories.

(Distinct from the existing `packages/taleus-app` placeholder, which is the Svelte Native mobile client
scaffold — see `tickets/backlog/feat-taleus-app-shell.md`. Reconcile the two when the apps work starts.)

## Tickets spawned from the MyCHIPs-comparison analysis

- `tickets/backlog/feat-schema-rich-credit-terms.md` — **regression fix (committed):** restore interest /
  amortization / grace / minimum-payment / prepayment / maturity-vesting; design space in
  `docs/drafts/credit-terms.md`.
- `tickets/backlog/feat-schema-tally-state.md` — **regression fix:** materialize forming/offer/open/void
  negotiation state (MyCHIPs' signing dance), left only implicit in the reboot.
- `tickets/backlog/debt-tally-close-no-reopen.md` — terminal close / no reversal of a mistaken final payment.
- `tickets/backlog/feat-lift-healing.md` — repair a half-broken lift (partition / refuser / silent referee). **Speculative** — needs a dedicated design pass before implementation.
- Existing, re-scoped by this analysis: `feat-lift-timeout-release.md` (stuck pending lift),
  `feat-multi-referee-consensus.md` (single-referee third-party value-loss).
