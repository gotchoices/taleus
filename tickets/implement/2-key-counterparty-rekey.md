----
description: As a last resort, let the other party in a tally vouch for a replacement signing key when someone has lost every one of their devices, using the human trust between them as the recovery root.
prereq: key-multi-and-revoke
files: schema/draft1.qsql, docs/architecture.md
difficulty: medium
----

# Counterparty re-key ceremony

## Problem

The multi-key model (`key-multi-and-revoke`) recovers device loss as long as *some* authorized key survives. If a party loses **all** its keys (all cadre nodes gone, or every key stolen), the authorized set is empty and nothing inside the tally can sign a new key into it. The tally data still survives in the counterparty's replica, but the party has no signing authority.

The ultimate trust root in a two-party tally is the human relationship between the two parties. This ticket lets that relationship re-key a party: a bilateral ceremony where **both** parties attest a replacement key.

## Design

A new insert-only table `PartyKeyAdoption` records a re-key attested by the counterparty. It introduces a key into the lost party's authorized set *without* requiring an existing key of that party — the only such path. It is bilateral so neither side can do it alone:

- The recovering party generates a fresh key out-of-band and **self-signs** with it (`SelfSignature`), proving it controls the new key.
- The **counterparty** attests the adoption with one of its own currently-authorized keys (`CounterpartySignature`) — the human "yes, this really is you" step.

Crucially, `Sid` is unchanged: the ceremony re-keys an *existing* party, it never mints a new identity. All history stays valid and the two-party invariant holds.

```sql
create table PartyKeyAdoption (
    Sid text,                    -- party regaining authority (unchanged identity)
    PublicKey text,              -- new key being adopted
    SelfSignature text,          -- new key signs, proving possession by the recovering party
    CounterpartyKey text,        -- counterparty's authorized key that attests
    CounterpartySignature text,

    primary key (Sid, PublicKey),
    constraint SidIsParty check (New.Sid in (select distinct Sid from PartyKey)) on insert,        -- no new party
    constraint CounterpartyIsOther check (New.CounterpartyKey in (select PublicKey from AuthorizedKey AK where AK.Sid <> New.Sid)) on insert,
    constraint SelfSigValid check (SignatureValid(Digest(Sid, PublicKey), SelfSignature, PublicKey)) on insert,
    constraint CounterpartySigValid check (SignatureValid(Digest(Sid, PublicKey), CounterpartySignature, CounterpartyKey)) on insert,
    constraint UniqueKey check (
        (select count(*) from PartyKey PK where PK.Sid = New.Sid and PK.PublicKey = New.PublicKey) = 0
        and (select count(*) from PartyKeyAdoption A where A.Sid = New.Sid and A.PublicKey = New.PublicKey) = 1
    ) on insert,
    constraint InsertOnly check (0) on delete, update
);
```

Extend the `AuthorizedKey` view (from `key-multi-and-revoke`) to include adopted keys, still minus revocations:

```sql
create view AuthorizedKey as
    select PK.Sid, PK.PublicKey from PartyKey PK
    union
    select A.Sid, A.PublicKey from PartyKeyAdoption A
    where Sid || PublicKey not in (select Sid || PublicKey from PartyKeyRevocation);
```

(Implement the revocation exclusion over the whole union — an adopted key must be revocable too; keep the exclusion expression consistent with the base view rather than duplicating logic awkwardly.)

Once an adopted key is authorized, normal add/revoke resumes from it: the party adds its new devices' keys and revokes the lost/stolen ones (now permitted, because `NotLastKey` sees the adopted key).

### Two-layer recovery — align with Sereus, don't reinvent

Regaining tally-signing authority (this ticket) is the *app layer*. It presupposes the recovering party can still read/write the closed strand. If the party lost all its cadre nodes, it also lost the **Sereus strand membership key** and its **cadre authority keys**, so before this ceremony can run, the counterparty must re-admit the party's fresh cadre into the strand at the Sereus layer (invite/seed handshake, `addMemberByAuthority` — see `../sereus/docs/architecture.md`, "Invite → join handshake" and "Reinstall & recovery behavior"). Document this ordering explicitly: **Sereus re-invite (regain strand access) → Taleus `PartyKeyAdoption` (regain signing authority).** Do not build Sereus-layer re-admission here; reference it.

### UX expectations

- **Recovering party**: "I lost all my devices" flow — sets up a fresh cadre, generates a new tally key, and produces a self-signed adoption request (QR/link) per tally.
- **Counterparty**: receives the request, sees the human identity of who is asking, and confirms ("yes, re-key my counterpart on tally X") — signing `CounterpartySignature` with an authorized key. App should frame this as a trust decision, since it is the recovery root.
- After both signatures land, the recovering party's app walks it through revoking the old (lost/stolen) keys and registering its new devices.

## Edge cases & interactions

- **Counterparty forgery guard**: the counterparty alone cannot adopt a key — `SelfSigValid` requires the new key's own signature, so the real party must have generated it and handed it over out-of-band. Collusion by a malicious counterparty is inherent to a two-party trust root; document, do not attempt to prevent.
- **No new identity**: `SidIsParty` forbids adoption for an unknown `Sid`; the ceremony can only re-key one of the two existing parties. Confirm `TwoParties` still holds.
- **Adoption when the set is non-empty**: allowed (also serves the all-keys-*stolen* case where the honest party wants a counterparty-blessed fresh key before revoking the thieves). Not restricted to an empty set.
- **Revoking an adopted key**: `PartyKeyRevocation` must treat an adopted key like any other authorized key; verify the extended view and the revocation constraints compose (the `TargetAuthorized`/`NotLastKey` guards read the unioned view).
- **Replay**: `UniqueKey` blocks adopting a key already present as either a `PartyKey` or a prior adoption for that `Sid`.
- **Ordering with Sereus re-admission**: the ceremony rows cannot be written until the recovering cadre is back in the strand; this is a sequencing dependency, not a schema constraint — cover it in docs.
- **Counterparty key freshness**: `CounterpartyKey` must be currently authorized (not revoked) at insert; a stale/revoked counterparty key must fail `CounterpartyIsOther`.

## TODO

- Add the `PartyKeyAdoption` table with the five guards above.
- Extend the `AuthorizedKey` view to union adopted keys, preserving revocation exclusion across the union.
- Update `docs/architecture.md`: add the counterparty ceremony to the "Key recovery" subsection, and spell out the two-layer ordering (Sereus re-invite → Taleus adoption) with the alignment note.
- Add a `NOTE:` at the adoption site recording that the counterparty is the trust root and collusion is out of scope by design.
- No Taleus test runner yet — validate by constraint inspection against Quereus semantics.
