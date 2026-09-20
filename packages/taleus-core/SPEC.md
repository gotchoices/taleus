# taleus-core — specification

What this package is, what it must never become, and how to tell the difference. Written to
outlast any one iteration: a change that violates something here should be an argued decision, not
an accident.

`docs/architecture.md` (repo root) describes the system. This describes **the boundary of this
package**.

## What it is

The platform-neutral core of Taleus: tally logic, the Quereus sApp schema, crypto, transport and the
lift agent. One library, three kinds of host —

- a **phone**, inside the React Native app;
- a **server**, inside `taleus-node` or a company's ERP/POS integration;
- a **browser**, inside a web client or a test page.

…and one more that matters more than it looks: **an automated test**, with no network and no cadre.
If the core is awkward to drive from a test, it is awkward to drive from an integration, and the
test is the cheaper place to find out.

## What it is not

**It is not shaped by any app's screens.** Not this repo's mobile app, not the MyCHIPs-style UI that
will follow, not an ERP adapter. Those have different screens and different questions, and a core
that fits one fits the others badly. `packages/taleus-app/design/notes/core-asks.md` is one app's
wish-list, kept deliberately outside this package — useful input, not a specification.

The app-specific layer belongs **in the app**. Where a consumer wants `waitingOn: me | them` or a
cross-tally attention list, that is a view model over this core, not a function of it.

## Values

### 1. One API, defined, consistent, boring

A consumer should be able to carry a tally through its whole life without knowing what a strand is,
what Quereus is, or that Optimystic exists. Names mean the same thing everywhere. Shapes are the
same shapes. A thing that can fail returns why rather than throwing an exception the caller must
catalogue.

### 2. Asynchronous where anything can happen

Every operation that touches a store, a peer or a signature the caller did not already have is
`async`. Synchronous is reserved for what genuinely terminates immediately: pure computation over
values in hand — digests, encodings, arithmetic, building a row from data the caller supplied.

The test to apply: *could this ever need to wait?* If yes, it is async now, even when today's
implementation happens not to. Widening a sync function to async later breaks every caller.

### 3. No platform-specific dependency, direct or transitive

The core imports nothing from `node:`, nothing from a DOM, nothing from React Native. In particular
**no `Buffer`** — it exists in neither the browser nor React Native without a polyfill, and reaching
for it is the easiest way to break this rule without noticing.

Use `Uint8Array`, `TextEncoder`/`TextDecoder`, and the encoders in `src/lift/digest.ts`.

**This is about what ships, not about the repository.** Tests and test machinery may import
whatever is convenient — they run in Node and nowhere else. Two files are therefore exempt, and both
are excluded from the build by `tsconfig.build.json`:

- `src/store/schema-node.ts` — reads schema files off a filesystem. A React Native host bundles the
  `.qsql` text instead; a browser fetches it. Both call `openStrandFrom`. It ships (a Node consumer
  wants it) but **is exported from no index**, so nothing reaches it by accident.
- `src/store/test-harness.ts` — the two-replica harness. Test machinery that happens to live in
  `src/`, following the convention `src/lift/test-harness.ts` already set.

The guarantee that matters is about the **entry point**: a bundler following `src/index.ts` must
never arrive at `node:` anything. `src/store/spec.test.ts` walks the import graph from there and
asserts it.

### 4. One encoding, one digest, one spelling

Where two implementations of the same thing exist, they will diverge, and the failure looks like a
permissions bug rather than an encoding one: signatures stop verifying and nothing says why.

- The digest is `src/lift/digest.ts`. `Digest()` the host scalar **delegates** to it.
- The schema's text form for keys, signatures and digests is **hex** (`publicKeyText`,
  `bytesToHex`, `hexToBytes`).

Both of these have already been violated once each and caught by a test. Assume it will happen
again.

### 5. Deterministic where a replica re-validates

Every replica of a strand re-validates every write. A constraint that read a clock or a random
source would have replicas disagree about the same row, and the strand would diverge.

