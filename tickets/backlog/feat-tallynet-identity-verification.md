description: Give a payer a way to be sure the party that answered a route search as the intended recipient really is that recipient, and let parties confirm each other's identity through a mutual acquaintance, so a lift can't be steered to an impostor.
files: packages/tallynet/docs/design.md, packages/tallynet/src/discovery/, packages/tallynet/src/consensus/, ../chipnet/doc/cluster.md, ../chipnet/doc/cluster/todo.md
----

Surfaced by the ChipNet regression check (`packages/tallynet/docs/chipnet-review.md` § Regression check) as **designed in ChipNet's docs, built in neither code base, and owned by no TallyNet ticket**. Two related identity checks ChipNet's `doc/cluster/todo.md` lists but never implemented:

1. **Verify the target's signature against its address.** When a search concludes that some party is the payee, the originator today trusts the returned plan's claim of who the target is. ChipNet intended the originator to confirm that the party answering as the target actually controls the private key registered at the target's address (a challenge the target signs, verified against its public key). Without this, a relay could present a neighbour as "the target" and the lift could be built toward the wrong party. This is distinct from `feat-tallynet-lift-identity-options`, which is about *disclosure* (one-time keys, whether to publish an address), not *authentication* of the target.

2. **"Whispering" identity checks.** A way for two parties who do not share a tally to gain confidence they are who they claim, via a mutual acquaintance: a hash of identity information is shared with a peer-of-peer using the peer's public key, so the far party can confirm a claimed identity without the two ever having met. ChipNet's `doc/cluster.md` and `todo.md` describe the idea only.

## Why this matters / use case

Lifts move value toward whoever the protocol decides is the payee. Member identity in TallyNet is deliberately key-only — "the party authorised at a link is whoever holds the private key registered there" (`design.md` § Member identity and disclosure) — and neighbours bind a key to a real party over the tally they share. But the **payee** of a linear lift may be several hops away from the payer, with no shared tally. Something must let the payer trust that the key it is paying toward is the intended recipient's, or that a claimed identity is genuine, before committing value. That is the gap these two checks fill.

## Scope / open questions (for the plan stage, not now)

- Where target-signature verification sits: at discovery conclusion (the originator challenges the matched target) vs at promise time. The target secret already rides encrypted to the target's key (`Target.secret`); the verification likely reuses that key.
- Whether "whispering" is a discovery-time concern, a lift-policy concern, or belongs to a higher Taleus trust layer (it overlaps `feat-tallynet-trust-query`, which uses the same search to measure connectedness). Decide the boundary.
- Interaction with per-lift identity options (`feat-tallynet-lift-identity-options`): a one-time key per lift must still be verifiable as the intended party's — these two features constrain each other.
- What TallyNet (protocol) owns vs what Taleus (`taleus-core`) owns. TallyNet verifies signatures against keys; binding a key to a *claimed real-world identity* may be above the protocol line.
