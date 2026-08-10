description: Decide what an invitation that nobody ever accepts should leave behind, so abandoned invitations don't accumulate as half-built tallies.
files: packages/taleus/schema/draft1.qsql, docs/architecture.md, packages/taleus-app/design/stories/mobile/01-invite-a-partner.md
difficulty: medium
----
## Why this ticket exists

Formation currently runs ahead of agreement. The inviting party pre-creates the tally strand and
mints an invitation bound to it; the invitee redeems that invitation, joins the strand, and receives
its membership key — all before either party has signed any terms. An invitation that is never
redeemed therefore leaves a formed strand behind, and an invitee who looks and declines has already
been seated in it.

In MyCHIPs the equivalent walk-away cost nothing: an invitee who declined had disclosed a
certificate and no more.

## Outcomes we're after

- Inviting someone is cheap and leaves no residue if they never respond (story 01, alternative A).
- A party can send an invitation, change their mind, and not be left with something to clean up
  (story 01, alternative B).
- An invitee can look at what they are being offered and decline without having joined anything
  they now have to leave.
- However this resolves, a party's tally list stays honest — no entries that look like relationships
  but are not.

## Options we're aware of

- **Defer creation to redemption.** Sereus supports invitations that are *not* bound to a
  pre-existing strand, where the responder provisions a fresh strand when the invitation is
  redeemed. Nothing exists until someone actually responds. The cost is that the inviting party no
  longer holds the strand in advance, so anything they want to pre-seed (their terms, their unit
  choice) has to live somewhere else until redemption — most likely their own portfolio.
- **Keep pre-creation and add cleanup.** The inviting party's cadre drops the strand when the
  invitation expires unredeemed. Simpler to reach from where the code is today; leaves a window in
  which orphans exist.

We do not have a preference strong enough to state as a requirement. The second is less disruptive;
the first makes the problem structurally impossible, and interacts favourably with
`feat-standing-invitation`.

## Open questions

- Whether an invitee who has been seated but has signed nothing should be visible to the inviter at
  all, and under what description.
- Whether expiry of the *invitation* and expiry of an *offer* (`feat-offer-lifecycle`) are one
  concept or two.
- What a party's own cadre should do with strands for tallies that never opened — and whether this
  is a Sereus-layer concern we should be raising upstream rather than working around.
