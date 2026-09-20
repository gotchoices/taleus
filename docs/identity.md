# Identity

Who a party is, within one tally — and deliberately not beyond it.

## One person is not one identity

A party's identity is **local to a strand**. The same human may hold a different identity in every
tally they have, and nothing in Taleus tries to stop that or to detect it.

This is a decision, not an omission. In a distributed system any attempt to enforce "one person, one
identity" is defeated by the first participant who declines to cooperate, and the attempt costs
everyone else their privacy: a globally stable identifier lets anyone holding two tallies correlate
them. Sereus reaches the same conclusion structurally — `StrandPartyKey` is keyed by strand id, so a
party's membership key differs in every strand by construction.

**Recognising who someone is in the real world is the member's own job.** The protocol's part is to
guarantee that the party you are dealing with *today* is the same one you dealt with *yesterday on
this tally* — nothing wider.

### Real-world identifiers are payload, never protocol

A member may ask for, and a member may supply, a tax identifier, a driver's licence number, a
registered company number, an address. These are **disclosure** — `PartyCertificate`, carried in the
tally as payload — and no protocol rule depends on them. They are the counterparty's *claim* about
themselves, which is exactly how story 11 already frames them: what somebody discloses is what they
say, not something Taleus verified, and what is absent says nothing at all.

So: identify each other however you like, using whatever evidence satisfies you. The schema neither
helps nor interferes.

## Two layers, and why both exist

Sereus and Taleus both manage keys, and it would be reasonable to suspect duplication — the way
Taleus's invitation key turned out to duplicate Sereus's (`formation.md`). Here they do not, and the
reason is a direct consequence of sealing.

**Sereus, control layer (the party's own cadre).** `OwnerKey` holds several keys per party.
Rotation is add-then-remove (`NoUpdate`), a floor of one key must remain (`MinOneOwner`), an
authorizer is read from the committed snapshot so no key can seat itself, and removal files a
permanent `Revocation` tombstone. This governs **who may administer the party's machines**.

**Sereus, strand layer.** `Member.Key` *is* the primary key: one key, one member. A party holds
exactly one membership key per strand (`StrandPartyKey`, keyed by strand id), shared across its own
machines through the replicated control database. There is no multi-key-per-party within a strand.

**And a sealed strand cannot change its members at all.** Sealing refuses `addMemberByManager`,
`issueInvite`, and re-promotion of the ex-manager. A member may *leave* (the `'leave'` branch, self
-signed) but nobody can be added. Since a tally seals as a precondition of opening
(`formation.md`), **a party's Sereus membership key can never be rotated for the life of the
tally.**

That is what `PartyKey` is for, and it is the reason it is not redundant:

| | Sereus | Taleus |
|---|---|---|
| Party's machines | `OwnerKey`, rotatable | — |
| Identity within a strand | `Member.Key`, **frozen once sealed** | `Sid`, anchored on it |
| Keys that may sign tally rows | — | `PartyKey`, rotatable and revocable |
| Recovery after total loss | — | `PartyKeyAdoption`, counterparty-attested |

## The split: identity is fixed, signing authority is not

- **`Sid` is an identifier, never a signing key.** It is strand-local and permanent, anchored on the
  party's Sereus `Member.Key`. Permanence is fine precisely because nothing signs with it.
- **`PartyKey` is the set of keys that may currently act as that `Sid`.** Add, revoke, adopt — all
  within the tally, all without the identity changing. A stolen device's past signatures stand and
  its future ones are refused, which is the whole compromise-versus-loss trade.

This also closes a finding: `test/STATUS.md` § 0 records that nothing holds a party to its claimed
`Sid`. Anchoring it on `Strand.Member.Key` makes it checkable — a sApp CHECK can read the `Strand`
namespace (verified, see `formation.md`), so `Sid` can be constrained to name an actual member of
this strand. Sereus's RBAC then authenticates it, and seating under an identity you do not hold
stops being possible rather than merely being impolite.

## Why a compromised key is Taleus's problem to solve

On a sealed strand the Sereus layer has no move left: the member set is frozen, so a stolen
membership key cannot be replaced there. Removing the thief's machine from the party's cadre stops
*replication* to it but cannot unlearn key material it already holds.

`PartyKey` revocation is therefore the only forward defence, and `PartyKeyAdoption` — two signatures
over one digest, the recovering party proving possession and the counterparty attesting — is the
only recovery path when every device is gone. There is no third party in a two-party strand to
appeal to, which is why the counterparty's attestation is the ceremony rather than a convenience.

## The last resort is a new tally, not a heroic recovery

None of the above is the primary answer to a compromise. **A tally can itself be rotated.** If the
parties believe one is compromised, the right move is usually to recognise that, open a fresh tally,
carry the balance across, and close or abandon the old one.

That is available because of who the parties are: a tally is between **trusted associates**, not
strangers, and the two of them can simply agree to start again. It is also why losing a tally is not
a catastrophe — the record is *evidence*, held by both sides, not an enforcement mechanism. Where
the parties disagree about what it says, the recourse is a court or whatever process they would use
for any other disputed record, each bringing their own signed copy.

Key rotation and counterparty adoption therefore exist to avoid *needing* that, not because
everything fails without them. They keep a working tally working through an ordinary mishap — a lost
phone, a stolen laptop. They are not load-bearing against a determined adversary, and they should
not be designed as though they were.

## An unresolved concurrency hole, in both layers

Taleus's `PartyKeyRevocation.NotLastKey` guards against revoking a party's last key. It is
unreachable in-process — every route is closed earlier by `RevokerAuthorized` — and the case it was
written for is two *concurrent* revocations that each leave one key but together leave none.

Sereus's `MinOneOwner` carries the identical caveat, in its own words: *"Two partitioned nodes that
concurrently remove different owners can each see a survivor and still converge to zero; if
partitioned rotation ever becomes a real workflow, the floor needs a cross-node guard, not a local
count."*

Both layers independently arrived at the same guard and the same gap. Neither is closed by a local
count, and both depend on the transactor re-validating against the latest committed snapshot. Worth
raising once, for both, rather than twice.
