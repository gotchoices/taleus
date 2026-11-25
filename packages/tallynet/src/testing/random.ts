/**
 * The seeded PRNG: the simulator's / test harness's implementation of the {@link RandomSource} port
 * (`crypto.ts` ships the interface and the Web Crypto default). It produces `randomBytes(n)`
 * reproducibly from a seed, so a run on the {@link VirtualClock} with a fixed seed replays exactly --
 * session codes, graph generation, every draw. **Not** cryptographically strong: for simulation and
 * tests only, never production randomness.
 *
 * The generator is **mulberry32**: tiny, good statistical quality, and built from `Math.imul` and
 * bit ops only -- no `Math.random`, which the platform-neutral rule (`no-node-globals.test.ts`)
 * forbids everywhere. It ships behind the `tallynet/testing` subpath export.
 */

import type { RandomSource } from '../crypto.js'

/** A non-zero fallback seed (mulberry32 degenerates from an all-zero state). */
const NONZERO_SEED = 0x9e3779b9

export class SeededRandom implements RandomSource {
	private state: number

	constructor(seed: number) {
		// Avoid a zero initial state; otherwise the first words are degenerate.
		this.state = (seed === 0 ? NONZERO_SEED : seed) >>> 0
	}

	/** One mulberry32 step: a fresh 32-bit unsigned word. Deterministic for a given seed/sequence. */
	private nextUint32(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0
		let t = this.state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return (t ^ (t >>> 14)) >>> 0
	}

	/** Fill a `Uint8Array` of `length` bytes, consuming 32-bit words four bytes at a time. */
	randomBytes(length: number): Uint8Array {
		if (!Number.isInteger(length) || length < 0) {
			throw new Error(`randomBytes: length must be a non-negative integer, got ${String(length)}`)
		}
		const out = new Uint8Array(length)
		let word = 0
		let remaining = 0
		for (let i = 0; i < length; i++) {
			if (remaining === 0) {
				word = this.nextUint32()
				remaining = 4
			}
			out[i] = word & 0xff
			word >>>= 8
			remaining--
		}
		return out
	}

	/** A float in [0, 1). */
	nextFloat(): number {
		return this.nextUint32() / 2 ** 32
	}

	/** An integer in [0, `maxExclusive`). */
	nextInt(maxExclusive: number): number {
		if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
			throw new Error(`nextInt: maxExclusive must be a positive integer, got ${String(maxExclusive)}`)
		}
		return Math.floor(this.nextFloat() * maxExclusive)
	}
}
