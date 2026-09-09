# Scenarios

Storyboards for review, in the order a party meets them. Each screenshot links to the deep link that
produced it: run `appeus/scripts/preview-scenarios.sh --target mobile --device <id>` and clicking one
opens that state on that device.

1. [First run](10-first-run.md) — installing, being told what this is, ending up ready (story 10)
2. [Inviting someone to tally](01-invite-a-partner.md) — terms, and nobody's name (01)
3. [Responding to an invitation](02-respond-to-an-invitation.md) — the invitee's side (02)
4. [Finding a tally](06-find-a-tally.md) — the list, and what it says without being opened (06)
5. [First look at an open tally](04-first-look-at-an-open-tally.md) — what a tally is (04, 07)
6. [Tally history](24-tally-history.md) — following the balance back (24)
7. [What needs my attention](23-what-needs-my-attention.md) — across every tally (23)
8. [My position](40-my-position.md) — owed, owing, and an estimate (40)

`/states` in the preview lists every registered state, including the ones worth opening but not
photographed.

## Coverage

One doc per story, for every story a coded screen serves. Nine screens are built — `Welcome`,
`ChooseName`, `CreateInvitation`, `ReviewInvitation`, `TallyList`, `TallyView`, `TallyHistory`,
`Attention`, `Position` — covering stories 01, 02, 04, 06, 07, 10, 11, 23, 24 and 40. Story 11
appears only as the name asked for in first run and the disclosure choice on an invitation;
`Profile` and `DisclosureView` are unsliced.

## Not yet storyboarded

Negotiating terms (story 03) — countering an offer rather than accepting it — is `ReviewOffer`, and
is the missing half of the invitation arc. Paying and requesting (20, 21, 22) are unsliced, which is
why no scenario here shows value moving on purpose.
