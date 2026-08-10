# Stories Status

Tracks how far each story has come. The set itself, its grouping, and where it came from live in
[index.md](index.md).

States: **stub** (topic only) → **drafted** (written, not yet human-reviewed) → **reviewed**
(human has read and accepted it) → **revised** (changed after review).

## Ready for review

Group 3b — the rest of identity, completing what 12 referenced. 13 carries two angles: which devices
can act as me, and whether anything of mine is available for my tallies to keep clearing. 50 keeps
total-loss recovery entirely outside the app — no in-band request to re-authorize anyone.

| # | Story | State |
|---|-------|-------|
| 13 | [My devices](13-my-devices.md) | drafted |
| 50 | [Recover after losing a device](50-recover-after-losing-a-device.md) | revised — recovery moved out of band |

Both defer platform specifics to the `feat-master-key-custody` and `feat-total-loss-recovery`
tickets rather than assuming them.

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
| 12 | [Keys and backup](12-keys-and-backup.md) | revised — off-device spare authority; platform parts flagged |

Groups 1 and 2 (01-07) cover the tally lifecycle end to end. Known open point: whether a declined
invitation is visible to the inviter (story 02, alternative B) — being settled in the
`feat-offer-lifecycle` ticket.

## Not yet written

| # | Story | State |
|---|-------|-------|
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
| 51 | [Change my address](51-change-my-address.md) | stub |

## Suggested order after group 3b

- **Group 4 — trading**: 20, 21, 22, 24, then 23 once there is enough happening to need it.
- **Group 5 — the network**: 30, 31. Hardest to explain; worth having the rest settled first.
- **Group 6 — the rest**: 40, 41, 42, 43, 51.
