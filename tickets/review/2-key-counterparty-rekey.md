----
description: Review the schema change that lets the other party in a tally vouch for a replacement signing key when someone has lost every device, using the human trust between them as the recovery root.
files: schema/draft1.qsql, docs/architecture.md
difficulty: medium
----

# Review: counterparty re-key ceremony (`PartyKeyAdoption`)

## What was built

Last-resort recovery for a party that lost **every** authorized key (all cadre nodes gone, or
every key stolen), where nothing inside the tally can otherwise sign a new key into the party's
authorized set. Authority comes from the human trust between the two parties: a bilateral
ceremony where the recovering party **self-signs** a fresh key (possession) and the
**counterparty attests** it with one of its own authorized keys.

Changes in `schema/draft1.qsql`:

- **New `PartyKeyAdoption` table** — the only path that adds a key to a party's authorized set
  *without* an existing key of that party. Five guards + `InsertOnly`: `SidIsParty` (no new
  identity), `CounterpartyIsOther` (attester is the *other* party, currently authorized),
  `SelfSigValid` (adopted key signed its own adoption), `CounterpartySigValid` (attester signed
  the same digest), `UniqueKey` (not already a `PartyKey` add or a prior adoption).
- **New `RegisteredKey` view** — `PartyKey` adds `union` `PartyKeyAdoption` keys, revocation-
  agnostic. Factored out so the union is defined once. `AuthorizedKey` is now `RegisteredKey`
  minus `PartyKeyRevocation` (was `PartyKey` minus revocation).
- **`PartyKeyRevocation.TargetAuthorized`** now reads `RegisteredKey` (was `PartyKey`), so an
  adopted key is revocable exactly like a normal add.
- **`PartyKey.AuthKeyAuthorized`** now accepts an authorizer from `committed.PartyKey` **or**
  `committed.PartyKeyAdoption` (still minus committed revocations). This is the fix the prior
  review's "Follow-up seam" (`complete/1-key-multi-and-revoke.md`) demanded: without it an
  adopted key could *sign* existing tables but never *authorize a new device add*, silently
  breaking the recovery flow's "party adds its new devices' keys" step.

Doc changes in `docs/architecture.md`: `PartyKeyAdoption` row in the Tables list; views paragraph
updated for `RegisteredKey`/adoption; "Key recovery" → "Total loss" bullet rewritten to describe
the implemented ceremony; new paragraph spelling out the two-layer ordering **Sereus re-invite
(regain strand access) → Taleus `PartyKeyAdoption` (regain signing authority)** with the
don't-reinvent-Sereus alignment note.

## How to validate

**No Taleus test runner exists** (design phase — repo has no `package.json`, only
`schema/draft1.qsql`). Validation is **constraint inspection against Quereus deferred-CHECK
semantics** — same footing as the sibling `key-multi-and-revoke`. The load-bearing Quereus
assumptions (deferred subquery CHECK at commit; `committed.*` = pre-txn snapshot excludes the
in-flight row; a view usable inside a CHECK) were already CONFIRMED against Quereus source in that
ticket's review; this ticket adds **view-on-view** (`AuthorizedKey`→`RegisteredKey`) and a
**`union` inside a view** — both already used elsewhere in this schema (`LiftLading` reads the
`CurrentTradingVariable`/`PerspectiveBalance` views; `CurrentTradingVariable`/`PerspectiveBalance`
use `union` in a derived table), so neither is new engine risk. Worth an explicit reviewer glance
anyway, since none is exercised by a runner.

### Use cases the schema should satisfy (trace each against the constraints)

- **Happy-path total-loss adoption.** A lost all keys, generates `Ka`, self-signs
  `Digest(A, Ka)`; B attests with authorized key `Kb`. All five guards pass; `AuthorizedKey(A)`
  now includes `Ka`. Then A adds device `Kc` via `PartyKey` with `AuthKey = Ka` (passes the
  extended `AuthKeyAuthorized`), and revokes the lost keys (`TargetAuthorized` finds them in
  `RegisteredKey`; `NotLastKey` sees `Ka`/`Kc`). **Full flow must complete** — this is the whole
  point; verify the add-with-adopted-key step specifically.
- **Counterparty can't act alone.** B tries to adopt a key for A without A's self-signature →
  `SelfSigValid` fails. (If B *fully controls* the key it can forge both signatures — this is
  inherent counterparty collusion, documented out of scope; see the tripwire below.)
