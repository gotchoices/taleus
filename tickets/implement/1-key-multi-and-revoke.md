----
description: Let a party register several signing keys on a tally and revoke a lost or stolen one, so losing a single device no longer locks the party out of its own tallies.
prereq:
files: schema/draft1.qsql, docs/architecture.md
difficulty: hard
----

# Multi-key registration + revocation for `PartyKey`

## Problem

Today `PartyKey` (`schema/draft1.qsql:32`) is a strictly linear revision chain: revision *N* is signed by revision *N-1*'s signature, and every other signed table resolves the signer as "the latest `PartyKey` revision" (`order by Revision desc limit 1`). Two consequences:

- Only the holder of the current key can rotate. Lose the one device holding it → the party can never sign again → its tallies are orphaned.
- There is no way to mark a stolen key's *future* signatures invalid while keeping its *past* signatures valid.

## Design

Turn `PartyKey` from a sole-authority chain into an **authorized-key set with revocation**, scoped inside the tally strand. This deliberately mirrors Sereus's cadre `AuthorityKey` model (a party/cadre recognizes a *set* of keys, not one) rather than inventing a parallel scheme — see `../sereus/docs/architecture.md` (`AuthorityKey`, multi-authority cadres, "Reinstall & recovery behavior").

Core properties:

- **Identity is stable.** `Sid` stays the hash of the genesis (Revision 1) public key and never changes. The *authorized set* of keys evolves; the party's identity does not. Every historical row keeps referencing a valid `Sid`, and the two-party invariant is untouched.
- **Any authorized key can add another.** Registering a new key (a new device, or a pre-authorized cold successor) is signed by *any* currently-authorized, non-revoked key of the same party — the generalization of the old prior-signs-next chain. Genesis (Revision 1) still validates against the invitation key via `Stock`.
- **Any authorized key can revoke another.** A revocation names the key to kill and is signed by an authorized key of that party. Revocation is forward-only: it forbids *future* inserts signed by the revoked key. Past rows already committed under that key remain valid — they are insert-only, their signature was checked at insert against the then-authorized set, and nothing re-checks them. This is exactly the "compromise vs. loss" requirement: a stolen key's past signatures stand, its future ones are rejected.
- **Every signed row names its signer.** Because "latest revision" is no longer well-defined, each signature-gated table carries a `SignerKey` column. Its constraint (a) verifies `SignerKey` is in the party's authorized set at insert, and (b) verifies the signature against `SignerKey`. This needs no new crypto primitive — it reuses the existing single-key `SignatureValid(digest, sig, pubkey)`.

### Recovery paths this enables

- **Cadre-assisted (device loss, common case).** Each of a party's cadre nodes can register its own key on the tally. Lose the phone → the surviving cloud/NAS node's key is still authorized → it signs a revocation of the phone's key and registers the replacement device's key. No counterparty involvement. This is the tally-layer counterpart of Sereus's "surviving cadre node re-enrolls a fresh device." Where the `PartyKey` *secret* lives (per-device in each cadre node's enclave vs. one key replicated across the cadre's control network) is a Sereus-layer concern; document the alignment but do not build cadre key storage here.
- **Total loss (all authorized keys gone).** Cannot be solved by this ticket — the set is empty and nothing can sign an add. Handled by the counterparty ceremony in the follow-up ticket `key-counterparty-rekey`. The `NotLastKey` guard below deliberately prevents revoking the last key, so a fully-compromised party must *add* a fresh key (via the ceremony) before it can revoke the stolen ones.

### Schema sketch

Redesigned `PartyKey` (add-events; `AuthKey` records who authorized each add):

```sql
create table PartyKey (
    Sid text,               -- party identity: hash of the genesis (Revision 1) public key
    Revision integer,       -- per-Sid monotonic sequence of key-add events (ordering, not a sole chain)
    PublicKey text,         -- the key being authorized
    AuthKey text null,      -- PublicKey that authorized this add; null for Revision 1 (genesis)
    Signature text,         -- Revision 1: signed by the invitation key; else: signed by AuthKey

    primary key (Sid, Revision),
    constraint RevisionMonotonicInt check (Revision = Coalesce((select max(Revision) from PartyKey PK where PK.Sid = New.Sid), 0) + 1) on insert,
    constraint UniqueKey check ((select count(*) from PartyKey PK where PK.Sid = New.Sid and PK.PublicKey = New.PublicKey) = 1) on insert,
    constraint AuthKeyAuthorized check (Revision = 1 or New.AuthKey in (select PublicKey from AuthorizedKey AK where AK.Sid = New.Sid)) on insert,
    constraint SignatureValid check (SignatureValid(
        Digest(Sid, Revision, PublicKey, AuthKey),
        Signature,
        case when Revision = 1 then (select InvitationKey from Stock) else AuthKey end
    )) on insert,
    constraint InsertOnly check (0) on delete, update,
    constraint TwoParties check ((select count(distinct Sid) from PartyKey) <= 2) on insert
);
```

Revocation log:

