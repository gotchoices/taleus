description: Let a party take part in lifts without being recognisable to anyone on the route except its direct trading partners, by using a one-time identity per lift and choosing whether to publish its network address.
prereq: tallynet-consensus
files: packages/tallynet/docs/design.md, packages/tallynet/src/consensus/, packages/taleus-core/src/lift/, docs/architecture.md
----

Default (decided): every member of a lift sees the whole route, including each member's stable lift-agent key and any published dial address. See `packages/tallynet/docs/design.md` § Member identity and disclosure.

Two per-party settings to add, off by default:
- **Per-lift key.** Sign a lift with a fresh key pair instead of the stable agent key. The neighbour learns it over the shared tally connection (authenticated by tally keys); referees learn who is behind it only if told (`Member.secret`).
- **Dial-address disclosure.** Publish `Member.physical` or not. Without it the member is reached only through its link neighbours; every referee still needs a path to every participant.

Interaction: a published libp2p address carries a stable peer id, so a per-lift key with a published address hides nothing; the settings UI and docs must say so. Tests: a route where some members use per-lift keys and no address still settles; a referee with no direct path is reached by relay; a neighbour rejects a promise signed by a key its partner never introduced.
