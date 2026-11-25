----
description: The referee who finalizes a lift currently has to sign over each tally's real identifier, so it learns which tallies took part, which the rest of the lift protocol is careful to hide.
files: packages/taleus-core/schema/draft1.qsql, packages/taleus-core/src/lift/digest.ts, packages/taleus-core/src/lift/referee.ts, docs/architecture.md
----

The per-edge settlement digest the referee signs is `Digest(Cid, LiftId, RefereeKey, Issuer, Units, Date, Expiry)` (void: `Digest(Cid, LiftId, 'void')`), where `Cid` appears to be the tally's own id (`TallyCore.Cid`; see `draft1.qsql` near line 215). Discovery and consensus show tallies only as per-session salted hashes (nonces), so this gives referees a stable view of which tallies took part in which lifts, linkable across lifts. Confirm what `Cid` is first.

Possible direction: the strand records the lift's per-session nonce for that edge in `PendingLift`, and the digest binds the nonce instead of the tally id; the schema can still check the nonce is unique to this tally and lift. Must keep commit and void digests distinct and the digest byte-identical between `digest.ts` and the schema's `Digest()`. Coordinate with `feat-tallynet-bind-taleus-core`, which changes the same rows.
