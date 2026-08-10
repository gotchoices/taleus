description: Let people choose what personal information they reveal to each trading partner, and add more later as trust grows, rather than disclosing everything to everyone.
prereq: feat-engine-tally-api
files: packages/taleus/schema/draft1.qsql, docs/architecture.md, packages/taleus-app/design/stories/mobile/02-respond-to-an-invitation.md, packages/taleus-app/design/stories/mobile/11-my-profile-and-disclosure.md
difficulty: medium
----
## Why this ticket exists

Tallying with someone means telling them something about yourself. How much depends entirely on the
relationship: a friend splitting lunch needs a name, a business partner may need a tax identifier.
MyCHIPs took this seriously — the invitee chose which certificate information to disclose *before*
connecting, and the app had a dedicated selection step for it.

The Taleus schema supports the mechanics: `PartyCertificate` is revisioned, and the architecture
already describes progressive disclosure — start minimal, disclose more as trust develops, with the
counterparty free to withhold countersignature until satisfied.

What is missing is the surface: how a party decides, per tally, what to reveal.

## Outcomes we're after

- Before disclosing anything, an invitee can see who is inviting them and on what terms (story 02).
- A party chooses what to include for a given counterparty, and can tell what is required to trade
  from what is optional.
- A party can add more later on an existing tally, without renegotiating terms.
- A party can see what they have disclosed to whom — after the fact, per tally.
- A counterparty can see what was disclosed to them, and can decline to proceed until satisfied.

## Open questions

- Whether disclosure is chosen per tally, defaulted from a profile, or driven by a reusable template
  (which the vendor case in `feat-standing-invitation` would also want).
- Whether a party can ask for specific fields, and what happens when the other side declines to
  provide them — a negotiation of its own, or simply grounds for not signing.
- Whether anything disclosed can be *withdrawn*, given the tally is insert-only and the counterparty
  keeps a replica.
- What the vendor case implies: a shop discloses to every customer who scans, so its disclosure is
  effectively public.
