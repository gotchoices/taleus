# Scenarios

Storyboards for review, in the order a party meets them. Each screenshot links to the deep link that
produced it: run `appeus/scripts/preview-scenarios.sh --target mobile --device <id>` and clicking one
opens that state on that device.

1. [First run](10-first-run.md) — installing, being told what this is, ending up ready (story 10)
2. [Finding a tally](06-find-a-tally.md) — the list, and what it says without being opened (06)
3. [First look at an open tally](04-first-look-at-an-open-tally.md) — what a tally is (04, 07)
4. [Tally history](24-tally-history.md) — following the balance back (24)
5. [What needs my attention](23-what-needs-my-attention.md) — across every tally (23)
6. [My position](40-my-position.md) — owed, owing, and an estimate (40)

`/states` in the preview lists every registered state, including the ones worth opening but not
photographed.

## Coverage

One doc per story, for every story a coded screen serves. Seven screens are built —
`Welcome`, `ChooseName`, `TallyList`, `TallyView`, `TallyHistory`, `Attention`, `Position` — covering
stories 04, 06, 07, 10, 11, 23, 24 and 40. Story 11 appears only as the name asked for in first run;
`Profile` and `DisclosureView` are unsliced.

## Not yet storyboarded

The invitation arc (stories 01, 02, 03) — how a tally comes to exist — is unsliced, which is why
these scenarios begin with tallies that already exist. So are paying and requesting (20, 21, 22),
which is why no scenario here shows value moving on purpose.
