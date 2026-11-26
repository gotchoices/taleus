description: Design how each lift's voters are proposed and accepted, and make sure every cooperating member can learn a lift's outcome once everyone has promised, even if some member refuses or goes silent. Every rule a lift runs under travels in the proposal as a parameter that each node accepts or refuses for itself.
prereq: tallynet-chipnet-regression
files: packages/tallynet/src/consensus/, packages/tallynet/src/discovery/, packages/tallynet/src/testing/, packages/tallynet/docs/design.md, packages/tallynet/docs/STATUS.md, packages/tallysim/, packages/tallysim/docs/design.md, packages/taleus-core/schema/draft1.qsql (read only: PendingLift, LiftFinalize), contracts/, ../chipnet/doc/cluster.md, ../chipnet/src/transaction/
difficulty: hard
----

Design principles (from the original MyCHIPs and ChipNet designs; settled with the developer 2026-11-25). Record them in `packages/tallynet/docs/design.md` § Lift design principles (replace the current wording) and build toward them.

0. **No global rules; each node decides.** In a distributed system there is no authority to impose caps or policies. Every rule a lift runs under is a **parameter in the lift proposal**: the voter set, the **consensus method** (how votes are weighted and the threshold), the deadline (`tallynet-propagation-timeouts`), any participant's added terms, and an optional **lift contract** reference (below). Each node checks the proposal against its own policy and either propagates (promises) or refuses; the originator chooses among the plans that come back, or keeps searching. Protocol code enforces only what keeps settlement consistent: verified signatures, a consensus method under which commit and void can never both be reached (the threshold must exceed half the total vote weight), and the deadline.
1. **Terms.** A **participant** is an entity whose tallies the lift moves (it benefits from the lift). A **voter** is anyone proposed to vote. A **referee** is a voter that is not a participant. A participant may vote itself and/or nominate referees; the **voter set** is their union, and a strict majority of it (or the proposal's higher threshold) settles the lift. There is no single referee. Today's code calls every voter a "referee" (member type `R`); rename to match these terms throughout tallynet (and tallysim/viewer).
2. **Validating evidence can come from anywhere, and merging is idempotent.** Whichever node first holds a deciding majority holds the proof and propagates it; nothing routes through the originator. Receiving a duplicate vote, or a record holding less than this node already knows, only ever adds to what it knows (TallyNet's union merge already does this). The one real conflict is one voter signing both commit and void (**equivocation**). ChipNet's design (`../chipnet/doc/cluster.md` § Node-level protocol, § Lying referees) refuses such a signature and leaves remedies to each participant (stay voided and join a correcting lift, or reverse with peers); TallyNet today refuses the second face and keeps the first (`participant.ts`, reject reason `equivocation`). Add: keep **both signed faces as proof** (input to `feat-tallynet-hostile-peers`), and state what each member does when it finds that its outcome contradicts a neighbour's.
3. **Promised means resolvable.** Once every participant has promised, the lift will resolve, to commit or to void, and only by the voters' majority, never by a participant deciding alone. Every cooperating member must be able to obtain that outcome, even if some member refuses to sign or relay. A refuser only hurts itself: on commit its neighbour's edge finalises from the refuser's phase-1 promise plus the commit evidence (Taleus's schema already works this way, `PendingLift` + `LiftFinalize`), and the refuser books its own side only when it completes.
4. **The originator runs the lift; linear and circular lifts share one protocol.** As in ChipNet, discovery returns a plan to the originator, and the originator starts the promise phase. A linear lift can be thought of as a circular one minus the final chit back to the originator. For a linear lift the payee must get word back to the originator. MyCHIPs did this by having the payee contact the originator at an address carried in the proposal; ChipNet returns the plan back along the route it came. Either way the originator, not the payee, starts phase 1.

## Design points to settle

- **No completion code (settled with the developer 2026-11-25).** ChipNet's phases are: 0 discovery (unsigned; the originator may get back several viable plans, `../chipnet/src/unidirectional/originator.ts` returns `plans: Plan[]`), 1 promise, 2 commit (voters vote), 3 consensus (spreading the decided record). The originator **proceeds** by choosing a plan (settle whether a record may combine several plans to meet the amount), building the transaction record from it, signing its own promise and propagating it. It then waits like any other member for a deciding vote, or for the deadline. Plans return to the originator along the path the query took, so a linear lift needs no separate word back from the payee. Before every participant has promised, the originator **aborts** by signing a pre-promise void. After that it has no special power. Check this against MyCHIPs's lift docs where available (https://github.com/gotchoices/mychips, `doc/`) and record any difference. Any message that changes lift state must be signed by a party entitled to send it.
- **Consensus method as a parameter (open, settled with the developer 2026-11-25).** Don't hard-code one way of reaching consensus. The proposal names the method, and nodes accept or refuse it like any other term. Candidates:
  - one vote per distinct voter;
  - weight split per nominator, e.g. a participant nominating 3 voters gives each ⅓, so stacking voters gains nothing;
  - a threshold above a strict majority (e.g. ⅔).

  Pick a **default** (recommend one vote per distinct voter, strict majority, which is today's behaviour), implement the method as a pluggable piece with that one default, and keep the alternatives open until `tallysim-hostile-actors` compares methods under attack. Record the choice and the open alternatives in `design.md`.
- **Contact points.** A node may publish how it can be reached for this lift (ChipNet's `physical`), as a term in its part of the plan, or decline to. A node that publishes one can receive updates from strangers (nodes it shares no tally with); one that doesn't hears only from its direct neighbours. The originator's contact point is how the payee's word gets back. Define the shape and how propagation uses contact points.
- **What a node sees when deciding.** Each node gets the lift proposal, which carries enough to decide whether to propagate. When a viable path is found, it returns to the originator as a plan with every participant's terms. Define exactly what the promise-time hook (`shouldPromise`) receives (full voter set, threshold, deadline, contract reference, every participant's terms), and what the discovery-time hook sees of the voters proposed so far.
- **Choosing among plans.** No caps from the protocol. Participants may add any number of terms, including voters. Each participant refuses a voter set it doesn't trust, and the originator decides whether to proceed with a plan, try another, or keep searching. Several well-known referees that everyone trusts is a fine outcome; a set stacked with obscure voters should simply not be chosen. Provide hooks, with simple default policies used by the simulator, for:
  - the originator's plan scoring (number of voters, trust, shared voters, path length);
  - each participant's voter-set acceptance.
- **Lift contract.** Tallies are governed by a tally contract the parties read before signing. Likewise a lift proposal gets a slot for a **lift contract CID**: the rules this lift runs under (what counts as commit or void, the threshold and tie handling, deadline semantics, remedies for equivocation). Parties that don't agree don't propagate. Settle:
  - which rules are machine parameters in the proposal versus prose in the contract;
  - whether a tally contract can limit which lift contracts its tally honours (this touches `taleus-core` at binding: write it into `feat-tallynet-bind-taleus-core`, don't change `taleus-core` here);
  - whether Taleus publishes default lift contracts in `contracts/` alongside the tally contracts.
- **Record availability.** Push both directions along the route, use contact points, and let members fetch the settled record from voters by transaction code. Guarantee: with any single non-cooperating member, every cooperating member still obtains the outcome. State what holds with k > 1.
- **What a tally needs to verify.** Today a referee signs a separate per-edge digest for each edge, riding the commit `attachment` (`design.md` § The commit attachment seam). With voter sets that becomes voters × edges signatures. Evaluate the alternative: voters sign the record once, and each tally verifies three things:
  - a deciding majority (per the proposal's threshold) of the record's voter set signed commit;
  - the record contains this edge with these terms;
  - the tally accepts the record's lift contract.

  Recommend one, and write out the exact checks a tally performs. That is the contract `feat-tallynet-bind-taleus-core` implements in the schema.

## Findings from the ChipNet regression check (recorded 2026-11-25)

Inputs for this ticket produced by `tallynet-chipnet-regression` (`packages/tallynet/docs/chipnet-review.md` § Regression check). None is a regression — each is a seam this ticket must close:

- **The plan→topology voter-set assembly is absent as library code in *both* ChipNet and TallyNet, and untested end-to-end in TallyNet.** The step that turns a discovered `Plan` into a `TrxRecord.topology` — unioning each participant's self-vote with its `dependsOn` nominees into the member set the majority is counted over — exists nowhere as protocol code. ChipNet only had it in a non-compiling test; TallyNet's harness `buildLift` (`packages/tallynet/src/testing/network.ts:392`) hand-builds `topology.members` from a spec and **never populates `dependsOn`**, so "a strict majority of the voters proposed in phase 1" is asserted only via that shortcut. The `dependsOn`→`plan.members` fold *is* present and identical on both sides (discovery `prependMatch`, `packages/tallynet/src/discovery/participant.ts:722`), and the strict-majority-both-ways count over members-of-type-`R` is correct (`consensus/participant.ts:421,433`). What is missing is the originator's record-minting from a returned plan, and an end-to-end test that a `dependsOn`-nominated referee reaches the topology as an `R` member and is counted. Build the minting here (or specify it precisely for `feat-tallynet-bind-taleus-core`) **and** add a discovery→consensus test that exercises referee nomination through a real plan, not a spec.
- **Record availability around a non-cooperating member is genuinely missing today — the exact gap this ticket's "Record availability" point must close.** After all promises, settlement is by the voters' majority and pushes to reachable peers (members with a `physical` address + direct link neighbours, `consensus/participant.ts:649`). For a **linear** chain with no contact points, an interior member that refuses to relay **blocks** the commit evidence from reaching the members beyond it — nothing routes around it. The guarantee "with any single non-cooperating member, every cooperating member still obtains the outcome" holds **only** when contact points (`physical`) or an alternate path exist (a diamond's other arm already demonstrates this in `testing/consensus.test.ts`). So contact points are not optional polish — they are what makes principle 3 true for linear lifts. State precisely which members must publish a contact point (at minimum the originator and the voters) for the single-refuser guarantee to hold, and what breaks at k > 1.
- **"Proof kept" on equivocation is aspirational, not built.** `design.md` § Lift design principles principle 2 says a voter signing both faces is "refused, and its proof kept"; the implementation refuses the second face and **drops** it (`consensus/participant.ts:269,333` → `rejectSignature`, log-and-discard). ChipNet kept no proof either (it threw the whole record), so this is not a regression — but the design doc currently overstates the built state. This ticket already lists "keep both signed faces as proof" as scope; when it lands, the proof store it adds is what makes `design.md` principle 2 true. Until then, either build it here or have STATUS.md name this ticket as the one that does (it now does).

## Simulation

Extend `tallysim` with:
- voter nomination and acceptance policies, including stacked voter sets that should be refused;
- phase-2 refusers and non-relayers;
- runs with and without contact points;
- linear and circular lifts.

Measure:
- how many cooperating members complete, against the number of refusers;
- time to settle;
- messages per lift;
- the share of plans refused or passed over because of their voter set.

Show the route and the record's flow in the viewer.

## Edge cases & interactions

- Voter sets of 1, 2 (tie: no settlement), 3, many; a participant that is also a voter; the same voter nominated by several members (counted once); a threshold above a strict majority.
- A refuser that is also a voter; a refuser next to the payee; the payee going silent after word reaches the originator.
- The originator unreachable after promises: what completes and from where.
- A proposal naming a lift contract a node doesn't know or can't fetch (refuse).
- Interplay with the forged-vote side pool (`design.md` § Protocol design): nothing unverified may block a verified vote.
- Timeouts and the deadline are the next ticket (`tallynet-propagation-timeouts`); leave the seams.

Split into implement tickets, e.g.:
- terms rename, plus proposal parameters (consensus method, deadline) and the lift contract slot;
- hooks for voter-set acceptance and plan choice;
- proceed/abort and contact points;
- record availability and equivocation proof;
- the tally verification contract;
- simulation and viewer.
