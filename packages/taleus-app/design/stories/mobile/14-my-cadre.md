# User Story: My cadre

## Story Overview

I want my own records kept somewhere safer than one phone, and I want my tallies to keep working
while that phone is in my pocket — without handing my financial life to anybody.

Context: Jan has been trading for a year. His tallies are busy; his phone is not always on. He has
heard he can add a node of his own and wants to know what that would actually do for him.

## Roles

Any party. A cadre is the set of machines acting for one person — nobody else's.

## Sequence

1. Jan can see what his cadre consists of today: one phone.
2. He is told what that means, split honestly in two.
3. **His tallies are the less fragile part.** Every tally is held by his counterparty's machines as
   well as his own, so the record of what he owes and is owed survives his phone going under a bus.
   That safety is borrowed, though: it rests on the other party keeping their copy and being willing
   to produce it. Nobody can quietly alter it — every entry carries the signature of whoever made it
   — but a partner who vanishes, or who keeps careless records, leaves Jan with nothing of his own to
   point at. His own copy is what makes the record his evidence rather than their favor.
4. **His own private records are the fragile part.** What he has valued things at, what he prefers,
   his own view of everything he holds — nobody else has a copy of that, because none of it is any
   counterparty's business. It lives only on his machines.
5. He adds a node — something of his that stays on, whether he stood it up with a provider or runs it
   himself.
6. He sees his cadre become two, and what each contributes: his private records now exist in more
   than one place, and something of his is available around the clock
   ([13](13-my-devices.md)).
7. He can remove a node later, and is told what he would be giving up if that leaves him with one.

### Alternative Path A: only ever a phone
1.1. Jan never adds anything.
1.2. This is not blocked and not nagged at. It is stated once, accurately: his tallies survive with
     his counterparties — as far as those counterparties are diligent and honest — while his own
     private records survive nowhere but here.
1.3. He is told what he could lose in his own terms — his rates, his preferences, his own view of his
     affairs — rather than in the language of nodes and replication.

### Alternative Path B: someone offers to host for him
1.1. A friend with a machine that is always on offers to hold Jan's data.
1.2. Jan is told plainly what that would mean: his private financial records would sit on someone
     else's machine. That is a different decision from adding a machine of his own, and the app does
     not blur them.
1.3. If he does it anyway, it is because he decided to, knowing that.

### Alternative Path C: a node that goes away
1.1. Jan's provider shuts down, or he stops paying.
1.2. He is told before he is down to one machine, if that can be seen coming, and told plainly
     afterward if it cannot.
1.3. Nothing is lost while any machine of his remains.

### Alternative Path D: what he does not have to arrange
1.1. Jan wonders whether he must add his counterparties' machines to anything, or they his.
1.2. He does not. A tally is already shared between exactly the two of them; that arrangement needs
     no administration and is not something he assembles.

### Alternative Path E: moving on
1.1. Jan replaces his phone and his node in the same month.
1.2. As long as one machine of his is present at a time, his records move with him and nothing needs
     rebuilding. → [50](50-recover-after-losing-a-device.md)

## Acceptance Criteria

- [ ] A party can see what machines make up their cadre
- [ ] The party is told which of their records survive elsewhere and which exist only on their own
      machines
- [ ] Survival elsewhere is described as depending on the counterparty keeping and producing their
      copy — not as a guarantee the system makes
- [ ] A party can add a machine of their own, whether hosted by a provider or self-run
- [ ] The contribution of each machine is stated: durability, availability, or both
- [ ] A party can remove a machine, and is told the consequence when it leaves them with one
- [ ] A party running only a phone is told the consequence once, accurately, without nagging
- [ ] Consequences are stated in terms of what the party would lose, not in infrastructure terms
- [ ] Hosting by someone else is presented as a distinct decision, with its privacy cost stated
- [ ] The party is not asked to arrange anything for tally replication with counterparties
- [ ] Records move with the party as machines are replaced, provided one remains

## Variants
- happy: phone plus an always-on node, and a clear picture of what each does
- empty: a party with a single phone
- error: a node lost or shut down; a party down to one machine

## Open

What a node is, how a party stands one up, and what a provider offers are platform matters still
settling — see the `feat-master-key-custody` and `feat-device-and-recovery-surface` tickets. Health's
`10-networking` story covers the equivalent ground for that app and is the closest sibling precedent.
