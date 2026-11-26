description: The test/simulator fake clock silently throws away a timer when a timer's callback waits on real async work (a network or disk round-trip, say) before scheduling that next timer. Nothing does this today, so nothing breaks now — but the moment a future piece of code does, a result goes quietly wrong with no error, which is the very failure this clock was just hardened against.
prereq:
files: packages/tallynet/src/testing/clock.ts, packages/tallynet/src/testing/clock.test.ts
difficulty: hard
----

## Background: what the clock does

`VirtualClock` (`packages/tallynet/src/testing/clock.ts`) is the fake clock the tally-network
simulator and tests run on. Virtual time only moves when a timer fires. Between firing one timer and
the next, the clock **drains** — it waits for the async fallout of the fire (a neighbour's `query`, a
pushed record's `update`) to finish scheduling its own timers, so virtual time advances in the right
order.

A recent change (ticket `debt-tallynet-virtual-clock-drain`, now in `tickets/complete/`) rewrote that
drain. The old drain counted idle "microtask hops" and guessed a threshold; a chain of async work
longer than the guess slipped past it and a timer got silently dropped. The new drain instead turns
the event loop **one macrotask at a time** — because the JavaScript event loop fully empties its
microtask queue before each macrotask, a single macrotask hop flushes a microtask chain of *any*
length. That removed the guess and fixed the microtask-chain case completely.

## The gap this ticket is about

The new drain's guarantee — "one macrotask flushes everything" — is true **only for microtasks**. It
does **not** cover a timer callback that itself waits on a *different* real macrotask source (another
`MessageChannel`, `setImmediate`, a real timer, genuine network/disk I/O) before it schedules its next
timer.

The clock schedules its own drain hops on its own `MessageChannel`. When a callback awaits a separate
macrotask, that foreign macrotask is **not** interleaved with the clock's drain hops the way microtasks
are: the clock's channel reaches quiescence (two consecutive idle hops) while the callback's macrotask
is still sitting unserviced in the event loop. The clock declares itself idle, the fire loop exits, and
the timer the callback was about to schedule is orphaned — it lands in the heap *after* the run already
returned and never fires. **No error.** This is the exact silent-wrong-result failure mode the drain
rewrite set out to eliminate, reached through a different door.

The rewrite also added a "loud overrun guard" (`assertDrained`) meant to turn any such silent drop into
a thrown error. It does **not** catch this case: it does a single extra macrotask hop, which has the
same blind spot — the foreign macrotask still hasn't delivered by then.

### Reproduction (standalone, run against the built clock)

```js
import { VirtualClock } from './packages/tallynet/dist/testing/clock.js'

const macrotaskHop = () => new Promise((resolve) => {
	const ch = new MessageChannel()
	ch.port1.onmessage = () => { ch.port1.close(); ch.port2.close(); resolve() }
	ch.port2.postMessage(null)
})

const clock = new VirtualClock()
const fired = []
clock.setTimer(() => {
	fired.push('first')
	// schedule the NEXT timer only after a real macrotask hop
	void macrotaskHop().then(() => { clock.setTimer(() => fired.push('second'), 5) })
}, 10)

await clock.runUntilIdle()
console.log(fired, clock.pendingTimers)      // ['first'] 0   <- 'second' dropped, no throw
await macrotaskHop(); await macrotaskHop()
console.log(fired, clock.pendingTimers)      // ['first'] 1   <- it was scheduled, too late, orphaned
```

Replace `await Promise.resolve()` (a microtask) with `await macrotaskHop()` and the drain that handles
the microtask case flawlessly drops the timer. There is a matching `NOTE:` comment in
`src/testing/clock.test.ts` at the end of the `long-continuation-chain drain` describe block.

## Why it is dormant (not an active bug)

No timer callback in the codebase today crosses a real macrotask boundary before scheduling a timer:

- consensus `update` is pure microtasks plus synchronous ed25519 crypto,
- discovery timer callbacks return `void` (synchronous),
- the network harness's delivery/query callbacks route through `.then(...)` (microtasks).

So the sim and all three test suites are green and correct. The hazard is **future**: the clock's
callback contract is `() => void | Promise<void>`, which permits an async callback that awaits anything.
The project is heading toward Sereus/Optimystic-backed stores that may do genuine async I/O. The day a
store does real-macrotask I/O behind a consensus `update` or a discovery step, that subsystem's results
go silently wrong — the simulator would under-report reach or stall an echo with no failing test. Hence
`debt-`, not `bug-`: real latent defect, currently unreachable.

## What a fix needs to decide (not prescriptive — for the planner)

The drain rewrite deliberately **deleted** the old async-callback promise-tracking (a `pending` counter
that `fire` bumped while a callback's returned promise was unsettled). That tracking *would* have
covered a macrotask-awaiting callback — but only one that **returns** its promise, and the old class doc
records that naively awaiting every callback promise in the drain **deadlocks discovery** (a discovery
`query` awaits a nested budget step whose timer only fires in the outer loop, never during a drain, so a
drain blocked on that promise spins to `MAX_DRAIN`). That tension is why the planner's call is non-trivial.
Candidate directions, to weigh rather than implement blindly:

- **Narrow the contract and guard it loudly.** Declare that virtual-clock timer callbacks must settle
  within microtasks (no real-macrotask awaits), document it, and make the loud guard actually catch a
  violation — e.g. have the clock detect that it went idle while an async callback it fired is still
  pending. This keeps the fast, simple macrotask drain and fails loudly instead of silently when the
  contract is broken, without trying to *support* macrotask-crossing callbacks. Likely the smallest,
  safest option; it turns a silent wrong answer into a thrown error.
- **Re-admit bounded promise-tracking for async callbacks that return their promise**, combined with the
  macrotask drain, structured to avoid the discovery deadlock (e.g. only the consensus `update` path
  opts into tracking; discovery callbacks stay void). More capable, more complex, and still can't catch
  a callback that doesn't return its promise.

Land the reproduction above as a regression test (the `it('fires a timer scheduled after a real
macrotask hop …')` case that was prototyped during review and pulled back out so the suite stayed green).
