description: Protect route searching from abuse and waste by limiting how many searches a neighbour may send, preferring responsive neighbours, and not trusting the timing figures peers report.
prereq: tallynet-discovery
files: packages/tallynet/, packages/tallynet/docs/chipnet-review.md
----

ChipNet's design covers **query economics** and **pathologies** (`../chipnet/doc/discovery.md` § Query economics, § Pathologies; `doc/discovery/todo.md`): per-peer quotas and metrics, down-ranking slow or absent sub-links, refusing to escalate depth when all candidates are still in flight, and validating timing statistics a peer reports (ChipNet's `validatedStats` is a stub). Also **advertising**: pushing open lift capacity to nearby nodes so searches start warmer.

None of this is needed for a small network of cooperating nodes. Promote before discovery is exposed to parties that don't know each other, or when search traffic becomes a cost.
