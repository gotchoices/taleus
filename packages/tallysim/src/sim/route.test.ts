import { makeNonce, type Plan } from 'tallynet'
import { FORMAT_VERSION, type Network, type Tally } from '../model.js'
import { linkIdForTally } from './naming.js'
import { reconstructRoute } from './route.js'
import type { LiftTerms } from './terms.js'

const SESSION = 'session-code-1'

/** A line `0 - 1 - … - (n-1)`, one tally per consecutive pair (`stock = i`, `foil = i+1`). */
function line(n: number): Network {
	const tallies: Tally[] = []
	for (let i = 0; i + 1 < n; i++) {
		tallies.push({ stock: i, foil: i + 1, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 })
	}
	return { entityCount: n, tallies, meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION } }
}

/** A plan whose path is the given tally indices' nonces for {@link SESSION}, as discovery would carry them. */
function planOverTallies(tallyIndices: number[]): Plan<LiftTerms, unknown> {
	return {
		path: tallyIndices.map((i) => ({ nonce: makeNonce(SESSION, linkIdForTally(i)), intents: {} })),
		members: [],
	}
}

describe('reconstructRoute', () => {
	it('walks a line plan back to its exact tally path and entity route', () => {
		const net = line(4)
		const { tallyPath, route } = reconstructRoute(net, SESSION, 0, planOverTallies([0, 1, 2]))
		expect(tallyPath).toEqual([0, 1, 2])
		expect(route).toEqual([0, 1, 2, 3]) // [from, …, to]
	})

	it('an empty path yields just the originator (no hops)', () => {
		const net = line(3)
		expect(reconstructRoute(net, SESSION, 1, planOverTallies([])).route).toEqual([1])
	})

	it('reconstructs a circular route (originator at both ends)', () => {
		// Triangle 0-1-2 with a back edge 2-0 as tally 2; a lift 0 → 1 → 2 → 0.
		const net: Network = {
			entityCount: 3,
			tallies: [
				{ stock: 0, foil: 1, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
				{ stock: 1, foil: 2, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
				{ stock: 2, foil: 0, balance: 0, stockCreditLimit: 1000, foilCreditLimit: 1000 },
			],
			meta: { generator: 'test', params: {}, seed: 0, formatVersion: FORMAT_VERSION },
		}
		const { tallyPath, route } = reconstructRoute(net, SESSION, 0, planOverTallies([0, 1, 2]))
		expect(tallyPath).toEqual([0, 1, 2])
		expect(route).toEqual([0, 1, 2, 0]) // route[0] === route[last]
	})

	it('throws on a nonce that resolves to no tally (the sim built this network — a bug, not a sentinel)', () => {
		const net = line(3)
		const bogus: Plan<LiftTerms, unknown> = { path: [{ nonce: 'not-a-real-nonce', intents: {} }], members: [] }
		expect(() => reconstructRoute(net, SESSION, 0, bogus)).toThrow(/resolves to no tally/)
	})

	it('throws on a non-contiguous walk (a tally not incident to the current entity)', () => {
		// Starting at 0 but the first tally is 1 (stock 1, foil 2): 0 touches neither endpoint.
		const net = line(3)
		expect(() => reconstructRoute(net, SESSION, 0, planOverTallies([1]))).toThrow(/non-contiguous/)
	})
})
