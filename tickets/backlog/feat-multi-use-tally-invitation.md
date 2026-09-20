description: A vendor needs one printed code many customers can take up. Sereus has multi-use and closed strands, but not together — this is the upstream ask and the Taleus side of it.
prereq: feat-formation-over-sereus-strand
files: docs/formation.md
difficulty: medium
----
## What a vendor needs

One static QR, printed by the till or on a card. Each customer who takes it up ends with **their own
tally** with the vendor, on the vendor's published terms. MyCHIPs implemented this as a tally
template that was either filled in once or cloned.

Taleus needs nothing new of its own. Each redemption should mint a **fresh strand** and run the
ordinary formation sequence (`docs/formation.md`) inside it. The vendor's node writes `Stock`, its
credit terms and a proposal; the customer writes `Foil`; the strand seals; the contract is signed.

## Why it is blocked

Sereus has both halves, and they do not currently meet:

- **Closed strands** invite via `issueInvite`, **single-use** by primary key
  (`ConsumedInvite.InviteKey`). One invite, one member.
- **Multi-use** lives on the *unbound* invitation path, where `provisionAndRecord` mints a fresh
  strand per redemption with a use cap enforced by counting `FormationUsage` rows — exactly the right
  shape — but the schema constrains a consent-seated strand to be **open and keyless**
  (`FormationUsage.Authorized`, and the consent branch of `Strand.AuthorizedInsert`).

So today it is **closed XOR multi-use**. A tally holds two parties' private financial records; an
open, keyless strand is the wrong container for it.

## The upstream ask, in one sentence

An unbound invitation that provisions a **closed** strand — or equivalently, a closed-strand
invitation carrying a use cap.

Worth raising against Sereus once someone has confirmed the framing with Nate. The multi-use
accounting already exists and already mints fresh strands; what is new is letting the strand it mints
be closed and keyed, with the joiner receiving the `MemberPrivateKey` the bound path already returns.

## Until then

One-to-one tallies work with today's Sereus. Ship those; this stays parked. Nothing in the formation
model needs to change to accommodate it later — only where the strand came from.
