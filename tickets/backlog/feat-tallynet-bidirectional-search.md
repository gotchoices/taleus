description: Let a route search start from more than one place — the payer, the payee, and possibly parties the payee names — with the searches meeting somewhere in the network, which finds routes far faster than searching from one side only.
prereq: tallynet-discovery
files: packages/tallynet/, packages/tallynet/docs/chipnet-review.md
----

ChipNet designs a **bidirectional search** (`../chipnet/doc/discovery.md` § Bidirectional search): originator and target both expand outward, and the search succeeds where the two frontiers meet. This roughly square-roots the explored node count for a given route length. It was never built (`../chipnet/src/bidirectional/originator.ts` is an empty class). TallyNet v1 is unidirectional, which is enough for payments (search for the payee) and circular lifts (search for yourself).

Promote when unidirectional discovery is too slow or too shallow in practice. Needs a plan pass: how the payee learns a search wants to meet it (an invoice or payment request already puts the two parties in contact out of band), how meeting points are detected without disclosing tally ids, and how denomination conversion composes when the two halves meet.

Direction from the owner (2026-11-24):
- The recipient gives the payer enough information (out of band, e.g. in an invoice or payment request) to launch its own search; the searches converge somewhere in the graph.
- A recipient that names or prefers a landing tally fixes the terminal currency, which tells every search what unit it is heading for.
- Generalise from two points to **many**: with routing hints (`feat-tallynet-routing-hints`) the recipient's named contacts are further starting points or targets.
- Every node still decides for itself whether and how to continue a search (per-node propagation policy).
