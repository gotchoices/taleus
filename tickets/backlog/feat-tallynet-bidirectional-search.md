description: Let the payer and the payee both search toward each other when finding a route, which finds routes faster and through larger networks than searching from one side only.
prereq: tallynet-discovery
files: packages/tallynet/, packages/tallynet/docs/chipnet-review.md
----

ChipNet designs a **bidirectional search** (`../chipnet/doc/discovery.md` § Bidirectional search): originator and target both expand outward, and the search succeeds where the two frontiers meet. This roughly square-roots the explored node count for a given route length. It was never built (`../chipnet/src/bidirectional/originator.ts` is an empty class). TallyNet v1 is unidirectional, which is enough for payments (search for the payee) and circular lifts (search for yourself).

Promote when unidirectional discovery is too slow or too shallow in practice. Needs a plan pass: how the payee learns a search wants to meet it (an invoice or payment request already puts the two parties in contact out of band), how meeting points are detected without disclosing tally ids, and how denomination conversion composes when the two halves meet.
