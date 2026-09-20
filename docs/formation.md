# Formation

How a tally comes into existence, and how it becomes permanently two-party.

A tally **is** a Sereus strand ([`architecture.md` § A Tally Is a Strand](architecture.md#a-tally-is-a-strand)),
so formation happens at two layers at once: Sereus seats *members*, and Taleus seats *parties* and
fixes which side of the tally each one holds. This page is the seam between them.

Written from what Sereus can do today, with the assumptions it rests on named in the last section.
Where something is unverified it says so.

## One invitation, not two

Taleus's schema has an invitation key: `Stock.InvitationKey` holds a public key, the secret half
goes to the invitee out of band, and possession of it is what lets them seat as the foil.

Sereus's closed-strand `issueInvite` does the same thing in the same shape — a fresh ed25519 pair,
the public half stored as `Strand.Invite.Key`, the private half *"handed out-of-band to the invitee;
whoever holds it can consumeInvite exactly once… NEVER persisted in the strand"*.

These are not two ceremonies to reconcile. They are **one keypair used at two layers**:

- Sereus: `consumeInvite` seats the holder as a strand member.
- Taleus: the same private half signs the `Foil` row and the invitee's genesis `PartyKey`.

So `Stock.InvitationKey` **is** `Strand.Invite.Key`. One mint, one out-of-band handoff, two
independent validations — and the Taleus constraints stay self-contained, which matters because it
is the sApp schema that Optimystic enforces on every replica.

## The sequence

1. **Stock founds a closed strand**, itself the sole member and sole manager.
2. **Stock mints the invitation** (`issueInvite`), keeping both halves for the moment.
3. **Stock seats itself** in Taleus: the `Stock` row (carrying `InvitationKey`) and its own genesis
   `PartyKey`, in **one transaction**. They are circular — `Stock.SignerAuthorized` needs the key,
   and the genesis signature validates against `Stock.InvitationKey` — so neither row goes in alone.
   Stock signs its genesis key with the invite secret, which it holds because it minted it.
4. **The invite secret goes to the invitee** out of band — in person, by QR, in a message.
   Everything before this point must be done: `Stock` is a singleton, so whoever writes it first
   holds that slot, and handing the secret over before seating would let the invitee take it.
5. **The invitee redeems and seats**: `consumeInvite` at the Sereus layer, then the `Foil` row and
   its own genesis `PartyKey`, both signed with the invite secret.
6. **Stock names the tally**: `TallyCore`, whose `Cid` is a content address over both Sids. This is
   why a one-member strand is inert — the tally's identity cannot be computed until both parties are
   known, and every later table hangs off `TallyCore`.
7. **Both parties negotiate**, symmetrically, as ordinary members: `CreditTerms` each publishes
   alone, `TallyContractProposal` either may write. Nothing here needs manager rights.
8. **Stock seals the strand** (`sealStrand`), giving up its own power to admit anyone else.
9. **Both sign the contract**: one `TallyContract` row carrying both signatures — and refused unless
   the strand is sealed (below). The tally is open.

## Sealing is a rule, not a habit

`sealStrand` empties `Strand.Manager` and files a `Strand.Revocation` naming it. Zero managers alone
is **not** a seal — a strand between its `Header` and `Manager` founding inserts looks identical, and
is still foundable. The retired stamp is what separates *frozen forever* from *not yet founded*:

```sql
strand is closed
  and no Strand.Manager rows
  and a Strand.Revocation row with TableName = 'Manager'
```

All three are readable in the strand's own tables, and **a sApp CHECK can read across the namespace
boundary** — verified against Quereus: a constraint in `App` that selects from `Strand.Manager` and
`Strand.Revocation` binds, and enforces exactly this. So `TallyContract` carries it, and the tally
**cannot open until the membership is permanently two-party**. The invitee does not have to remember
to check; its own engine refuses the contract otherwise.

Sealing freezes **admission, not activity**: it touches only `Manager`, so both members keep full
read and write. Chits, terms and closing all carry on indefinitely on a sealed strand. That is why
sealing early costs nothing.

At two members the seal has a property it lacks at larger sizes: a commit needs a super-majority of
the block's cohort, and at two nodes the cohort is both — so **a seal that commits is a seal both
parties have seen.** The convergence window the strand docs warn about opens only above cohort size,
which a tally never reaches.

## Identity

A party's `Sid` is **strand-local**, anchored on its Sereus `Member.Key`, and never signs anything.
`PartyKey` holds the keys that may sign as it, and those rotate. The full reasoning — including why
`PartyKey` is *not* redundant with Sereus's key management, which turns on the seal freezing strand
membership — is in [`identity.md`](identity.md).

## The lifecycle, restated

| State | Means |
|---|---|
| Forming | Strand closed, manager present. Seats taken, terms and proposals moving. |
| Open | Strand **sealed** *and* `TallyContract` bilaterally signed. Neither alone. |
| Closing / Closed | As `docs/tally-lifecycle.md` — unaffected by the seal. |

## Why not make both parties managers

A tempting symmetry: both sides manage during negotiation, then both resign to open the tally. It
does not work, and the reasons are worth keeping.

- **`sealStrand` is the sole manager's act** — it refuses outright while another manager exists.
- **A sole manager cannot resign**, only seal: the `'resign'` branch requires at least one manager in
  the post-delete image.
- So "both resign together" is schema-rejected, and the only route is *one steps down, the survivor
  seals* — asymmetric at exactly the decisive moment, with the first to step down trusting the other
  to finish.
- Worse: **a manager may remove another manager.** Two managers means either side can unilaterally
  demote the other and seal alone. That is a race, not parity.
- And a foil-manager could `issueInvite`, seating a third member before any seal.

The symmetry is not needed, because it already exists where it matters. Negotiation runs on sApp
rows gated by `AuthorizedKey` — **membership, not management** — so both parties propose, counter and
sign as equals throughout. The bilateral act is `TallyContract` itself. The invitee's leverage is the
one it already has: refusing to sign, which the seal constraint now makes automatic.

## Multi-use invitations

A vendor wants one printed QR that many customers can take up — MyCHIPs did it with a tally template
that was either filled in once or cloned.

Sereus has both halves, but not together:

- **Closed strands** invite via `issueInvite`, which is **single-use** by primary key
  (`ConsumedInvite.InviteKey`).
- **Multi-use** lives on the *unbound* invitation path, which mints a **fresh strand per redemption**
  — the right shape — but is constrained to produce strands that are **open and keyless**.

So today it is *closed XOR multi-use*. One-to-one tallies work now; the vendor case needs an upstream
change, stated in `tickets/`. Taleus needs nothing new of its own: a multi-use invitation should mint
a fresh closed strand per redemption, and the sequence above then runs unchanged in each.

## Assumptions

Named so they can be checked rather than inherited.

1. **The Taleus schema is applied as `declare schema App { … }` alongside `Strand` in one strand
   database.** Verified for the mechanism: the current `draft1.qsql` body wraps with no qualification
   changes and `App.TallyCore` resolves. `compose-strand.ts` applies the sApp schema into the same
   database that holds `Strand`.
2. **`Stock.InvitationKey` is `Strand.Invite.Key`.** A design decision, not a discovery — it
   identifies two mechanisms that were independently described the same way.
3. **Membership, not management, is what lets a party write sApp rows.** Consistent with the Taleus
   constraints, which gate on `AuthorizedKey`; not separately confirmed against Sereus.
4. **Redemption and Taleus seating are one act.** *Verified.* Sereus's membership writers take
   `StrandWriteOptions.joinOpenTransaction`, default **true**, precisely so "the caller composes
   several writers in one transaction… and owns its commit and rollback, so the deferred
   constraints fire once, at the caller's commit". The invitee opens a transaction, calls
   `consumeInvite`, inserts `Foil` and its genesis `PartyKey`, and commits: both layers' deferred
   constraints fire together, and a member who is not a party cannot exist.
5. **A party's `Sid` is strand-local and anchored on its Sereus `Member.Key`** — see
   [`identity.md`](identity.md). One person is deliberately not one identity, and real-world
   identifiers are disclosure payload rather than anything a protocol rule reads.
6. **A fixed-membership mode is coming.** Kyle reports zero-manager sealed membership is wanted
   beyond Taleus — a three-member chat has the same need. The model here rides on the seal already
   implemented and should inherit that work rather than diverge from it.
