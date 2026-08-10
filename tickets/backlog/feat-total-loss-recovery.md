description: Decide how someone who has lost everything gets back to trading with the people they already deal with — and whether any part of that can safely happen inside the app at all.
prereq: feat-master-key-custody
files: docs/architecture.md, packages/taleus/schema/draft1.qsql, packages/taleus-app/design/stories/mobile/50-recover-after-losing-a-device.md
difficulty: hard
----
## Why this ticket exists

A party who loses every device — and who kept nothing off-device — can no longer act on any of their
tallies. What their counterparties owe them still exists; their ability to do anything about it does
not.

The schema already carries a route back: `PartyKeyAdoption`, where a counterparty attests a fresh key
for the recovering party, keeping the party's identity and history intact. The architecture is candid
that this is the one path introducing a key into a party's authorized set *without* an existing key
of that party, and that a malicious counterparty can therefore re-key its counterpart unilaterally.

The concern that prompted this ticket is narrower and sharper: **if the app ever displays an incoming
"authorize this person" request, that prompt is itself the attack.** An official-looking in-app
message asking a user to re-admit someone is a far easier thing to forge, socially, than a phone call
from a stranger — and the user has been trained by the app to trust what the app shows them. The app
stories therefore now keep total-loss recovery entirely out of band: the recovering party phones or
visits their counterparty, who satisfies themselves however they like, and no request of any kind
arrives in anyone's app.

That leaves a design question worth answering deliberately rather than by default.

## The question

When a surviving counterparty has satisfied themselves that this really is the person they have been
trading with, what should they be able to do?

- **Settle and start fresh.** They settle what is between them and open a new tally with the
  recovering party's new identity. Always available, needs no new mechanism, and is what the app
  stories currently assume. The cost is that the relationship's history does not carry across, and
  every counterparty must be visited separately.
- **Admit a new identity to the existing tally.** The relationship, its history, and its terms
  survive. This is what `PartyKeyAdoption` was designed for. The cost is that a mechanism exists for
  substituting who a party *is* on an existing tally — and whatever the app does to initiate it is a
  target.

These are not mutually exclusive: the first could be the ordinary route with the second reserved for
relationships where the history genuinely matters.

## Outcomes we're after

- A party who has lost everything has a path back to trading with each of their counterparties.
- No path back can be initiated by a message the recovering party's side controls — the surviving
  counterparty acts on their own judgment, from their own side.
- Nothing the app shows can be mistaken for the system vouching for someone's identity.
- A counterparty who declines to help is not penalized, and their decision does not affect the
  recovering party's other tallies.
- Whatever the value a counterparty owes, losing devices does not forfeit it.

## Work this ticket covers

- A security analysis of the adoption path as it exists: who can initiate it, what a malicious
  counterparty can do with it, what a compromised device can do with it, and what the recovering
  party can prove at each step.
- A recommendation on the question above, including whether adoption should remain in the schema at
  all if the app is never to expose it.
- If adoption stays: how a counterparty initiates it *from their own side* after out-of-band
  verification, such that nothing arriving over the network can trigger or resemble it.
- Whatever is decided, state it in `docs/architecture.md` — the recovery section currently describes
  the ceremony without saying how a person is meant to reach it.

## Open questions

- Whether "settle and start fresh" is genuinely always possible — a tally with an unsettled balance
  and a party who cannot sign may not be closable by the surviving side alone. Check this against
  `CloseState` and the close path before assuming the conservative route works.
- Whether the recovering party's identity *should* be preserved across total loss, or whether a new
  identity is the more honest model for a party who can no longer prove continuity.
- What an always-on node in the party's own cadre changes, since such a party is far less likely to
  reach total loss at all.
