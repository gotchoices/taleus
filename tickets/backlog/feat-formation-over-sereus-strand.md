description: Wire Taleus formation onto a real Sereus closed strand — App-namespaced schema, the invite key identified with Strand.Invite.Key, and TallyContract gated on the strand being sealed.
prereq:
files: packages/taleus-core/schema/draft1.qsql, packages/taleus-core/src/store/, packages/taleus-core/src/tally/formation.ts, docs/formation.md
difficulty: medium
----
## What this is

`docs/formation.md` states the model and the evidence for it. This is the work to make it real.

Today `taleus-core` opens a bare in-memory Quereus database with `draft1.qsql` in `main`, invents its
own invitation key, and has no notion of a strand. The model says: the Taleus schema is an sApp
schema applied next to Sereus's `Strand` schema in one strand database; the invitation key **is**
Sereus's; and the tally cannot open until the strand is sealed.

## Verified before writing this

- A sApp CHECK **can** read across into the `Strand` namespace. A constraint in `declare schema App`
  selecting from `Strand.Manager` and `Strand.Revocation` binds and enforces: refused while a
  manager sits, refused when managers are gone but no tombstone exists (the still-foundable state),
  accepted once sealed.
- `draft1.qsql`'s body wraps in `declare schema App { … }` with **no qualification changes**, and
  `App.TallyCore` resolves afterwards.
- Sereus's `issueInvite` for a closed strand generates an ed25519 pair, stores the public half as
  `Strand.Invite.Key`, hands the private half out of band, and is single-use by
  `ConsumedInvite.InviteKey`. Feature-for-feature what `Stock.InvitationKey` already describes.
- `sealStrand` requires exactly one manager; a sole manager cannot resign, only seal; a manager may
  remove another manager. (These are why both parties must *not* be managers — see the doc.)

## Work

1. **Namespace the schema.** `declare schema App { … } apply schema App;`. Update the loader and the
   test harness. Keep `schema/draft1.qsql` the source of truth.
2. **Add `TallyContract.StrandSealed`** — no `Strand.Manager` rows and a `Strand.Revocation` naming
   `Manager`. This is what makes sealing a rule rather than a convention.
3. **Replace the invitation ceremony** in `src/tally/formation.ts`: the caller supplies the keypair
   from `issueInvite` instead of `newInvitation()` minting one. `Stock.InvitationKey` takes
   `Invite.Key`.
4. **A store seam.** `openStrandFrom` opens a bare database; there needs to be an interface a
   Sereus-backed strand implements, so the core is not wired to an in-memory Quereus forever
   (`SPEC.md` § 6).
5. **Tests** at the two-replica level for the whole sequence, including: the contract refused before
   the seal, and accepted after.

## Settled since this was written

- **Seating is one transaction.** Sereus's membership writers take
  `StrandWriteOptions.joinOpenTransaction` (default **true**) so a caller composes several writers
  in one transaction and owns the commit. `consumeInvite` + `Foil` + genesis `PartyKey` commit
  together; a member who is not a party cannot exist.
- **`Sid` is strand-local, anchored on `Strand.Member.Key`** — `docs/identity.md`. Add the
  constraint: a party's `Sid` must name a member of this strand. That closes the unenforced-Sid
  finding, and Sereus's RBAC does the authenticating.
- **`PartyKey` stays.** It is not redundant with Sereus's key management: a sealed strand refuses
  `addMemberByManager`, so the Sereus membership key cannot be rotated for the life of the tally.
  Rotation and recovery are Taleus's, necessarily.

## Open, and worth deciding while doing this

- **A third strand member before the seal** is possible (stock can issue a second invite). They could
  read the tally but never become a party (`PartyKey.TwoParties`), and the seal constraint stops the
  contract. Privacy exposure only, entirely within stock's control. Confirm that is acceptable.
