description: Materialize the tally's negotiation/lifecycle state (forming / offer / open / void) as a derived view, preserving MyCHIPs' draft→offer→open signing dance that the reboot left only implicit.
prereq: feat-schema-tally-core
files: packages/taleus/schema/draft1.qsql, docs/tally-lifecycle.md
difficulty: medium
----
## Why this ticket exists

MyCHIPs enforced a negotiation state machine **in the database** — `draft → offer → open`, with `H.`/`P.`/
`B.` prefixes distinguishing holder-signed / partner-signed / both-signed, and legal transitions guarded by
triggers. The Taleus reboot materializes only **Closing / Closed** (`CloseState`); **Forming / Offer /
Open / Void** are derivable from the proposal/contract tables but not exposed. This is a regression we want
to keep: a tally signed by only one party is a **contract-in-waiting**, a standing offer the counterparty
can complete unilaterally by countersigning, and that status deserves to be first-class, not inferred
ad hoc by each client.

## What's derivable today (the raw material)

- **Forming** — a `TallyCore` exists but no fully-signed `TallyContract`.
- **Offer** — a `TallyContractProposal` signed by one side (map to `H.`/`P.` by proposer).
- **Open** — the highest-numbered `TallyContract` carries **both** signatures.
- **Void** — formation abandoned (app-level; may need an explicit signal).

## What's wanted

- A `TallyState` (or `LifecycleState`) **view** composing the above with the existing `CloseState`, so one
  place answers "what state is this tally in" — including the one-side-signed offer distinction.
- Decide the **enforcement split**: which transitions (if any) are guarded by schema constraints vs. left
  to the app. MyCHIPs guarded them in-DB; Taleus may keep negotiation lighter and enforce only what
  protects value. Preserve the counter-offer semantics (a new proposal/contract revision supersedes;
  re-drafting after an offer conceptually clears the prior side's signature).

Design context in [`docs/tally-lifecycle.md`](../docs/tally-lifecycle.md) (§ States, § The negotiation
dance). No runner exists yet; capture the view + the enforcement decision.

## Inputs from the app design pass

The mobile app design (`packages/taleus-app/design/`) settled some of what this ticket anticipates,
and reopened one part of it:

- **Void may not be a state at all.** Whether a refused tally is recorded, or an unwanted offer
  simply lapses, is being decided in `feat-offer-lifecycle`. Take the answer from there rather than
  assuming MyCHIPs' `void`.
- **Simultaneous acceptance has a proposed rule**: when two proposals end up fully signed, the
  later-drafted one governs (see `docs/architecture.md`, *Offer semantics*).
- **The apps want "whose turn is it".** The derived state is most useful to a client when it also
  answers who must act next — that is what an attention list is built from
  (`feat-attention-signals`).
- The app-facing view of these states is listed in
  `packages/taleus-app/design/specs/domain/interfaces.md`.