- **No new identity.** Adoption with an unknown `Sid` → `SidIsParty` fails. Adoption never inserts
  a `PartyKey` row, so `PartyKey.TwoParties` still holds — no third party can appear.
- **Stale/revoked counterparty key.** `CounterpartyKey` that is revoked → `CounterpartyIsOther`
  fails (reads the live `AuthorizedKey` view, which excludes revoked keys).
- **Self-attestation blocked.** An adoption row can't vouch for itself: `CounterpartyIsOther`'s
  `AK.Sid <> New.Sid` filters out the very row being inserted (its `Sid = New.Sid`).
- **Adopt when the set is non-empty** (all-keys-*stolen* case). Allowed — an honest party gets a
  counterparty-blessed fresh key before revoking the thieves. Not restricted to an empty set.
- **Replay / duplicate.** Re-adopt the same `(Sid, PublicKey)` → primary key + `UniqueKey` reject.
  Adopt a key already registered as a `PartyKey` add → `UniqueKey` first clause (`= 0`) rejects.
- **Revoke an adopted key.** After adoption, revoking `Ka` → `TargetAuthorized` finds it in
  `RegisteredKey`; verify it composes with `RevokerAuthorized`/`NotLastKey`.

## Known gaps / things to probe (treat my work as a floor)

- **Inspection only, no execution.** Every "passes"/"fails" above is by reading the constraints,
  not by running Quereus. A reviewer with a Quereus scratch DB could turn these into real
  assertions — highest-value follow-up if one becomes available.
- **Digest not tally-bound.** `Digest(Sid, PublicKey)` follows `PartyKey` precedent, not the
  chit tables' `Cid`-bound digests. I argue cross-tally replay of the self-signature grants no
  authority (each tally's counterparty must independently attest with a *locally*-authorized key),
  but a reviewer should sanity-check that reasoning. Parked as a `NOTE:` at the table.
- **`AuthKeyAuthorized` snapshot reasoning.** I added `committed.PartyKeyAdoption` as an authorizer
  source. The security claim is that `committed.*` excludes a same-transaction adoption, so an add
  can't bootstrap off an uncommitted adoption. Confirm that `committed.PartyKeyAdoption` (a
  forward-referenced table, like the existing `committed.PartyKeyRevocation`) resolves the same
  way under Quereus.
- **`RevisionMonotonicInt` deliberately *not* changed.** Adoption rows have no `Revision` and are
  not part of the `PartyKey` add sequence, so the revision counter (max over `committed.PartyKey`)
  is correct as-is. Called out so the reviewer doesn't read it as an oversight.
- **Fallback if a runner rejects views-in-CHECK.** The `NOTE:` at `AuthorizedKey` records the
  inline fallback (`RegisteredKey` = `PartyKey union PartyKeyAdoption`, minus `PartyKeyRevocation`)
  should a future runner reject a view inside a CHECK. `TargetAuthorized` and `CounterpartyIsOther`
  now also reference these views inside CHECKs — same documented risk class, same fallback.
- **Inherited tripwire (concurrent revocations).** Still open from `key-multi-and-revoke`: two
  concurrent independent revocations could empty the set depending on Optimystic isolation. Adopted
  keys count toward `NotLastKey` like any other, so nothing here changes that analysis; the `NOTE:`
  at `NotLastKey` stands.

## Review findings (index — tripwires parked at their sites, not tickets)

- **Counterparty is the recovery trust root; collusion is out of scope by design.** A counterparty
  that fully controls the adopted key can forge an adoption — inherent to a two-party human-trust
  root, not preventable at this layer. `NOTE:` at `PartyKeyAdoption` (`schema/draft1.qsql`).
- **Digest is not tally-bound.** Cross-tally replay of the self-signature confers nothing without
  the local counterparty attesting; if adoption ever needs to bind to one tally, add
  `(select Cid from TallyCore)` to both digests. `NOTE:` at `PartyKeyAdoption`.

## Sereus dependency (documented, not built here)

The ceremony presupposes the recovering cadre is already back in the strand. Re-admission is a
Sereus-layer step (invite → join handshake / `addMemberByAuthority`, see
`../sereus/docs/architecture.md`) and a **sequencing dependency, not a schema constraint** — the
adoption rows simply can't be written until the recovering party can read/write the strand. This
is documented in `docs/architecture.md`, not enforced in the schema.
