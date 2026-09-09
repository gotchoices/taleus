# Scenarios

Storyboards for review, in the order a party meets them. Each screenshot links to the deep link that
produced it: run `appeus/scripts/preview-scenarios.sh --target mobile --device <id>` and clicking one
opens that state on that device.

1. [First run](10-first-run.md) — installing, being told what this is, ending up ready (story 10)
2. [Inviting someone to tally](01-invite-a-partner.md) — terms, and nobody's name (01)
3. [Responding to an invitation](02-respond-to-an-invitation.md) — the invitee's side (02)
4. [Negotiating terms](03-negotiate-terms.md) — countering, and two offers signed at once (03)
5. [Finding a tally](06-find-a-tally.md) — the list, and what it says without being opened (06)
6. [First look at an open tally](04-first-look-at-an-open-tally.md) — what a tally is (04, 07)
7. [Paying a partner](20-pay-a-partner.md) — recording value given (20)
8. [Asking to be paid](21-ask-to-be-paid.md) — a request that does not tick (21)
9. [Tally history](24-tally-history.md) — following the balance back (24)
10. [What needs my attention](23-what-needs-my-attention.md) — across every tally (23)
11. [My position](40-my-position.md) — owed, owing, and an estimate (40)

`/states` in the preview lists every registered state, including the ones worth opening but not
photographed.

## Coverage

One doc per story, for every story a coded screen serves. Twelve screens are built — `Welcome`,
`ChooseName`, `CreateInvitation`, `ReviewInvitation`, `ReviewOffer`, `TallyList`, `TallyView`,
`TallyHistory`, `PayPartner`, `CreateRequest`, `Attention`, `Position` — covering stories 01, 02, 03,
04, 06, 07, 10, 11, 20, 21, 23, 24 and 40. A tally can now be offered, answered, negotiated, read,
and paid into. Story 11
appears only as the name asked for in first run and the disclosure choice on an invitation;
`Profile` and `DisclosureView` are unsliced.

## Not yet storyboarded

Answering a request (story 22) is `RequestView`, unsliced — so a request can be made but not
followed. Closing a tally (05), changing the terms of an open one (03 paths C–E), and paying someone
you hold no tally with (30) are unsliced too.
