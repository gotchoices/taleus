----
description: Completed and reviewed — the schema change that lets the other party in a tally vouch for a replacement signing key when someone has lost every device, using the human trust between them as the recovery root.
files: schema/draft1.qsql, docs/architecture.md
difficulty: medium
----

# Complete: counterparty re-key ceremony (`PartyKeyAdoption`)

## What was built

Last-resort recovery for a party that lost **every** authorized key (all cadre nodes gone, or every
key stolen), where nothing inside the tally can otherwise sign a new key into the party's authorized
set. Authority comes from the human trust between the two parties: a bilateral ceremony where the
recovering party **self-signs** a fresh key (possession) and the **counterparty attests** it with
one of its own authorized keys.

`schema/draft1.qsql`:

- **`PartyKeyAdoption` table** — the only path that adds a key to a party's authorized set *without*
  an existing key of that party. Five guards + `InsertOnly`: `SidIsParty` (no new identity),
  `CounterpartyIsOther` (attester is the *other* party, currently authorized), `SelfSigValid`
  (adopted key signed its own adoption), `CounterpartySigValid` (attester signed the same digest),
  `UniqueKey` (not already a `PartyKey` add or a prior adoption).
- **`RegisteredKey` view** — `PartyKey` adds `union` `PartyKeyAdoption` keys, revocation-agnostic.
  `AuthorizedKey` is now `RegisteredKey` minus `PartyKeyRevocation`.
- **`PartyKeyRevocation.TargetAuthorized`** reads `RegisteredKey`, so an adopted key is revocable
  like a normal add.
- **`PartyKey.AuthKeyAuthorized`** accepts an authorizer from `committed.PartyKey` **or**
  `committed.PartyKeyAdoption` (still minus committed revocations) — so an adopted key can authorize
  new device adds, closing the prior review's "Follow-up seam".

`docs/architecture.md`: `PartyKeyAdoption` table row; views paragraph updated for
`RegisteredKey`/adoption; "Total loss" recovery bullet + two-layer ordering paragraph (Sereus
re-invite → Taleus `PartyKeyAdoption`).

## Review findings

Adversarial pass over the implement diff (commit `28d94aa`), read before the handoff. No test runner
exists — repo has no `package.json`, only `schema/draft1.qsql` (design phase), so lint/tests could
**not** be run; validation is constraint inspection against Quereus deferred-CHECK semantics, same
footing as the sibling `key-multi-and-revoke`. This is a limitation, not a pass — noted below.

**Checked, correct:**

- **Bilateral guards & the whole recovery flow.** `SidIsParty` (no third party — adoption never
  touches `PartyKey`, so `TwoParties` holds), `CounterpartyIsOther` (`AK.Sid <> New.Sid` both
  forces the attester to be the *other* party and excludes the buffered adoption row from
  self-attestation), `SelfSigValid`/`CounterpartySigValid` over `Digest(Sid, PublicKey)`,
  `UniqueKey` (both clauses), `InsertOnly`. The extended `AuthKeyAuthorized` lets an adopted key
  authorize a fresh device add — traced the full total-loss flow (adopt → add device → revoke lost
  keys) and it composes. `RevisionMonotonicInt` correctly untouched (adoption has no `Revision`).
- **`committed.*` snapshot reasoning.** `committed.PartyKeyAdoption` is a forward-referenced table,
  same resolution class as the existing `committed.PartyKeyRevocation`; excludes a same-transaction
  adoption, so an add can't bootstrap off an uncommitted adoption.
- **`Digest`/`SignatureValid` arity.** `Digest(Sid, PublicKey)` (2 args) is fine — `Digest` is used
  variadically elsewhere (3–4 args). `TallyCore.Cid` exists, so the documented tally-binding
  fallback `(select Cid from TallyCore)` is real.

**Found & fixed inline (minor — documentation correctness):**

- **The security NOTE and doc overstated the protection.** Both claimed "the self-signature still
  forces the real party to have generated the key" / "the counterparty ALONE cannot forge an
  adoption." This is **false**: `SelfSigValid` proves possession of the adopted key by *whoever
  generated it*, not specifically by the recovering party. A malicious counterparty can generate
  (or reuse) a key it controls, self-sign `Digest(Sid, PublicKey)` with it, and attest with its own
  authorized key — satisfying every guard alone. The *disposition* is right (inherent to a two-party
  human-trust root, unpreventable at this layer because in total loss the recovering party retains
  no secret inside the tally), but the stated reason was misleading and could lead an implementer to
  build UX assuming solo forgery is impossible. Corrected the NOTE at `PartyKeyAdoption`
  (`schema/draft1.qsql`) and the "Total loss" bullet (`docs/architecture.md`) to state the trust
  boundary accurately. The implement ticket's own "Counterparty can't act alone" use case already
  had this right ("If B fully controls the key it can forge both signatures"); the fix aligns the
  NOTE/doc with that.

**Tripwires recorded at their sites (not tickets):**

- **Table↔view definitional cycle.** `PartyKeyAdoption.CounterpartyIsOther` references
  `AuthorizedKey`, while `AuthorizedKey` (via `RegisteredKey`) references `PartyKeyAdoption` — an
  unbreakable cycle (each side names the other) resolved by creating the table before the views and
  relying on Quereus resolving view names at statement-build time, not DDL-creation order. Same
  forward-reference class as the existing `committed.*` table references, but new to this ticket and
  unexercised by any runner. `NOTE:` added at the `AuthorizedKey` view.
- **Counterparty is the recovery trust root; collusion out of scope.** `NOTE:` at
  `PartyKeyAdoption` (now corrected, see above).
- **Digest not tally-bound.** Cross-tally replay of the self-signature confers nothing without the
  local counterparty attesting; to bind, add `(select Cid from TallyCore)` to both digests. `NOTE:`
  at `PartyKeyAdoption` (unchanged).

**No major findings** — nothing warranting a new `fix`/`plan`/`backlog` ticket. The design is sound
for the design-phase schema; behavior matches intent; the only defect was inaccurate documentation
of the trust boundary, fixed in this pass.

**Empty categories (explicit):** no correctness bug in the constraints, no missing-guard gap, no
DRY/modularity issue (the `RegisteredKey` factoring is the right call), no resource/cleanup or
type-safety surface (declarative SQL, no runtime code). No new ticket filed because none of the
above surfaced.

## Known limitation carried forward

- **Inspection only, no execution.** Every "passes"/"fails" is by reading constraints, not running
  Quereus. Turning the traced use cases into real assertions against a Quereus scratch DB is the
  highest-value follow-up once a runner exists — same open item as `key-multi-and-revoke`.
- **View-in-CHECK / view-on-view / union-in-view / forward view reference** all rely on documented
  Quereus behavior confirmed against source but exercised by no test. Fallbacks recorded in the
  `AuthorizedKey` NOTE.
- **Inherited tripwire (concurrent revocations).** Still open from `key-multi-and-revoke`; adopted
  keys count toward `NotLastKey` like any other, so nothing here changes that analysis. `NOTE:` at
  `NotLastKey` stands.

## Sereus dependency (documented, not built here)

The ceremony presupposes the recovering cadre is already back in the strand. Re-admission is a
Sereus-layer step (invite → join handshake / `addMemberByAuthority`) and a sequencing dependency,
not a schema constraint — documented in `docs/architecture.md`, not enforced in the schema.