So: no `now()`, no random defaults, no non-deterministic host scalar inside a `CHECK` or a column
default. `DayNumber(column)` is pure; `Today()` is volatile and belongs only in a plain view. There
is deliberately no spelling that lets a constraint read the clock by accident. Row identifiers are
supplied by the caller, because they are inside the digest their signer signs.

See `docs/timestamps.md` for what follows from this.

### 6. Sereus is hidden, not bypassed

A consumer never touches a cadre, a strand handle, Optimystic or Quereus. It also must not be
*prevented* from doing anything Sereus can do — hiding the machinery cannot mean losing the
capability.

The point of the seam is version independence: when Sereus changes its plugin, its formation
contract or its transactor, the change lands in one adapter here rather than in every app.

**Status: the seam does not exist yet.** `openStrandFrom` opens a bare in-memory Quereus database.
Nothing binds a strand, and there is no interface a Sereus-backed store could implement. See § Where
Sereus plugs in.

### 7. Tests drive the shape

A feature arrives because a test asked for it. Negotiation is tested with **two parties, each on
their own replica**, because that is what the system is: an act is proposed to both, each engine
re-validates against its own copy of the schema, and the row stands only if both accept. A test on
one shared database tests a system nobody will run.

Every refusal asserts **which** constraint refused it. "Something failed" passes for the wrong
reason eventually — one test in this suite already did, failing on a duplicate column in its own SQL
while claiming to prove an authorization rule.

## Layout

| Path | What | May import `node:`? |
|---|---|---|
| `src/crypto/` | key generation, sign, verify, sha256 | no |
| `src/lift/` | discovery, agent, referee, commit, **the canonical digest and encodings** | no |
| `src/transport/` | ChipNet protocol and comms | no |
| `src/store/` | the Quereus strand: host scalars, statement loading, row writes | no |
| `src/store/schema-node.ts` | reading `.qsql` off a filesystem | **yes — only here** |
| `src/tally/` | formation, keys, negotiation, chits | no |
| `schema/*.qsql` | the sApp schema — the deployable artifact, and the source of truth | — |

## Where Sereus plugs in

Not built. Recorded so the shape is not invented twice.

A tally is a Sereus strand (`docs/architecture.md` § A Tally Is a Strand). Sereus already has the
machinery this core must sit on rather than reinvent: `formStrand()` and `OpenInvitation` for
formation, `registerMember`, the formation-approval hook, and `quereus-plugin-sereus` for binding a
Quereus database to a replicated strand.

**Question 1 is settled** — see [`docs/formation.md`](../../docs/formation.md). Taleus's seating
sits *inside* Sereus's formation and shares its invitation key: `Stock.InvitationKey` **is**
`Strand.Invite.Key`, one keypair used at two layers. The Taleus schema becomes an sApp schema
(`declare schema App`) applied beside `Strand` in one strand database, and `TallyContract` is gated
on the strand being sealed — verified: a sApp CHECK can read the `Strand` namespace. The work is
`feat-formation-over-sereus-strand`.

What remains to settle before writing the adapter:

1. **Can redemption and Taleus seating be one act?** If not, a strand can hold a member who is not
   yet a party, and the seam must reconcile it.
2. **Which transactor backs a tally strand?** `docs/STATUS.md` records that tally strands *must*
   bind to the synchronous Optimystic network transactor — the `quereus-sync` CRDT path writes
   column deltas straight to storage and **fires no SQL constraints at all**, which would silently
   void every signature gate in the schema. That choice belongs in this adapter, and it is easy to
   get wrong by default.

Until then, the store interface should be written as though a Sereus-backed implementation is
coming, because one is.

## Compliance checks

Cheap, mechanical, and worth running before believing any of the above:

```sh
grep -rn "from 'node:" src/ | grep -v schema-node     # § 3 — must be empty
grep -rn "Buffer" src/ | grep -v '\*'                  # § 3 — must be empty
grep -rnE "julianday|RandomUUID|now\(\)" schema/       # § 5 — must be empty
yarn workspace taleus-core test                        # § 7
```

The schema-scanning tests in `src/store/strand.test.ts` cover § 5 and the host-scalar contract;
`test/STATUS.md` tracks what is tested and what has been found.
