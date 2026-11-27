description: Use the same network search to answer "how closely am I connected to this person, and how much do the people between us trust each other?" — for example, before getting into a ride-share driver's car — without moving any value.
prereq: tallynet-discovery
files: packages/tallynet/docs/design.md, packages/tallynet/src/discovery/
----

Owner's use case (2026-11-24): a ride-share style app wants to know, before a trip, whether any of my trusted associates tallies directly with the driver, and more generally how many degrees separate me from a potential trading partner.

- **Degrees of separation.** A discovery-only query (no consensus phase, nothing held or moved) toward a target, returning the shortest paths found and their length. TallyNet's discovery is generic over intent codes and terms, so this is a new intent (a "trust" or "reach" intent alongside lift `L` and comms `C`) plus a satisfaction predicate, not a new protocol.
- **Trust quantification (advanced).** Each hop contributes a trust figure for its edge, e.g. "I trust A 600, A trusts B 800, B trusts C 100", and the originator combines them (minimum along the path, a normalized product, or a policy the app chooses). A natural source is the credit each party extends on the tally (credit extended is trust expressed in value), but a hop may report another figure or decline.

To settle when promoted: what a hop discloses (a figure, a band, or only "yes, I know them"); whether answering is opt-in per node; abuse limits (`debt-tallynet-query-economics`); how results are presented as evidence, not guarantees. Each node's own policy decides whether to answer and propagate, as for lift searches.
