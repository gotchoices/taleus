description: Rebuild the part of the lift-routing library that gets everyone on a found route to sign on, and a referee to finalize or cancel, so that a lift settles everywhere or nowhere; the original version never actually checks signatures.
prereq: tallynet-scaffold, tallynet-discovery
files: packages/tallynet/, packages/tallynet/docs/design.md, packages/tallynet/docs/chipnet-review.md, packages/taleus-core/src/lift/commit.ts, packages/taleus-core/src/lift/referee.ts, packages/taleus-core/src/lift/digest.ts, docs/architecture.md
difficulty: hard
----

Rewrite ChipNet's transaction module (`../chipnet/src/transaction/`) as `packages/tallynet/src/consensus/`. Keep its model: a self-describing record (`transactionCode`, `sessionCode`, payload, topology, promise signatures, commit signatures), merged by union, pushed to reachable members until settled; participants promise, referees vote, a majority settles. **Do not port the code line by line**: its signature verification is a no-op, and sign and verify disagree on the digest. See `packages/tallynet/docs/chipnet-review.md` § Transaction, § Transaction module defects (every row there must be addressed), and `docs/design.md` § Protocol design.

How Taleus uses the result: `docs/architecture.md` § *Referee model and the commit seam*. The referee signs TallyNet's whole-record commit **and**, separately, a per-edge Taleus digest the schema verifies; per-edge signatures ride in the payload. `taleus-core`'s `ConsensusEngine.resolve(record)` (`src/lift/commit.ts:341`) and `SingleReferee` (`src/lift/referee.ts:83`, which takes an injected record-digest function) are the consumers.

## Design points to settle in this plan

- **Signed preimage.** `digest(kind, record-without-signatures, [promises for commit])` over the canonical encoder from `tallynet-scaffold`, where `kind` ∈ promise / no-promise / commit / no-commit (or void) is inside the signed bytes. Export the record-digest function for the Taleus referee.
- **Resource ordering.** `shouldPromise` (policy) runs before `promise` (hold); a refusal never holds. `release(success)` runs exactly once per transaction, idempotently across restarts.
- **Outcome rules.** Empty referee set: invalid record. Majority threshold and tie handling are explicit and tested (tie → no consensus yet; never both). Referee sets as in ChipNet: any participant nominates referees via `dependsOn`; majority of the set settles; test sets of 1, 2 (tie) and 3. Taleus's one-referee limit is its own policy, not TallyNet's.
- **Membership.** One address may appear on several links (circular lift through the originator); "our links" = all in/out links of our address. Duplicate member entries for one address: invalid.
- **Reachability.** Push to members with a dialable address plus direct link neighbours, as ChipNet does; skip a peer whose last-acknowledged copy equals ours. Record per-peer push failures (logged once, not twice).
- **Validation of a new record** (ChipNet's TODOs at `participant.ts:210-212`): codes valid and unexpired; topology well-formed; our in/out links' terms are what we agreed to in discovery (hand them to `shouldPromise`). Stash what's needed from discovery to check that (the nonce→link map).
- **State port** (`TrxStore`): records, peer copies, released flag, logs. Serialisable for a SQL-backed implementation; in-memory implementation for tests.
- **Out of scope** (backlog `feat-tallynet-propagation-timeouts`): pre-promise void, void-on-timeout, stalled-transaction recovery, ring/star convergence. Leave a clear extension point (a record "expires at" and a hook for a referee timeout void) and say where it is.

## Simulation readiness (required)

Same contract as `tallynet-discovery` § Simulation readiness, which settles the shapes: all time through the injected `Clock`, an optional `TraceSink` with typed events added to the same exported `TraceEvent` union, deterministic under a seeded random source and virtual clock, and the network harness extended in `tallynet/testing` (pushing records between members) rather than duplicated. Minimum consensus events: record pushed / received (to whom, signature counts), promise and no-promise signed, signature rejected (reason), referee vote, settled (commit or void), resources released. The simulator (`tallysim-consensus`) and its viewer use these to show a found route committing or voiding.

## Edge cases & interactions (carry into the implement ticket(s))

- Forged signature; signature from a non-member; a promise from a referee-only member; a commit from a non-referee.
- Signature-type substitution (a `promise` signature relabelled `no-promise`, a `commit` relabelled `void`) must fail verification.
- Replay of a signature from another transaction with the same topology.
- A member changes its signature between deliveries → reject the update.
- Payload or topology differs from the prior copy → reject.
- Expired transaction code or session code at promise time and at commit time → refuse (not approve).
- Out-of-order delivery (commit before all promises seen), duplicate delivery, delivery after settlement.
- Node restart between promise and release; `release` throws (logged, retried, never double-released).
- Single referee signs both commit and void (equivocation): what each participant does on seeing both.
- Circular topology: originator on two links.

## Tests to plan

A simulated-network harness (shared with discovery if convenient) running a 3-, 5- and 8-member route to commit and to void, plus one test per defect row in the review, plus the adversarial cases above.
