----
description: Review the schema change that lets a party register several signing keys on a tally and revoke a lost or stolen one, so losing a single device no longer locks the party out.
files: schema/draft1.qsql, docs/architecture.md
difficulty: hard
----

# Review: multi-key registration + revocation for `PartyKey`

Implements `implement/1-key-multi-and-revoke`. Turns `PartyKey` from a sole-authority
linear chain into an **authorized-key set with revocation**, and converts every
signature-gated table to name its signer explicitly (`SignerKey`) resolved against that set.

**No Taleus test runner or build exists (design-phase schema).** Validation is
constraint-inspection against Quereus semantics — the walkthroughs below are the intended
check. Treat them as a floor, not a ceiling.

## What changed

`schema/draft1.qsql`:
- **`PartyKey` redesigned**: added `AuthKey` (the authorizing key; null for genesis). New
  constraints `UniqueKey`, `AuthKeyAuthorized`; generalized `SignatureValid` (genesis → invitation
  key, later → `AuthKey`); kept `TwoParties` (fixed the old `TwoParities` typo / stray paren / `= 2`→`<= 2`).
- **`PartyKeyRevocation` (new)**: `TargetAuthorized`, `RevokerAuthorized`, `SignatureValid`,
  `NotLastKey`, `InsertOnly`. Carries the stolen-key race-window `NOTE:`.
- **`AuthorizedKey` view (new)**: registered `PartyKey` minus revoked = the authorized set.
- **`SignerKey` conversion** on `Stock`, `PartyCertificate`, `TradingVariable`,
  `TallyContract` (×2 — `StockSignerKey`/`FoilSignerKey`, each resolved against its own side),
  `TallyContractProposal`, `Ledger`. Removed every `order by Revision desc limit 1` latest-key
  lookup; fixed the `ProposerSid`/`IssuerSid`-as-public-key placeholder in passing.

`docs/architecture.md`: rewrote the `PartyKey` table row, added `PartyKeyRevocation`; rewrote
the signature-gating bullet for the set model + a deferred-snapshot bullet; noted the
`AuthorizedKey` view; added a **Key recovery** subsection (cadre-assisted + total-loss,
aligned with Sereus `AuthorityKey`, forward-referencing `key-counterparty-rekey`).

## The one thing to understand before reviewing: deferred-constraint snapshots

This drove most decisions and is where I **deliberately diverged from the ticket's literal
SQL sketch**. Confirmed in-engine (`../quereus/.../constraint-builder.ts`, deferred-constraint
queue, and test `43-transition-constraints.sqllogic`):

> A `CHECK` containing a sub-query is evaluated at **commit**. A **plain** table reference
> there (`from PartyKey`) reads buffered+committed state → **it includes the row being
> inserted**. `from committed.PartyKey` reads the pre-transaction snapshot → **it excludes it**.

Consequences (all handled; verify the reasoning):

1. **`RevisionMonotonicInt` as sketched always fails.** `Revision = max(Revision from PartyKey) + 1`
   with a plain ref sees the new row, so `max` *is* the new row → `R = R+1`. Fixed with
   `committed.PartyKey`. (The sibling tables still have this bug — see Gaps.)
2. **`AuthKeyAuthorized` against the live view is a security hole.** The live `AuthorizedKey`
   view already contains the new row, so an attacker inserting `AuthKey = New.PublicKey`
   (a key naming *itself* as authorizer) would self-validate and mint authority under a
   victim's `Sid` from nothing. Fixed by checking `AuthKey` against `committed.PartyKey`
   minus `committed.PartyKeyRevocation`. **This is the highest-value thing to re-verify.**
3. **`NotLastKey` is `>= 1` on the post-revoke set, not `> 1` pre-revoke.** The view already
   reflects the in-flight revocation, so the count is the set *after* the revoke; `>= 1`
   means "at least one remains". This is strictly safer than the sketch: a batch of
   revocations that would empty the set is also visible at commit and rejected.
4. **`TargetAuthorized` reads `PartyKey`, not the view** — the view already excludes the
   target once the revocation row is buffered, so a view-based check would reject every
   revocation. Double-revocation is instead blocked by the `(Sid, PublicKey)` primary key.

## Validation walkthroughs (use cases to check by inspection)

Authority lifecycle:
- **Genesis add (rev 1)**: `AuthKey` null, signed by invitation key, `Sid` = hash(pubkey).
  Passes `RevisionMonotonicInt` (committed empty → 1), `AuthKeyAuthorized` (rev-1 branch),
  `SignatureValid` (invitation key), `TwoParties`.
- **Second device add (rev 2)**: `AuthKey` = the committed rev-1 key, signed by it → passes.
- **Self-authorization attack (rev 2, `AuthKey` = own new PublicKey)** → `AuthKeyAuthorized`
  MUST reject (committed snapshot lacks the key). *Security-critical.*
