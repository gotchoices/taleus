----
description: Reviewed and completed the schema change that lets a party register several signing keys on a tally and revoke a lost or stolen one, so losing a single device no longer locks the party out.
files: schema/draft1.qsql, docs/architecture.md
difficulty: hard
----

# Complete: multi-key registration + revocation for `PartyKey`

Turned `PartyKey` from a sole-authority linear chain into an **authorized-key set with
revocation** (new `PartyKeyRevocation` table + `AuthorizedKey` view), and converted every
signature-gated table to name its signer explicitly via a `SignerKey` column resolved against
that set. Identity (`Sid` = hash of the genesis key) stays stable; the key set evolves under it.
Enables cadre-assisted device-loss recovery without counterparty involvement; total-loss
recovery is deferred to the follow-up `key-counterparty-rekey`.

Implemented in `f4ca067`; reviewed and finalized here.

## Review findings

Adversarial pass over the implement diff (schema constraints + docs). Design-phase: no Taleus
build/test/lint exists (repo has no `package.json`; only `schema/draft1.qsql`), so validation is
constraint inspection against Quereus semantics plus source-level verification of the engine
assumptions the whole design rests on.

### Checked and CONFIRMED — the load-bearing engine assumptions (were flagged "unverified")

The implementer left three Quereus-behavior assumptions open. Verified all three against Quereus
source (`C:\projects\quereus`), so they are no longer guesses:

- **Deferred subquery CHECKs evaluate at COMMIT.** CONFIRMED — `planner/building/constraint-builder.ts:195`
  (`needsDeferred = containsSubquery || containsCommittedRef`); test `43-transition-constraints.sqllogic`.
  (Caveat: under non-default conflict resolution (IGNORE/REPLACE) a deferred CHECK evaluates at
  row-time instead — not reachable here; all these constraints are plain `on insert`.)
- **`committed.<table>` reads the pre-transaction snapshot (excludes the in-flight row); a plain
  ref reads buffered+committed (includes it).** CONFIRMED — `planner/building/schema-resolution.ts:12`
  (`COMMITTED_SCHEMA`), `vtab/memory/table.ts:266` (`readCommitted ? readLayer : pendingTransactionLayer`);
  test `42-committed-snapshot.sqllogic`. This is what makes the security-critical `AuthKeyAuthorized`
  fix real: a self-authorizing add (`AuthKey = New.PublicKey`) is rejected because `committed.*`
  cannot see the new row. `New.`/`Old.` row aliases also confirmed (`constraint-builder.ts:121`).
- **A user-defined VIEW works inside a CHECK sub-query.** CONFIRMED by mechanism — `planner/building/select.ts:393`
  (`buildFrom` inlines a view wherever a base table is accepted, including constraint sub-queries;
  no base-table-only guard anywhere in the constraint/assertion builders). This resolves the
  implementer's single highest-risk open item in the schema's favor. **But** Quereus has *no test*
  exercising a view inside a CHECK → recorded as a tripwire (below), not a defect.

### Found and FIXED inline (minor)

- **Doc drift** — `docs/architecture.md` "Ledger Operation" said a chit is "signed with their
  current `PartyKey`", stale under the authorized-set/`SignerKey` model. Rewrote to "one of the
  issuer's authorized `PartyKey`s (named in the row's `SignerKey`)".

### Tripwires recorded (conditional; NOT tickets)

- **Concurrent independent revocations can empty the key set.** `NotLastKey` provably blocks
  emptying the set *within one transaction*, but two concurrent, independent revocation
  transactions (device A revokes B's key while device B revokes A's key — each alone leaves ≥1)
  share no primary key and don't conflict at the PK, unlike concurrent adds. Last-key safety then
  depends on Optimystic re-evaluating the deferred CHECK against the *latest committed* snapshot at
  each commit. Fine if it does; a self-lockout if it validates only against a transaction's original
  read snapshot. Conditional on Optimystic isolation semantics (unverifiable at design phase) →
  `NOTE:` at the `NotLastKey` constraint (`schema/draft1.qsql`), with the fallback (serialize
  revocations per `Sid`) if the engine turns out not to re-validate.
- **View-inside-CHECK confirmed by mechanism but untested in Quereus.** `NOTE:` at the
  `AuthorizedKey` view (`schema/draft1.qsql`) recording the confirmation, the missing test, and the
  fallback (inline the view body into each referencing constraint) if a future runner rejects it.
  Left as a tripwire rather than a cross-repo Quereus test ticket — mechanism is sound and there is
  no Taleus runner yet to exercise it.

### Found earlier, already filed (verified real, out of this ticket's scope)

- **Sibling tables keep the plain-self-ref snapshot bug** — `PartyCertificate.RevisionMonotonicInt`,
  `TradingVariable.RevisionMonotonicInt`, and `Ledger.BalanceCorrect`. Confirmed real: e.g.
  `Ledger.BalanceCorrect`'s `select Balance from Ledger where Number = Number - 1` has `Number =
  Number - 1` always false (compares a column to itself), so balance never chains — two bugs in one.
  Tracked in backlog `debt-deferred-constraint-snapshots` (created by the implement stage); overlaps
  `debt-schema-core-tables`. Not re-filed.

### Checked and CLEAN (explicitly, with reason)

- **Self-authorization / authority-minting** — `AuthKeyAuthorized` uses `committed.*` (both the
  add-authorizer lookup and the not-revoked check), so a key naming itself as authorizer, or one
  authorized by a revoked key, is rejected. Sound.
- **Two-party invariant** — `TwoParties` (`count(distinct Sid) <= 2`, plain ref including the new
  row) blocks any third `Sid`; a stray extra genesis fails it. Adds/revokes cannot introduce a party.
- **History immutability** — every signed table is `InsertOnly` and gates on `on insert` only;
  committed rows are never re-validated against the evolving key set, so revocation is strictly
  forward-only and cannot retroactively break past `Ledger`/`TallyContract` rows.
- **`SignerKey` not in the signed `Digest`** — safe: swapping `SignerKey` to another authorized key
  makes `SignatureValid(Digest, Signature, OtherKey)` fail (signature was made by the original key),
  so it is implicitly bound. Sound.
- **Cross-party revocation** — both `TargetAuthorized` and `RevokerAuthorized` scope to `New.Sid`;
  one party cannot revoke the other's key.
- **`Foil` correctly left un-converted** — signed by the out-of-band invitation secret, not a party
  key, so it keeps its invitation-key validation (no `SignerKey`).
- **`TallyContractProposal`** — mutable negotiation cursor (no `InsertOnly`); `SignerAuthorized` /
  `SignatureValid` correctly re-validate `on insert, update`.

### Not spawned

- **No major findings** → no new `fix/`, `plan/`, or `backlog/` tickets from this review. The one
  pre-existing bug class was already filed by the implement stage; everything else is confirmed
  sound or a conditional tripwire parked at its code site.
- **No `blocked/`** — nothing here needs a human decision; the Optimystic-isolation question is a
  tripwire to confirm when a runner exists, not a design fork.

## Follow-up seam (for `key-counterparty-rekey`)

The authorized-set logic lives in two places: the `AuthorizedKey` **view** and, for the "before
this change" checks, **inlined `committed.*`** in `PartyKey.AuthKeyAuthorized`/`RevisionMonotonicInt`.
Extending only the view to union counterparty-adopted keys would silently miss the inlined checks —
an adopted key could sign but not authorize further adds. That follow-up must extend both the view
and the inlined committed checks (treating `committed.PartyKeyAdoption` as an authorizer).
