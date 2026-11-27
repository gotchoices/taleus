description: The simulator's equivocation tests fake a cheating voter by hand-crafting both of its conflicting votes; add an option for a simulated node to genuinely produce two conflicting votes on its own, so the tests prove the real failure can happen, not just that it is caught.
prereq:
files: packages/tallysim/src/sim/hostile-records.ts, packages/tallysim/src/sim/hostile-scenarios.test.ts, packages/tallysim/src/sim/consensus-resource.ts, packages/tallynet/src/testing/consensus.test.ts
difficulty: medium
----

## Context

Ticket `tallysim-hostile-consensus-scenarios` (now complete) added hand-driven hostile-actor
scenarios. The two **equivocation** scenarios (a voter that signs `C` to one half of the network and
`NC` to the other) prove the *detection* side: proof retention (`equivocationProof` / `equivocators`),
and `contradicts()` / the `contradiction-detected` trace event firing at a voter-majority boundary.

They do this by **god-minting** both faces with the simulator's own keys (`signAs('2','C',…)` *and*
`signAs('2','NC',…)`) and injecting them as crafted records. No simulated node is ever driven to emit
two conflicting faces from its own `castCommit`. This is an honest, documented limitation — see the
module header of `hostile-scenarios.test.ts` and the design-doc subsection *Hostile-actor scenarios*.

## Why this is only debt, not a bug

The *native* double-sign behaviour — that a participant resource induced to vote twice emits two faces,
and that the merge treats them as equivocation — is already unit-tested at the single-participant level
in `tallynet` (`src/testing/consensus.test.ts`, § adversarial signatures / equivocation). So the
protocol-level property is covered; what the sim tests cover is the *merge/detection* composition over a
real route. Nothing is wrong. This ticket is additive coverage strength, not a defect.

## What to build

A simulator resource (or a `makeSimResources` option) that models a genuinely malicious voter: on
`castCommit` it signs **both** `C` and `NC` with its own key and delivers them to different peers,
instead of the test god-minting the two faces. Then rewrite one equivocation scenario to drive that
resource rather than inject crafted records, so the suite proves the attack can *originate* at a node,
not only that a merge catches pre-built evidence of it.

Keep at least one god-minted scenario too — the hand-driven injection is still the cleanest way to pin
exactly which node sees both faces for the contradiction-boundary assertions.
