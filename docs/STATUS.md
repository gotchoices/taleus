# Taleus — Status & Open Items

A working checklist of items that are awkward to file as individual tickets, plus **cross-repo**
items (Sereus / Optimystic / Quereus) that Taleus depends on but cannot fix itself. This file is
**not timeless** — prune entries as they land. Timeless design lives in [`docs/`](.); discrete work
items live in [`tickets/`](../tickets/).

## Cross-repo: stack hardening Taleus depends on

Taleus's entire safety model rests on the Sereus/Optimystic/Quereus substrate enforcing signature-
and existence-constraints on every write. The following are **not** Taleus bugs — they are
dependencies to confirm or harden in the sibling repos. A fuller write-up (with file:line
citations) is prepared separately for transmission to Nathan; this is the digest.

- [ ] **Stack: on Sereus 1.19 / Optimystic 1.19 / Quereus 4.21.0 / FRET 1.2.1, one copy each.**
  Sereus/Optimystic 1.19 (2026-10-26): one commit's tables, indexes and `unique` columns go to each
  member together (Optimystic#42 active: 3 `cluster` requests per insert at any index count, measured
  by the chat side); a remote `cancel` reply is read as done (Optimystic#46 fixed); a read's
  background checks share one request per 32 blocks. Every machine of a party, and the parties of a
  strand, must move together (a 1.18 join gets nothing from 1.19). No Taleus code changes needed.
  Scenarios, loopback: 22 s (1.18: 34-61 s); a payment 0.2-0.3 s; the closing chit 0.6-0.9 s
  (1.18: 4.5-6.6 s). At 44 ms each way: 34.5 s (1.17: 60 s), forming 14.8 s, a payment ~0.75 s, the
  closing chit 2.1 s. Profiled at 44 ms (`profile-formation --local-relay 44 --count-requests`):
  accept 7.6-8.7 s (1.18: 12.0 s; 1.15: 28.1 s), waiting for terms 1-2 s (1.18: 7 s with the poll,
  15-16 s without), a payment 0.6-0.7 s in 9-10 requests (1.18: 1.7 s, 31).
  **Emulator <-> CLI over relay.sereus.org on 1.19 (2026-10-27, dev build, fresh parties):** onboarding
  1 s, the emulator's invite 6 s (1.14: 71 s), the CLI's accept 15 s (earlier: 256-533 s), the
  emulator's offer reached the CLI 7 s later, Open at once, the CLI's $1 at once; the emulator's
  $2.50 back in 4.2 s; the emulator lists its tally in 91-316 ms (1.15: 208-272 s). Both sides end
  at $1.50.
  **S7 <-> CLI (same day, dev build, relay.sereus.org):** onboarding 5 s, the S7's invite 30 s (as
  before: CPU-bound founding), the CLI's accept 40 s (1.15: 2 min 47 s), the S7's offer 89 s later
  (1.15: ~3 min), Open and the CLI's $1 at once. But the S7 lags: it saw the tally Open 1 min 50 s
  after the CLI, its reads took ~16 s then 2-3 s, and its own $2.50 took 117 s. It runs at 150-220%
  CPU whenever the other party is online, ~30% once it leaves. A 60 s Hermes profile
  (`scripts/cpu-profile.mjs`, symbolicated through Metro) is 100% busy: Ed25519 `verify` in pure JS
  15.6% (92% of it cohort-topic gossip: filed **Optimystic#49** -- 216 frames a minute per party
  while idle, one per watched collection every 5 s, each verified with noble; ~40 ms each on the
  S7), peer-store `toPeerPB` sort `localeCompare` 6.5% (#40), a native cipher object per Noise
  message (`createCipheriv` via cadre-rn `noise-crypto`) ~6.6%, WebSocket `sendBinary` 5.3%, young
  GC 3.4%. Resident memory 503 -> 818 MB over 30 min with two tallies.
  **First phone-to-phone tally (S7 <-> emulator):** the emulator invited (6 s), the S7 accepted
  (65 s) and, once the offer arrived, accepted the terms (40 s; dev bridge `answerOffer`); the
  emulator saw Open within 1 s. Payments: emulator -> S7 written in 16 s, seen 7 s later; S7 ->
  emulator written in 31.5 s, seen 1 s later. Both end at $2.00.
  **Closing on the phones (2026-10-28, after stories 04/05 were reviewed):** the emulator asked to
  close (8 s), the S7 saw Closing 5 s later; the creditor's previews warn only for an entry that
  moves the balance away from or past zero (`growsClosing`); the S7's $2.00 settlement (8 s) closed
  it on both; a further entry is refused (`closed`); TallyView on the closed tally offers no pay, ask
  or close. Seen on the way: (1) an engine refusal reached the screen as raw SQL ("CHECK constraint
  failed: NotClosed (...)"); screens now word errors by `kind` (`errorText`, `errors.*` strings), and
  keep the message for kinds the mock words itself. (2) TallyView showed "Room to spend" on a closed
  tally; hidden now. (3) A tally list that stayed stale after commits, cured by a
  full reload: most likely Fast Refresh re-running the notification wiring after a dev-bridge edit
  (after the reload, commits replicated from the other phone moved the screens' generation 5 -> 36
  and the list followed). (4) cadre-core reports a failed relay dial as `[object Object]` when the
  reason is not an `Error` (`relay-reservation.ts`, `String(result.reason)`): filed sereus#54. (5) A second S7 join of
  an emulator invitation timed out at 120 s ("the inviter's side has not answered") and had not
  completed minutes later; the first, an hour earlier, took 65 s.
  **Optimystic#47 (filed 2026-10-22): fixed by 1.19** (not yet closed). A replicated commit applied
  one collection at a time, so a table's wake came before its index was readable and the inviter
  slept until a poll or the 30 s tick. Its repro `strand-watch-wakes-before-index` (copy in
  `../sereus-wt-118`) passes 2 of 2 on 1.19; with Taleus's poll off, terms now arrive in 1 s.
  **Optimystic#48 (filed 2026-10-22): mostly addressed by 1.19's batching** (not yet closed). The
  reactivity tick still reads every watched tail every 30 s (20 s edge), but the held-block checks now
  share requests: an idle party sends 2-5 `sync` requests a tick, not one per table (18).
  Taleus's 10 s backstop poll is now the larger idle cost; with #47 fixed it can be lengthened.
  **Optimystic#46 (filed 2026-10-22): fixed in 1.19** (not yet closed). Also seen while finding it:
  the writer pends against a stale Ledger revision though it has already read the counterparty's
  newer rows (the 2.1 s closing chit at 44 ms is likely that retry).
  `taleus-sereus`'s store takes a `StrandNode` (the node methods it uses) rather than the class.
  `@babel/runtime` must be
  ^7.29.2 (older helpers hang Quereus's lock under Hermes; sereus#8).
  Optimystic 1.14 and 1.15 need no new Sereus (1.15 asks for ^1.13; `yarn up -R '@optimystic/*' p2p-fret`
  dedupes). 1.15 only requires FRET 1.1.0 (idle maintenance backs off to a pass a minute, peer list
  no longer re-read each pass, slow-relay peers reconnect) and passes the node's dial timeout through.
  On a loopback accept it cut consensus traffic about 4x (block promise requests 208 -> 68, block
  commits served 612 -> 128); reads are unchanged (#47).
  1.15's control schema change means a party made on 1.14 must be recreated (test phones wiped
  2026-10-12). `taleus-core` depends on `@quereus/quereus` and
  `@optimystic/quereus-plugin-crypto` directly; the prescribed-usage checklist the Sereus adapter must
  follow is in `packages/taleus-core/SPEC.md` § Where Sereus plugs in.
- [ ] **Upstream items we filed** (2026-10-05):
  - gotchoices/sereus#33 — native Ed25519 in `@serfab/cadre-rn` (`/polyfills/native-crypto`).
    **Shipped in 1.15**; the mobile app imports the kit's and dropped its own.
  - gotchoices/sereus#48 (2026-10-14) -- on a phone-shaped link an app's steady work fails and the
    sides diverge while both members are up; fixed deadlines turn a slow link into congestion
    collapse. Node repro (`strand-workload-on-a-phone-link`). Commented 2026-10-14: still on 1.14.
    Maintainer (2026-10-15): fixed deadlines identified (5 s cohort-topic/FRET RPC, signatures,
    authorization; 10 s read-repair; libp2p ping; unbounded coordinator retry); #47 first, then
    filed upstream; asked for a rerun on 1.16. Rerun posted 2026-10-16: on 1.16 one run kept the
    strand nodes connected (a first), the other did not; with the link up, 8 and 6 of 8 rounds
    failed (1.13: 1), deadline events 2-5x; never converged. Maintainer (2026-10-26) asked for a
    rerun on 1.19. The chat side ran one on a loaded Mac (not posted; `../chat/tmp/handoff-sereus48-1.19.md`):
    every round's write still failed, seating 331.6 s, FRET marked the strand peer dead 27 times.
    Two quiet reruns here (load ~2.5-3.5, 2026-10-26), alike: **no operation failed, converged with all
    8 rows** (a first), 8 rounds 443-445 s (1.16: 603-1056 s), seated 220 s, FRET peer never marked
    dead, 0 stream resets, 1 commit retry, 19.9k frames (chat run: 91.9k). The `it.fails` still fails
    only on the DEBUG fault count: 106 "cohort silent", equal to the 106 "consult held" (background
    held-block checks). CPU load looks decisive. Not posted yet.
  - gotchoices/Optimystic#42 (2026-10-19) -- a write pays 4 `cluster` requests per index (4(k+1) for k
    indexes; a Ledger payment 24) though one commit's trees are one batch; a partial index costs rows
    it excludes. Suggests carrying one commit's trees together per member per phase, deriving
    non-unique indexes locally, and honouring partial predicates. Repro `strand-index-write-cost`.
    Maintainer: groundwork shipped in 1.17 (not active; held on a mixed-version decision); the
    partial-index bug split into its own issue. **Active in 1.19:** 3 `cluster` requests per insert at
    0-5 indexes and for the excluded partial-index row (chat side's measurement, commented on the
    issue 2026-10-26); a Taleus payment at 44 ms went from 31 requests to 9-10.
  - gotchoices/Optimystic#41 (2026-10-19) -- `FileRawStorage.listBlockIds` never lists a block id with a
    `/` (every collection header), so Sereus's join backfill skips them on file storage; fixing the
    listing halves formation at a 176 ms round trip (probe 14 s -> 1.7 s). Plain-Node repro in the issue.
    **Fixed in 1.16.** The drain's duplicate re-push the maintainer asked about is fixed in
    Optimystic/Sereus 1.18 (`reportBlockHeld`), from Sereus's own measurement.
  - gotchoices/Optimystic#40 (2026-10-15) -- peer-store churn: `findCluster` reads every candidate's
    record per call and libp2p merges on every stream (one per request); ~15% of the S7's JS thread.
    Node repro (`strand-peer-store-churn`).
  - gotchoices/sereus#50 (2026-10-15) -- an idle cadre reads its own control database ~78 times a
    minute (5 s strand-watcher poll and others), each through Optimystic's full read path. Node repro
    (`cadre-idle-reads`). Maintainer: reproduced; pollers to become event-driven (`db.watch`);
    idle reads mostly the control reconcile pass (46%) and the strand watcher (31%). **Shipped in
    Sereus 1.18** (issue still open): re-measure idle reads on the phone.
  - gotchoices/Optimystic#37 (2026-10-14) -- file storage fsyncs every block file separately
    (enhancement: OS-dependent cost; WAL or per-commit flush; the platform durability question).
  - gotchoices/Optimystic#33 (our PR, `cid()` dag-json codec) -- open, no review yet.
  - gotchoices/sereus#47 (2026-10-13) — a strand table nobody has written costs a cohort round trip
    on every read and cannot be read with the other member offline. On two phones over the relay it
    made each agent step take minutes, so a tally never formed. Node repro in the issue; proposed fix:
    the founder creates every app table's collection at founding. Maintainer (2026-10-15): accepted --
    the founder will create a collection for every declared app and strand table; not shipped. Commented 2026-10-14: the offline
    half needs link latency (loopback now reads locally).
  - gotchoices/Optimystic#30 — `quereus-plugin-crypto` has no native-crypto seam: its SQL `verify` runs
    pure-JS Ed25519 (408 ms of a 29 s invite on a Galaxy S7). Open.
  - gotchoices/Optimystic#31 — cohort-topic proof-of-work starved the phone's JS thread. **Fixed in
    Optimystic 1.12** (keyed nodes skip it); lets the phone run `strandReactivity` again.
- [ ] **Read-dependency validation must be live on the consensus commit path — now for cross-table
  rules only.** Sereus guarantees that a declared unique value (primary key or secondary index)
  refuses the second of two racing rows, so every "at most one" rule in the schema is now a
  `unique` index rather than a counting CHECK: one chit per invoice, one finalize per lift, one
  registration per key, and the new one-chit-per-id that makes a retried payment safe. What still
  relies on Optimystic rejecting a stale read set is the cross-table rules no index can express:
  concurrent double-revocation (`NotLastKey`), finalize-vs-void, and pay-vs-decline.
  **Acceptance:** a two-node integration test that fires the concurrent double-revocation and
  asserts exactly one transaction commits.
- [x] **Transactor-backing rule — checked upstream, and far less exposed than this entry claimed.**
  `@serfab/quereus-plugin-sereus` takes `transactor: 'local' | 'network' | 'test'` as a **closed
  union**, all three of which commit through Optimystic's transactor stack and therefore through
  Quereus DML, so SQL constraints fire. It defaults to `'network'`, and `parseConfig` *throws* on an
  unrecognised value rather than falling back. `quereus-sync` is a separate package and is not a
  dependency of the plugin anywhere in Sereus — it is not reachable by misconfiguration, only by
  someone deliberately wiring a different stack. Residual rule, stated once: **do not.**
- [ ] **Partition behavior for time-sensitive actions.** Optimystic is CP: a cadre in the minority
  partition cannot commit, so a party **cannot revoke a stolen key while partitioned**, widening
  the key-compromise race window by the partition duration. Understand and document the bound.
- [ ] **Per-node latch-deadlock bug** on concurrent writes to the same block (Optimystic internals):
  a local liveness bug, not an isolation-correctness hole. Track its fix upstream.

## Taleus design docs — written (this pass)

- [x] `docs/index.md` — front door / table of contents (`AGENTS.md` repointed).
- [x] `docs/trading-variables.md` — two-sets (4-per-party) model and number-line economics.
- [x] `docs/denominations.md` — UoA quantification (designator / integer sub-units / multiplier + descriptor).
- [x] `docs/tally-lifecycle.md` — negotiation state machine, contract governance, rights invariant, wedged-state taxonomy.
- [x] `docs/concurrency-model.md` — CRDT lens + the isolation finding above.
- [x] `docs/drafts/credit-terms.md` — **draft** (not settled): rich-terms roadmap (interest / amortization / vesting).

Possible future split: break `architecture.md` into topic files if it grows unwieldy (manageable as one
file for now).

## Core build — bottom-up (started)

Direct chits, tally negotiation and management. Network queries and lifts stay stubbed; the lift
module keeps its in-process suite against doubles until direct chits work on a real strand.

- [x] `packages/taleus` renamed **`taleus-core`** — platform-neutral, Node/RN/browser. "Engine" is
  now the generic notion; an app-specific layer belongs *in the app*, not in a core library.
- [x] `docs/drafts/engine-api.md` moved to `packages/taleus-app/design/notes/core-asks.md` — it was
  written from the app's side and is one app's wish-list, not a core specification.
- [x] **The schema executes.** All 33 statements of `draft1.qsql` load into Quereus in memory, with
  host scalars registered (`src/store/`). Nothing had ever run it before — the lift suite uses an
  in-memory double its own harness calls "schema-EMULATING".
- [x] `docs/timestamps.md` — the creator asserts and signs the time; what backdating buys a byzantine
  party on a direct chit, and what bounds it.
- [x] **The low-level suite is complete** — §§ 1–9 of
  [`packages/taleus-core/test/STATUS.md`](../packages/taleus-core/test/STATUS.md): substrate,
  identity and keys, formation, negotiation, credit terms, direct chits, invoices, close, reading.
  240 tests over 20 suites, every act proposed to two replicas that each re-validate it. Five schema
  defects were found and fixed along the way (see that file's § 0).
- [x] **The API surface is built and exercised.** `packages/taleus-core/API.md` + `src/api/`: one
  consumer surface that names no table, an engine over it, and an in-memory multi-party store so it
  runs today. Two parties go from invitation to close through the API alone. It surfaced a defect
  no row-level test could: a `TallyContract` could not be completed by two parties who do not share
  a key (fixed — see that package's `test/STATUS.md` § 0).
- [x] **A store over real strands.** `taleus-sereus`'s `cadreStoreProvider` founds a tally strand,
  invites, joins, seats and trades between two cadre-core nodes in Node, across a restart
  (`cadre.test.ts`). Details and what remains: `tickets/blocked/feat-engine-cadre-mode.md`.
- [ ] Migrate the row-level suite up per `test/STATUS.md` § Roadmap step 4.
- [ ] Mine `mc/mychips/test/auto` for scenarios (5,543 lines; the code does not transfer, the
  scenarios do).

## Taleus open decisions / small items

- [ ] **Rename `chipnet` → `tallyNet`** (or similar): branding sweep across docs, code (`src/lift/`,
  `src/transport/`, `/taleus/chipnet/1.0.0`), and tickets. (Noted in `docs/index.md`; sweep not yet done.)
- [ ] **Rational vs. decimal denomination multiplier** — decide whether to extend beyond `10^n` for
  non-decimal units, and if so carry the rational in the `cid:` descriptor's `canonicalUnit`. Captured in
  `docs/denominations.md`; decision open.
- [x] **Contract-governance principle** — captured in `docs/tally-lifecycle.md § Contract governance`
  (direct chits grantor-authorized anytime; lift chits per signed trading variables; good-faith timing).
- [x] **Lift-chit ↔ trading-variable conformance is agent-enforced, not schema-gated** — documented in
  `docs/trading-variables.md` (pledge is self-signed; `LiftLading` is advisory). No credit gate either
  (2026-10-16): chits and pledges are accepted when duly signed; closing gates only lift pledges, toward
  zero; a closed tally accepts nothing (`docs/architecture.md` § Ledger Operation, § Tally close).

## Apps (planned)

The engine (Nathan's work) is consumed by apps. Kyle authors these using the **appeus** format
(story-driven app authoring, as in `ser/health`, `ser/chat`).

- [x] House engine-consuming apps in `packages/taleus-app/` (appeus project root; targets land in
  `packages/taleus-app/apps/<target>/`). Supersedes the earlier "top-level `apps/` folder" plan.
- [x] Initialize the appeus format there (hosted mode: appeus owns only `design/`, `apps/`, `mock/`,
  and its rules symlinks; repo root files untouched).
- [x] Complete discovery: `packages/taleus-app/design/specs/project.md` — React Native (bare, TypeScript),
  npm, identity `org.sereus.taleus`, three data run modes, multi-language from the first slice.
- [x] Scaffold the `mobile` target and draft the tally-negotiation stories (01–04, with a stubbed story
  map covering the rest of the MyCHIPs baseline).
- [x] Each `apps/<target>/` is a standalone npm project, outside the root yarn workspaces.
- [ ] Write the remaining stories (see `packages/taleus-app/design/stories/mobile/00-story-map.md`).
- [x] **`packages/taleus-model`: the apps' shared model.** One `TaleusModel` interface with two
  implementations -- the mock (moved out of the mobile app unchanged) and the engine over taleus-core,
  with a simulated counterparty for one-device use -- and one contract suite run against both. The
  app's data layer forwards to it, so screens see no backend at all. Wiring engine mode into the app
  is next -- `feat-engine-run-modes` § Progress.
- [ ] **A CLI client (`taleus-app/apps/cli`), as sereus chat has.** A second host over the same
  model: a counterparty for phone tests, a scripted scenario suite over a relay, a debugging tool,
  and the Node host `taleus-node` will reuse. Steps: (1) the Sereus binding as its own package --
  **done**, `taleus-sereus`; (2) a Node host -- **done**, `taleus-sereus/node` (a party's
  node and slots kept in a folder; tested forming a tally between two and restarting one); (3) a `cli` appeus target -- **done**:
  stories `design/stories/cli/`, spec `design/specs/cli/commands.md`, `apps/cli` (runs as TypeScript
  on Node 24, no build); (4) scenarios -- **done** (2026-10-18): `apps/cli/scenarios/`, two parties
  driven through the CLI's commands over a loopback relay (`taleus-sereus/node` `startLocalRelay`):
  form, pay, pay past the limit, answer and decline requests, restart, close; `yarn scenarios`,
  34 s on a RAM disk (2 min on the Mac's disk); through relay.sereus.org 6 min 17 s, of which forming
  4 min 32 s (19 s through a loopback relay). With the loopback relay and added latency
  (`scripts/ws-latency.mjs`): 88 ms party-to-party round trip, 1 min 13 s (forming 37 s, acts 3-10 s);
  176 ms (about relay.sereus.org's, ping 81 ms), 2 min 9 s (forming 66 s, acts 4-18 s). Forming grows
  about linearly with the round trip: some 270 sequential round trips. Latency accounts for about a
  quarter of the public relay's 272 s forming; the rest is the public relay or the path to it, not
  measured. A loopback relay with libp2p's default connection limits (2 min, 128 KiB) fails to form
  at all (the relayed connection is limited, and the join is never answered); Sereus relays forward
  without limit (`cadre-core` `relay-server.ts`). Added for it: `close`, `decline`, `pay --answers`.
  Tools (2026-10-19): `startLocalRelay({ delayMs })` (a delaying proxy in front of the relay:
  each party's link holds every byte that long each way; `TALEUS_SCENARIO_DELAY_MS`,
  `profile-formation --local-relay <ms>`), `--count-requests` (every remote Optimystic request;
  `scripts/analyze-requests.ts` per act), `--preload`. Findings on 1.17, 44 ms each way:
  forming spends its time in the joiner's first-sync probe (14 s, latency-bound) because
  Optimystic's file storage never lists a named block (`listBlockIds` yields only top-level
  directories, and `default/app/<Table>` is stored nested), so Sereus's join backfill skips every
  collection header (offered 80 of 120 blocks); listing them (`scripts/list-nested-blocks.mjs`,
  diagnostic) cuts the probe to 1.7 s and invite-to-Open from 43.7 s to 23.7 s. Memory storage
  lists them, so Sereus's memory-backed tests do not see it. Also: Optimystic's under-replication
  drain re-pushes blocks the backfill just delivered, one block per request (36 of 64). A payment
  costs 24 cluster requests (Ledger's indexes each a collection), about 7 round trips. Filed the
  listing bug as Optimystic#41.
  A payment, per collection (2026-10-19, 44 ms each way): each of the Ledger's 6 collections (the
  table and its 5 indexes) runs its own pend and commit, 2 requests each, all to the other member:
  24 requests, concurrent, so the payment takes ~1.7 s (about 7 round trips) either way. Without
  `LedgerByDate` (reporting only) it is 20 requests and the same 1.7 s: an index costs traffic, not
  time. Partial unique indexes (`where InvoiceId is not null`) pass every core test but save nothing:
  Optimystic's module still runs consensus on a partial index's collection for a row its predicate
  excludes. Filed as Optimystic#42 (with the per-index series 4, 8, ... 24). Schema left as it was. One run
  of three back-to-back payments (not reproduced since) made 96 `cancel` requests and re-sent
  commits on the third (7.5 s) -- watch for it.
  Waiting for the offer after accepting: 9.2 s -> 3.0 s with #41's listing fixed, so it was mostly
  the joiner fetching table headers, not Taleus's agent timing.
  First CLI-vs-CLI run over relay.sereus.org (2026-10-13):
  invite 18 s, accept 32 s, the offer within 90 s, open about 90 s after accepting it, a payment
  recorded -- far faster than the phones. A party alone cannot list its tallies (a never-written
  table, #47). Profiling (`apps/cli/scripts/`, 2026-10-13), loopback: invite 15.5 s, accept
  45.4 s, a payment 7.6 s -- about 80% of it fsync in Optimystic's file storage (one payment: 108
  file writes, 216 fsyncs); on a RAM disk 3.3 s / 7.8 s / 0.4 s. That is a macOS cost: there an
  fsync'd file write takes ~40 ms; on Linux ext4 (saturn) 1.9 ms, and a three-row commit 66-168 ms
  against 22-50 ms in memory. So profile on Linux or a RAM disk. Filed as an enhancement, with
  Sereus Chat's matching findings and the platform durability question: gotchoices/Optimystic#37.
  Phone-shaped profiling (`--busy 0.7 --latency 20:serial`, 2026-10-14): a busy CPU alone does the same
  work slower; with the frame cap the stack thrashes (fixed deadlines fire, retries and re-asked reads
  pile onto the slow link). Node repro drafted for sereus (`strand-workload-on-a-phone-link`: ops fail
  and sides diverge while both are up). Taleus side: the model now returns `store-unavailable`
  (retryable) instead of throwing (`engine/unavailable.ts`); a tally's view reads its tables
  concurrently (`TallyEngine.read`).
  Phone-vs-CLI on Optimystic 1.14 (S7 dev build vs CLI over relay.sereus.org, 2026-10-14): invite
  31 s (was 42), accept 337 s (was 195), and the phone never offered in 20 min. The app sat at
  150-190% CPU with ~1 GB resident (770 MB native heap) and the phone swapped; its tally list never
  answered. With the CLI gone it dropped to ~47% CPU, memory unchanged. The same flow on two Node
  parties under the phone arm (`profile-formation --memory`) keeps heap at 80-160 MB, flat -- so the
  growth is the phone's (Hermes, RN or the dev build), not the stack's. Next: a Hermes heap snapshot
  during formation, or a release build.
  Optimystic 1.13 vs 1.14 on #48's phone arm (two runs each): seated ~100 s either way; 1.13 failed
  its first round (156-224 s), then the strand nodes disconnected and later rounds ran locally;
  1.14 kept the link longer and failed more rounds (250 s / 586 s, cohort-silent 47 / 97). Not fixed
  by 1.14; no clear regression either.
  The `InvitationSignatureValid` refusal (seen once, under the phone arm): a CHECK whose subquery
  reads an unreachable block fails as `BlockUnavailableError`, retryable, not as a violation (repro
  `strand-check-on-unavailable-read`, passes). What remains is a stale read: the invitee's `Foil`
  CHECK finding no `Stock` row after first sync. Not reproduced: `strand-joiner-reads-when-writable`
  (the same shape, 3 loopback and 3 phone-arm runs) sees the row and passes every time. Dropped.
  #47's offline failure now passes on loopback (9 of 9 runs; the founder answers locally) and still
  fails on the 100 ms link; its scenario's loopback `it.fails` needs that link.
  Screens read one at a time (2026-10-14): `useLoad` had started a new read on every commit
  notification, even with one in flight, so on a slow phone reads piled up (a test saw 5 at once);
  now asks during a read become one read after it. The mobile tests had been failing since Mode C
  was switched on (170 of 213 read "model not started"); tests now always run Mode A.
  Release build on the S7 (Hermes bytecode, arm64, the `useLoad` fix), accepting a CLI party's
  invitation over relay.sereus.org: onboarding 70 s, the review screen up at once, accept 533 s;
  the terms screen never finished loading in 27 min. CPU 140-220% throughout; memory 260 MB idle,
  then climbing about 9 MB a minute to 498 MB (the dev build had reached ~1 GB). Node parties doing
  the same work stay flat. Maestro flows and the driver for this run are not kept in the repo yet.
  No leak, on a closer look (dev build with the `useLoad` fix, Hermes heap snapshots and stats over
  Metro's inspector, 25 min of formation): the JS heap stays 20-50 MB live; Android's native heap
  rose 521 -> 615 MB under load and fell back to 520-545 MB. The earlier ~1 GB was before the fix
  (reads piling up); the release run's climb was `top`'s resident size, which counts mapped bytecode
  and library pages as they are touched. CPU is the problem: a 60 s profile of the stuck phone is
  transport and peer bookkeeping, not app code -- young GC 8%, base58 multiaddr / peer-id string
  conversions ~10% plus peer-store `localeCompare` 6%, base64 for every WebSocket frame ~3%, a
  native cipher object per frame ~5% (as Sereus Chat found; sereus#45). FRET 1.1.0 targets the
  peer-list churn.
  **Phone-CLI works on Optimystic 1.15 / FRET 1.1 (2026-10-14, S7 dev build, relay.sereus.org):**
  the phone invited (30 s), the CLI accepted (2 min 47 s), the phone's offer reached the CLI 3 min
  later, Open at once; the CLI paid $1 and the phone showed it. The first tally ever formed with a
  phone in it. Still slow: listing the one tally took 208-272 s, and the phone runs at 170-190% CPU
  while the open tally is idle (about 40% once the CLI leaves; the CLI's poll is not the cause).
  Native memory rose 515 -> 720 MB over 23 min in this run (the run before fell back once) --
  unresolved. The CLI under the phone arm still collapses on 1.15 (#48). Where the CPU goes, in
  Node (`--count-peerstore`, `--poll 0`, `--idle`): (1) Optimystic's `findCluster` reads the libp2p
  peer store for every candidate on every call (`getPeerStore*ByPeer`, no cache) -- 1,100-2,700
  loads per party in a 20 s loopback formation -- and libp2p merges into the peer store on every
  stream opened or accepted (~1,200-3,000 per party; Optimystic opens a stream per request); on a
  phone each load re-parses every multiaddr and each merge re-sorts protocols and multiaddrs by
  string, ~15% of the S7's CPU. (2) An idle party polls its own control database -- Sereus's strand
  watcher every 5 s and a heavier pass every 30 s -- each read through Optimystic's full coordinator,
  cluster and read-repair path though the cadre has one node: ~225 reads a minute, idle. Filed:
  Optimystic#40 and sereus#50.
- [ ] **Run a cadre node for Taleus.** Not done: being prepared in a separate effort. The phone
  app's Mode C (below) runs a phone node through `@serfab/cadre-rn`; an always-on cadre node serving
  a party's tallies (and `taleus-node`, `feat-taleus-node-service`) is the part still to come.

(The `feat-taleus-app-shell` ticket has been retired — the app is scaffolded and now evolves through
the appeus design/generation cycle. Toolchain decisions live in `design/specs/project.md`.)

## Mode C: the phone app over a real cadre (`feat-engine-cadre-mode`)

Runs on an emulator and a Galaxy S7 against the public relay (`relay.sereus.org`): onboarding,
invitation, acceptance and trading work, but slowly. Measured on Sereus 1.12 / Optimystic 1.10.1:
invite 29 s (S7) to 71 s (emulator); accept 256 s (join about 3 min, seating 44 s); reads 9–70 s or
more, and the tally list times out. The dev bridge (`apps/mobile/scripts/dev-drive.mjs`) drives it
without the UI.

- [x] **Upgraded to Sereus 1.14 / Optimystic 1.12.1 / Quereus 4.20.2 / FRET 1.0.2** (2026-10-08); core
  301 and model 35 tests pass; the phone runs `strandReactivity` again. A device's control store from
  1.12 does not open under 1.14 (Sereus's documented no-migration policy: the party is recreated).
- [ ] **Re-measured on 1.14 (emulator accepts the S7's invitation): still failing.** Invite 28 s on
  the S7. Accept: the first strand start failed after 173 s (`optimystic/schema` unavailable,
  `claimed-elsewhere`), the automatic retry started it in 24 s; a second accept waited 245 s for the
  first sync; a third got the strand writable and then failed after 235 s reading
  `PartyKeyRevocation` (`cohort-unreachable`), with the two strand nodes connected through the relay.
  Meanwhile the S7's agent runs a step every 10 s (the backstop poll) costing about 2.7 s each.
- [ ] **Second run (backstop poll at 120 s, both parties fresh, 2026-10-09): the accept completes the
  join but seating never lands** — strand first sync 222 s, then reads of 168–226 s, then the
  three-row seating transaction 300 s; both sides still show the tally Forming. An S7 CPU profile
  over the first sync: busy 168 of 240 s, almost all in the network stack (libp2p streams, Noise,
  WebSockets, yamux, circuit relay, peer-store; cadre-rn's Noise crypto 27 s, a third of it creating
  a quick-crypto cipher object per frame; peer-store address sorting with `localeCompare` 8 s);
  Quereus and Taleus code barely register. After seating, the emulator issued 149 slow reads in a
  minute, mostly repeats (`TallyCore` 30 times).
- [x] **Shared reads** (`taleus-core` `SharedReadStore`, 2026-10-09): one store per tally in the engine;
  identical reads in flight or answered since the tally last changed share one query (held at most
  5 s); a write or any change heard drops them.
- [ ] **Third run (shared reads, gate log on): the accept completed, 540 s** — strand database
  initialize 135 s; the first-sync probe 155 s, failing at `App.CloseRequest` (a table nobody had
  written: `cohort-unreachable`, "could not determine whether it exists"); re-probes 51 s; the
  three-row seating transaction 128 s. **Then the inviter never saw the seat:** 28 minutes later,
  and after a restart, the S7 answered `select Sid from App.Foil` empty in 87 ms, so its agent
  could not establish the tally. Not yet confirmed what the joiner holds (the emulator stopped
  loading its bundle under host load). Candidate upstream issues: a joiner's rows in a table the
  founder never wrote stay invisible to the founder; and the first-sync gate reads the App tables
  one by one and restarts from the first on any failure (`strand-first-sync-gate.ts`
  `appTablesReadable`), so its cost grows with the table count and the slowest peer.
- [ ] **Reproduced in Node, filed as gotchoices/sereus#44:** a joiner's strand node holding only the
  relay connection when its strand becomes writable commits with a cohort of itself
  (`commit:solo-cohort`, `quorum: 'local'`), reports success, and the rows are lost if it stops.
  Sereus scenario `joiner-first-commit-over-slow-relay` (branch
  `test/joiner-first-commit-over-slow-relay`, worktree `ser/sereus-wt-repro`), 3 of 3 runs on a
  20 ms serial frame cap with a 70%-busy event loop; loopback and 100 ms pass.
- [ ] **Upstream, once Taleus's own volume is cut:** phone transport cost (per-frame cipher objects in
  `@serfab/cadre-rn/noise-crypto`, libp2p peer-store churn), with the S7 profile as evidence.
- [ ] **Held, pending the re-measure:** a joiner's first write failing to get a super-majority
  (retried today); a restarted joiner not syncing (seen with a local relay only); an untraced
  uncaught "Database is closed".
- [ ] An acceptance that outlives `joinPatienceMs`; reads failing while the counterparty is offline;
  half-committed seating; a signed tally sApp; verify on two phones (all in the ticket).
- [ ] **Clean-up:** `probe-*.tmp.mjs` at the root and `profile.tmp.cjs` in the app.
  (`USE_ENGINE`/`USE_CADRE` stay true: Mode C is the app's normal run; mocks only for a temporary need.)

## Contracts (Stroc)

sereus.org publishes the tally contracts from [`contracts/`](../contracts/) as Stroc documents into
its shared catalog (`https://sereus.org/.well-known/stroc/catalog.json`): two offerable agreements,
**Taleus Tally Agreement (Courts)** and **(Arbitration)**, a non-binding **Testing** agreement, and
the clauses they include. A tally signs only its contract's CID. The documents travel **in the
strand**: a `Document` table, insert-only, keyed by CID, which whoever holds a document fills if it
is missing -- so the partner "asks" for a contract by reading the table, and no Sereus protocol is
needed. A tally whose contract cannot be read in full is a reason to decline it.

- [x] Documents drafted, published, served by sereus.org; `@stroc/cli` installed (`yarn stroc`).
- [x] **Stroc collections** (Stroc 0.3, catalog 1.1): `contracts/.stroc.yaml` lists the Courts and
  Arbitration agreements in `tally-contracts`; the model offers each source's current entries of it.
- [x] **Published** the catalog with collections (catalog 1.1, 2026-10-10): the S7 lists Courts and
  Arbitration from sereus.org.
- [ ] **Upstream: `cid()` names dag-json** (gotchoices/Optimystic#33, open): the crypto plugin's
  `cid()` already builds CIDv1s and lacked only Stroc's codec. Once released, `Document`'s interim
  `CidFormat` becomes `check (Cid = cid(Json, 'dag-json'))`. Until then every reader verifies.
- [x] **Schema:** `Document(Cid, Json)` (insert-only, network-watched, interim CID-format check);
  `TallyContractProposal.ContractStored` requires the offered contract in `Document`. Core: offers
  carry `documents` (stored `insert or ignore`), `Tally.document(cid)` reads one back.
- [ ] **Schema, later:** the hash check above.
- [x] **Engine and model** (`taleus-model/contracts`, tested in Node, including the two-node strand
  test where the invitee reads the contract from the tally):
  - a per-device list of document sources, seeded with sereus.org; a source is added when the user
    imports a contract from it, without being asked to think about "publishers";
  - the offerable agreements = current `author` entries of the Taleus kind across those sources;
  - a per-device document store (LevelDB on the phone) as a cache;
  - an offer writes its contract and every document it includes into `Document`;
  - `readAgreement(cid)` reads the strand, then the cache, then the sources, verifying each copy;
  - the agent declines an offer whose contract cannot be read in full;
  - `STANDARD_AGREEMENT` removed. No mock-mode work for now.
  - NOTE: "declines" is the agent not accepting -- the core has no refusal act yet
    (`feat-offer-lifecycle`).
- [x] **Phone spike** (S7, 2026-10-10): listing sereus.org's agreements 27 s cold, 9 s warm; composing
  the Courts agreement (11 sections) 4 s from the device cache. Stroc runs in the app as is.
- [x] **Native rendering and the contract screens** (2026-10-11): `Agreement` (numbered sections from
  Stroc's composition, included documents marked, unreadable stated) and `TrustedPublishers`;
  `PublisherNote` on every agreement shown; contracts through `CreateInvitation` (trusted
  publishers' agreements, import by link), `ReviewInvitation` (trust asked on accepting, unreadable
  blocks accepting), `ReviewOffer`, `TallyTerms`, `Settings`. Model: trusted publishers (sereus.org
  fixed) and agreements trusted alone, each agreement's standing from publishers' catalogs, the
  invitation's `agreementSource` hint so an invitee can read the agreement before joining. Checked on
  the S7; app tests 200 pass in mock mode.
- [x] **Import by link** (model, `importAgreement`; S7 3 s, author confirmed): a
  `https://<host>/ipfs/<cid>` link is fetched with its includes, verified, its author checked, kept,
  and offered from then on; the host joins the device's sources. The QR scanner itself is a screen.
- [x] **Design surface** (2026-10-11): stories 01, 02, 07 revised and 08 "Publishers I trust" added
  (awaiting review in `stories/mobile/STATUS.md`); `Agreement` and `TrustedPublishers` in the
  navigation and screen plan; the agreement asks and trust model in `specs/domain/interfaces.md`.

## Negotiation gaps (app design pass, `packages/taleus-app`)

Filed as tickets from the app design pass:

- `feat-offer-lifecycle` — offer history, expiry, simultaneous acceptance, and whether refusal is
  recorded at all (`TallyContractProposal` is a single mutable row today, with no expiry).
- `feat-formation-lifecycle` — what an invitation nobody accepts leaves behind.
- `feat-standing-invitation` — a vendor's reusable invitation; Sereus records one use per invite today.
- `feat-engine-tally-api` — the app-facing surface for the whole tally lifecycle. Re-scoped by the
  bottom-up build: `taleus-core` grows the tally surface from the schema up, and reconciliation with
  what any one app wants comes after, not before.
- `feat-engine-run-modes`, `feat-attention-signals`, `feat-position-and-estimates`,
  `feat-disclosure-selection`, `feat-device-and-recovery-surface` — the rest of what the drafted
  stories need.

## Tickets spawned from the MyCHIPs-comparison analysis

- `tickets/backlog/feat-schema-rich-credit-terms.md` — **regression fix (committed):** restore interest /
  amortization / grace / minimum-payment / prepayment / maturity-vesting; design space in
  `docs/drafts/credit-terms.md`.
- `tickets/backlog/feat-schema-tally-state.md` — **regression fix:** materialize forming/offer/open/void
  negotiation state (MyCHIPs' signing dance), left only implicit in the reboot.
- `tickets/backlog/debt-tally-close-no-reopen.md` — terminal close / no reversal of a mistaken final payment.
- `tickets/backlog/feat-lift-healing.md` — repair a half-broken lift (partition / refuser / silent referee). **Speculative** — needs a dedicated design pass before implementation.
- Existing, re-scoped by this analysis: `feat-lift-timeout-release.md` (stuck pending lift),
  `feat-multi-referee-consensus.md` (single-referee third-party value-loss).
