# Scenarios

Storyboards for review, in the order a party meets them. Each screenshot links to the deep link that
produced it: run `appeus/scripts/preview-scenarios.sh --target mobile --device <id>` and clicking one
opens that state on that device.

1. [First run](10-first-run.md) — installing, being told what this is, ending up ready (story 10)
2. [Inviting someone to tally](01-invite-a-partner.md) — terms, and nobody's name (01)
3. [A code others can take up](01b-standing-invitation.md) — one set of terms, any number of answers (01, 10, 11, 21)
4. [Responding to an invitation](02-respond-to-an-invitation.md) — the invitee's side (02)
5. [Negotiating terms](03-negotiate-terms.md) — countering, and two offers signed at once (03)
6. [Finding a tally](06-find-a-tally.md) — the list, and what it says without being opened (06)
7. [First look at an open tally](04-first-look-at-an-open-tally.md) — what a tally is (04, 07)
8. [Paying a partner](20-pay-a-partner.md) — recording value given (20)
9. [Asking to be paid](21-ask-to-be-paid.md) — a request that does not tick (21)
10. [Responding to a request](22-respond-to-a-request.md) — answering in full, in part, or not (22)
11. [Closing a tally](05-close-a-tally.md) — winding down, and what nobody can refuse (05)
12. [Tally history](24-tally-history.md) — following the balance back, and one entry (24)
13. [Review the agreement](07-review-the-agreement.md) — terms in force, how they got there, what was signed (07)
14. [What needs my attention](23-what-needs-my-attention.md) — across every tally (23)
15. [What reaches you](43-notifications.md) — what interrupts, and what waits (43)
16. [My position](40-my-position.md) — owed, owing, and an estimate (40)
17. [What units are worth to me](41-my-exchange-rates.md) — pricing a unit, and what that makes you (41)
18. [Settings](42-settings.md) — language, unit, appearance, and which follow you (42)
19. [My profile and what I disclose](11-my-profile-and-disclosure.md) — who knows what, and why (11)

`/states` in the preview lists every registered state, including the ones worth opening but not
photographed.

## Coverage

One doc per story, for every story a coded screen serves. Twenty-two screens are built — `Welcome`,
`ChooseName`, `CreateInvitation`, `ReviewInvitation`, `ReviewOffer`, `TallyList`, `TallyView`,
`TallyHistory`, `PayPartner`, `CreateRequest`, `RequestView`, `CloseTally`, `Attention`, `Position`,
`Settings`, `Profile`, `DisclosureView`, `TallyTerms`, `EntryDetail`, `ExchangeRates`, `StandingInvitation`, `Notifications` — covering stories 01, 02, 03, 04, 05, 06, 07,
10, 11, 20, 21, 22, 23, 24, 40, 41, 42 and 43. The whole tally lifecycle is here: offered, negotiated, opened, traded on,
billed for, and wound down; and all four tabs now have a root.

## Not yet storyboarded

Changing the terms of an open tally (03 paths C–E), paying someone you hold no tally with (30), and
trading variables (31) are unsliced. Under Settings, so are devices (13), the cadre (14) and
recovery (12, 50). Choosing what to disclose *while forming* a
tally (11 steps 3–5) belongs to the invitation screens, which were built before it.
