description: Let a payee help payers find it by naming a few parties who know it ("reachable through these people"), so searches can aim at, or start from, those parties instead of hunting blindly through the network.
prereq: tallynet-discovery
files: packages/tallynet/docs/design.md, packages/tallynet/src/discovery/, tickets/backlog/feat-tallynet-bidirectional-search.md
----

Owner's idea (2026-11-24): a party may identify itself in a search as "ID1, known to ID2" or "ID1, known to [ID2, ID3, ID4, …]". With such hints a search can start from several points at once.

Uses:
- **More targets.** Reaching any hinted contact is one hop from the recipient, so the search succeeds on finding any of them (shorter, wider target).
- **More starting points.** Hinted contacts (or the recipient through them) can launch searches that meet the payer's (`feat-tallynet-bidirectional-search`).
- **Steering.** Each node's propagation policy can prefer candidates that lead toward a hinted party.

Constraints: hints are voluntary disclosure by the recipient, but they also expose the contacts (its tally partners). Decide whether a contact must consent, and whether hints name contacts' stable keys or lift identities they publish for this purpose (see `feat-tallynet-lift-identity-options`). Hints are optional query data; TallyNet carries them and hands them to the per-node policy hook, it never requires them.