```sql
create table PartyKeyRevocation (
    Sid text,
    PublicKey text,         -- key being revoked (must currently be authorized)
    RevokedBy text,         -- authorized key performing the revoke
    Signature text,         -- signed by RevokedBy

    primary key (Sid, PublicKey),
    constraint TargetAuthorized check (New.PublicKey in (select PublicKey from AuthorizedKey AK where AK.Sid = New.Sid)) on insert,
    constraint RevokerAuthorized check (New.RevokedBy in (select PublicKey from AuthorizedKey AK where AK.Sid = New.Sid)) on insert,
    constraint SignatureValid check (SignatureValid(Digest(Sid, PublicKey, RevokedBy), Signature, RevokedBy)) on insert,
    constraint NotLastKey check ((select count(*) from AuthorizedKey AK where AK.Sid = New.Sid) > 1) on insert,
    constraint InsertOnly check (0) on delete, update
);
```

Authorized-set view (the follow-up ticket unions counterparty-adopted keys into this same view):

```sql
create view AuthorizedKey as
    select PK.Sid, PK.PublicKey
    from PartyKey PK
    where not exists (select 1 from PartyKeyRevocation R where R.Sid = PK.Sid and R.PublicKey = PK.PublicKey);
```

Signer resolution on every signed table (pattern, replacing each `order by Revision desc limit 1` lookup): add a `SignerKey text` column and

```sql
constraint SignerAuthorized check (New.SignerKey in (select PublicKey from AuthorizedKey AK where AK.Sid = <issuer Sid>)) on insert,
constraint SignatureValid check (SignatureValid(Digest(...), Signature, New.SignerKey)) on insert,
```

Tables to convert: `Stock`, `PartyCertificate`, `TradingVariable`, `TallyContract` (both `StockSignature` and `FoilSignature`, each with its own `SignerKey` resolved against that side's `Sid`), `TallyContractProposal`, and `Ledger`. Note `TallyContractProposal` and `Ledger` currently pass a `Sid` (`ProposerSid`, `IssuerSid`) as the *public key* argument to `SignatureValid` — a draft placeholder; the `SignerKey` conversion fixes it in passing. Do **not** chase the other undefined draft symbols (`TallyCore`, `StockSid`, `FoilSid`) — those are tracked separately in backlog `debt-schema-core-tables`; keep this diff scoped to key authority.

### UX expectations

- **Register a device key**: in cadre management, adding a new node to the cadre also offers "authorize this device to sign tallies" — signs an add-row on each active tally with an existing device's key.
- **Revoke (lost/stolen)**: a "this device was lost/stolen" action from a surviving device signs a revocation across the party's tallies; app warns that a stolen key may have issued chits in the theft→revoke window and surfaces recent chits for review.
- **Last-key guard**: the UI must prevent revoking the final authorized key and steer the user to the counterparty-recovery flow instead.

## Edge cases & interactions

- **Self-lockout**: `NotLastKey` forbids emptying the set. A fully-compromised party (every key stolen) cannot revoke its way out — it must first add a fresh key via the counterparty ceremony. Verify the guard evaluates the set *before* the revoke applies.
- **Stolen-key race window**: between theft and the revocation committing (Optimystic ordering), the stolen key can insert fraudulent chits; those that commit before the revoke stay valid, those after are rejected. Inherent to a two-party unilateral-chit ledger — document, do not attempt to close it here (backstops: fast revoke, tally close, counterparty ceremony). NOTE this window at the revocation site in the schema.
- **Replay / re-add**: `UniqueKey` forbids re-adding a `PublicKey` already present for the `Sid`; a revoked key can never be resurrected (revocation is keyed on `PublicKey` and the view excludes it permanently).
- **Concurrent add/revoke from two surviving devices**: monotonic `Revision` and Optimystic write ordering serialize them; ensure no constraint assumes a single writer.
- **Genesis-key revocation**: allowed (`Sid` is a name, not an authority) provided another key remains; confirm `Sid` derivation and `TwoParties` are unaffected.
- **Both `TallyContract` signatures**: each side's `SignerKey` must resolve against *its own* party's authorized set, independently.
- **Two-party invariant**: adds/revokes must never introduce a third `Sid`; `TwoParties` still holds.
- **Insert-only past rows**: confirm a committed `Ledger`/`TallyContract` row is never re-validated against the current key set (would retroactively break history on revocation).

## TODO

- Redesign `PartyKey` per the sketch: `AuthKey` column, `UniqueKey`, `AuthKeyAuthorized`, generalized `SignatureValid`, keep `TwoParties`.
- Add `PartyKeyRevocation` table with the four guards above.
- Add the `AuthorizedKey` view.
- Add `SignerKey` column + `SignerAuthorized`/`SignatureValid` pattern to `Stock`, `PartyCertificate`, `TradingVariable`, `TallyContract` (×2), `TallyContractProposal`, `Ledger`; remove the old latest-revision lookups.
- Add a `NOTE:` comment at the revocation site describing the stolen-key race window.
- Update `docs/architecture.md`: revise the `PartyKey` table row and the signature-gating bullet to describe the authorized-key-set model; add a "Key recovery" subsection covering cadre-assisted recovery and its alignment with Sereus `AuthorityKey`/enclave recovery (forward-reference the counterparty ceremony).
- No Taleus test runner exists yet (design phase, no build scaffolding) — validate by constraint inspection against Quereus semantics; the reviewer treats this as the check.