- **Add authorized by a revoked key** → `AuthKeyAuthorized`'s `not exists committed.PartyKeyRevocation`
  MUST reject.
- **Re-add a revoked (or any existing) key** → `UniqueKey` count = 2 → reject; a revoked key
  can never be resurrected.
- **Concurrent rev-2 from two surviving devices** → both read committed `max = 1`, both write
  `Revision = 2`; `(Sid, Revision)` PK + Optimystic ordering serialize, loser rejected.

Revocation:
- **Revoke one of two keys** → post-revoke `AuthorizedKey` count = 1, `NotLastKey >= 1` → allow.
- **Revoke the only key** → count = 0 → reject.
- **Batch-revoke both keys in one txn** → both see count = 0 → both rejected (no lockout).
- **Revoked key attempts a revocation** (`RevokedBy` = a revoked key) → `RevokerAuthorized`
  (view excludes it) → reject.
- **Genesis-key revocation while another key remains** → allowed; `Sid` unchanged; `TwoParties` holds.

Signer resolution + history:
- Each signed table: `SignerKey` must be in `AuthorizedKey` of the correct issuer `Sid`;
  `TallyContract`'s two sides resolve independently against `StockSid` / `FoilSid`.
- **Past rows stay valid after revocation**: a `Ledger`/`TallyContract` row committed before a
  revoke is insert-only and never re-validated — confirm no constraint re-checks committed
  rows against the current key set (would retroactively break history).

## Known gaps / things I could not fully verify (please probe)

- **View-inside-CHECK-subquery is unproven.** All the `SignerAuthorized`/`RevokerAuthorized`/
  `NotLastKey` checks reference the `AuthorizedKey` **view** inside a constraint sub-query. I
  confirmed `committed.<table>` works in a CHECK, but found **no Quereus test exercising a
  *view* referenced from a CHECK sub-query**. If Quereus doesn't expand views there, these must
  be inlined. **This is the top item to confirm once any runner exists.**
- **Schema does not load standalone.** Undefined draft symbols remain — `TallyCore`, `StockSid`,
  `FoilSid`, `IssuerSid`, `Cid` (owned by backlog `debt-schema-core-tables`). So even inspection
  can't be a live load yet. In scope per the ticket ("keep this diff scoped to key authority").
- **Sibling tables still have the snapshot bug.** `PartyCertificate.RevisionMonotonicInt`,
  `TradingVariable.RevisionMonotonicInt`, and `Ledger.BalanceCorrect` keep the plain-self-ref
  pattern (out of this ticket's scope). Filed as backlog **`debt-deferred-constraint-snapshots`**.
- **`SignerKey` is not part of the signed `Digest`.** Verification binds it implicitly (a row
  can't claim a `SignerKey` it didn't actually sign with — the signature wouldn't verify).
  Intentional and matches the sketch; confirm you agree it's sound.
- **Follow-up seam (`key-counterparty-rekey`) — flag for that ticket.** It plans to extend the
  `AuthorizedKey` *view* to union adopted keys. But the authorized-set logic also lives
  **inlined as `committed.*`** in `PartyKey.AuthKeyAuthorized` (and the committed snapshot in
  `RevisionMonotonicInt`). Extending only the view would silently miss those: an adopted key
  would not be able to authorize further adds. The follow-up must extend both the view and the
  inlined committed checks (and treat `committed.PartyKeyAdoption` as an authorizer).
- **Self-revocation unsupported.** A key naming itself as `RevokedBy` is excluded by the same
  in-flight row → `RevokerAuthorized` rejects it. Retiring a device is expected to be done from
  another surviving device. Confirm that UX assumption.
- **Chained add in one txn unsupported.** Adding rev 2 (auth by rev 1) and rev 3 (auth by rev 2)
  in a single transaction fails — `committed.*` won't see rev 2. Keys must be added one txn at a
  time. Acceptable; noted.

## Review findings

- Diverged from the ticket's literal SQL in three places for correctness under Quereus deferred
  semantics (`RevisionMonotonicInt` → `committed.*`; `NotLastKey` → `>= 1` post-revoke;
  `TargetAuthorized` → `PartyKey` not the view). Rationale in the `schema/draft1.qsql` comments.
- Closed a self-authorization hole in `AuthKeyAuthorized` (would otherwise mint authority from a
  self-naming key) by checking against `committed.*`.
- Tripwire noted at the revocation site (`schema/draft1.qsql`, `PartyKeyRevocation` header
  `NOTE:`): stolen-key theft→revoke race window is inherent and left open by design.
- Filed backlog `debt-deferred-constraint-snapshots` for the same plain-snapshot bug on
  `PartyCertificate`, `TradingVariable`, and `Ledger` (out of this ticket's scope).
- Unverified assumption flagged above: views referenced inside CHECK sub-queries — the single
  most load-bearing thing to confirm when a runner exists.
