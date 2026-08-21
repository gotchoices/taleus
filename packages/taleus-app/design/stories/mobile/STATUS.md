# Stories Status

Tracks how far each story has come. The set itself, its grouping, and where it came from live in
[index.md](index.md).

States: **stub** (topic only) → **drafted** (written, not yet human-reviewed) → **reviewed**
(human has read and accepted it) → **revised** (changed after review).

## Ready for review

Nothing pending — every story except 25 is written and reviewed.

## Reviewed

Group 1 — tally negotiation, one continuous thread (Jan and Sam, carried over from
[theory.md](theory.md)). Read in order; 01→02→03→04 is one arc.

| # | Story | State |
|---|-------|-------|
| 01 | [Invite a partner](01-invite-a-partner.md) | revised — inviter no longer names the invitee |
| 02 | [Respond to an invitation](02-respond-to-an-invitation.md) | reviewed |
| 03 | [Negotiate terms](03-negotiate-terms.md) | reviewed |
| 04 | [First look at an open tally](04-first-look-at-an-open-tally.md) | reviewed |
| 05 | [Close a tally](05-close-a-tally.md) | revised — closing permits entries toward zero |
| 06 | [Find a tally](06-find-a-tally.md) | reviewed |
| 07 | [Review the agreement](07-review-the-agreement.md) | reviewed |
| 10 | [First run](10-first-run.md) | reviewed |
| 11 | [My profile and what I disclose](11-my-profile-and-disclosure.md) | revised — dropped withdrawal path; corrections now authorized |
| 12 | [Keys and backup](12-keys-and-backup.md) | reviewed |
| 13 | [My devices](13-my-devices.md) | reviewed |
| 50 | [Recover after losing a device](50-recover-after-losing-a-device.md) | reviewed |
| 20 | [Pay a partner](20-pay-a-partner.md) | revised — over-limit pledges warn, not block |
| 21 | [Ask to be paid](21-ask-to-be-paid.md) | revised — direct requests stay in-band; newcomer gets a tally |
| 22 | [Respond to a request](22-respond-to-a-request.md) | reviewed |
| 23 | [What needs my attention](23-what-needs-my-attention.md) | reviewed |
| 24 | [Tally history](24-tally-history.md) | revised — running balance separated from net worth |
| 30 | [Pay someone I'm not connected to](30-pay-through-the-network.md) | revised — no directory; suggested partners; vendor-funded route |
| 31 | [Trading settings](31-trading-variables.md) | revised — cross-unit movement needs a rate first |
| 40 | [My position](40-my-position.md) | reviewed |
| 41 | [My exchange rates](41-my-exchange-rates.md) | revised — Goldback example, indexed rates, arbitrage risk |
| 42 | [Settings](42-settings.md) | reviewed |
| 14 | [My cadre](14-my-cadre.md) | revised — counterparty durability is borrowed, not guaranteed |
| 43 | [Notifications](43-notifications.md) | reviewed |
| 51 | [Staying reachable](51-change-my-address.md) | reviewed |

Groups 1-2 (01-07) cover the tally lifecycle end to end; group 3 (10-13, 50) covers identity;
group 4 (20-22) covers value moving between two parties.

Open points carried by reviewed stories, each tracked as a ticket:
- Whether a declined invitation is visible to the inviter — `feat-offer-lifecycle` (story 02).
- Whether over-limit pledges warn rather than block — `feat-manual-chit-credit-gate` (story 20).
- Whether a party can record while the counterparty is unreachable — `feat-engine-tally-api`
  (story 20).

## Not yet written

| # | Story | State |
|---|-------|-------|
| 25 | [My records in my books](25-my-records-in-my-books.md) | stub |

## Suggested order after group 4b
- **Group 7 — the tail**: 43 (notifications), 51 (change my address), 25 (books). 51 may not survive
  contact with Taleus at all — see its stub.
