description: Let a party find out what is waiting on them across all their tallies, and make sure a phone wakes up in time to take part in a transaction that needs it.
prereq: feat-engine-tally-api
files: packages/taleus/src/index.ts, packages/taleus/schema/portfolio.qsql, packages/taleus-app/design/stories/mobile/23-what-needs-my-attention.md, packages/taleus-app/design/stories/mobile/43-notifications.md
difficulty: medium
----
## Why this ticket exists

A party may hold hundreds of tallies, nearly all of them dormant. What matters day to day is the
handful where something is waiting on *them*: an offer to countersign, a request to answer, a lift
that needs their commitment. MyCHIPs made this first-class — its schema flagged exactly which states
required user action, and the app drove notifications from it.

Two related needs: knowing what is pending, and being told about it when the app isn't running.

## Outcomes we're after

- A party can get, in one place, everything across every tally that is waiting on them — without
  the app polling each tally in turn.
- Items waiting on the *other* party are distinguishable from items waiting on the user, so the app
  can decide what to show without inventing its own rules.
- A phone with no always-on node still participates in lifts: it wakes for the commit window rather
  than missing it (Sereus provides hibernation wake; this is about using it correctly).
- The signal survives the app being closed, reinstalled, or run on a second device.

## Open questions

- Whether "needs my attention" is computed by the engine or derived by each app from state it can
  already see. Engine-side keeps the two apps consistent; app-side keeps the engine simpler.
- Whether this belongs in the portfolio strand (the party's private cross-tally view) or is computed
  live across strands at read time.
- What a lift commit window actually demands of a sleeping phone in the worst case, and whether
  anything here changes if a party has an always-on node.
- Whether notification delivery is in scope for the engine at all, or purely an app concern with the
  engine only supplying the signal.
