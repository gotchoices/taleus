# Stories Status

Tracks how far each story has come. The set itself, its grouping, and where it came from live in
[index.md](index.md).

States: **stub** (topic only) → **drafted** (written, not yet human-reviewed) → **reviewed**
(human has read and accepted it) → **revised** (changed after review).

## Ready for review

Group 3 — everything a person meets before, and alongside, their first tally. Steve arrives cold
(no invitation waiting); Sam's disclosure choices carry on from group 1.

| # | Story | State |
|---|-------|-------|
| 10 | [First run](10-first-run.md) | drafted |
| 11 | [My profile and what I disclose](11-my-profile-and-disclosure.md) | revised — dropped withdrawal path; corrections now authorized |
| 12 | [Keys and backup](12-keys-and-backup.md) | revised — off-device spare authority; platform-dependent parts flagged |

Notes: 12 leans on [13](13-my-devices.md) and [50](50-recover-after-losing-a-device.md), still stubs
— write those before considering this group settled. What a party's devices and off-device spare
authority can actually do is being coordinated with Sereus in the `feat-master-key-custody` ticket.

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

Groups 1 and 2 (01-07) cover the tally lifecycle end to end. Known open point: whether a declined
invitation is visible to the inviter (story 02, alternative B) — being settled in the
`feat-offer-lifecycle` ticket.

## Not yet written

| # | Story | State |
|---|-------|-------|
| 13 | [My devices](13-my-devices.md) | stub |
| 20 | [Pay a partner](20-pay-a-partner.md) | stub |
| 21 | [Ask to be paid](21-ask-to-be-paid.md) | stub |
| 22 | [Respond to a request](22-respond-to-a-request.md) | stub |
| 23 | [What needs my attention](23-what-needs-my-attention.md) | stub |
| 24 | [Tally history](24-tally-history.md) | stub |
| 30 | [Pay someone I'm not connected to](30-pay-through-the-network.md) | stub |
| 31 | [Trading variables](31-trading-variables.md) | stub |
| 40 | [My position](40-my-position.md) | stub |
| 41 | [My exchange rates](41-my-exchange-rates.md) | stub |
| 42 | [Settings](42-settings.md) | stub |
| 43 | [Notifications](43-notifications.md) | stub |
| 50 | [Recover after losing a device](50-recover-after-losing-a-device.md) | stub |
| 51 | [Change my address](51-change-my-address.md) | stub |

## Suggested order after group 3

- **Group 3b — the rest of identity**: 13, 50. Referenced by 12 and best written next.
- **Group 4 — trading**: 20, 21, 22, 24, then 23 once there is enough happening to need it.
- **Group 5 — the network**: 30, 31. Hardest to explain; worth having the rest settled first.
- **Group 6 — the rest**: 40, 41, 42, 43, 13, 50, 51.
