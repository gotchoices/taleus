description: Run the Taleus app over a real Sereus cadre — each tally its own Optimystic-backed strand, persisted on the device and shared with a real counterparty by invitation — waiting on the phone-node bring-up moving into Sereus's React Native kit so Taleus need not copy it.
prereq: feat-engine-run-modes
files: packages/taleus-model/src/engine/, packages/taleus-app/apps/mobile/src/data/config.ts, packages/taleus-app/apps/mobile/src/data/engine.ts, packages/taleus-core/src/api/types.ts
difficulty: hard
----

## Why blocked

Mode C needs an embedded cadre node on the phone: identity in the secure store, durable node-local
stores, start/stop, background/foreground handling. Today every Sereus phone app carries its own copy
of that bring-up (the reference app, sereus-chat, health), and the copies have drifted — chat's and
health's miss parts of cadre-core's host contract (identity in plaintext, node-local stores left in
memory, no AppState handling, un-awaited async calls). Sereus's own
`tickets/backlog/feat-rn-kit-secure-key-store.md` says the bring-up moves into `@serfab/cadre-rn`
once a second app needs it. Rather than make a fourth copy, Taleus waits for that to land.

**Unblocks when:** `@serfab/cadre-rn` publishes the key-store, node and lifecycle subpaths, or Taleus
links a local sereus checkout that carries them. Status (2026-10-03): key store merged
(gotchoices/sereus#29); phone node (#30) and lifecycle (#31) open. Only the on-device bring-up waits
on these: the store provider below needs only `@serfab/cadre-core`, published at 1.11.

**Done meanwhile:** the tally schema now calls only Quereus built-ins and the stack's crypto. Every
node holding a replica re-validates every write, and an always-on cadre machine runs no Taleus
code, so the six Taleus-registered scalars (`DayNumber`, `ValidDate`, `ValidDenomination`, `Today`,
`Greatest`, `Least`) would have left such a node unable to accept a tally's rows. Dates compare as
`YYYY-MM-DD` text; the notice period adds a `timespan`.

## Done (Node, against cadre-core 1.11)

- **`cadreStoreProvider`** (`taleus-model/cadre`): `create` founds a closed strand and publishes a
  single-use invitation, carried as `TallyRef.address`; `join` redeems it (`formStrand`) and attaches
  the strand, treating a slow first sync as progress; writes go through `exec(…, { transaction: true })`
  via `taleus-core/host`'s `transactionBatch`, which the in-memory store now uses too.
- **Replicated commits wake `subscribe`**: `cadre.test.ts` opens a tally between two nodes and moves
  an entry with the backstop poll off.
- **`requestJoin`** replaces `formStrand`: the party keeps asking, from any owner machine, until the
  inviter's side answers; `join` waits up to `joinPatienceMs` (120 s).
- **Restart**: every strand arrives as `strand:discovered` and is attached once; the test restarts
  the invitee's node over the same device state and the tally comes back, still trading.
- **Device-local state and identity persist** through `SessionStorage` (`state`, `identity` slots),
  tested across a restart.
- **Network-watch tags** on every tally table, for nodes running `strandReactivity`.

## Remaining

- **Mode C in the app** (needs `@serfab/cadre-rn` with `/phone-node` and `/lifecycle`, merged to
  sereus master, not yet released): `createPhoneNode` with a `react-native-keychain` adapter for the
  secure store, the lifecycle runner, the tally sApp under `configure` (unsigned for now:
  `requireSignedSchemas: false`), `cadreStoreProvider` behind `config.ts`'s `USE_CADRE`, and
  `SessionStorage` over the app's storage (identity slot in the keychain).
- **An acceptance that outlives `joinPatienceMs`.** When the inviter's side has not answered in time,
  `join` fails; the party keeps asking and the strand is attached when it arrives, but the engine's
  seating never ran. The model should keep the accepted invitation and take the seat when the strand
  appears.
- **Reads while the counterparty is offline** can fail (`BlockUnavailableError … cohort-unreachable`),
  seen in the restart test while the invitee was down; the agent logs and carries on, but a screen
  reading then would show an error. Related upstream: gotchoices/Optimystic#25.
- **Reactivity on the phone node**: `strandReactivity: { enabled: true }` once Optimystic's
  registration-burst issue is fixed (sereus docs/strands.md); the backstop poll stays until then.
- **Partial commits.** A seating act spans several tables, each its own Optimystic collection, so it can
  half-commit (`CoordinatorPartialCommitError`). The engine's read-before-write recovery covers a retry;
  whether the engine should detect and finish a half-committed seating is open.
- **A signed tally sApp** (`signSchema` with a Taleus author key, the signature shipped with the app),
  so nodes need not relax schema signing.
- **Verify** with two emulators, then two phones.
