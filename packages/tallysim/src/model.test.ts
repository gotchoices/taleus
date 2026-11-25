import { FORMAT_VERSION, type Network, deserialize, serialize } from './model.js'

function networkWith(tallies: Network['tallies'], entityCount: number): Network {
	return {
		entityCount,
		tallies,
		meta: { generator: 'test', params: { entityCount }, seed: 7, formatVersion: FORMAT_VERSION },
	}
}

describe('serialize / deserialize', () => {
	it('round-trips a finite network byte-for-byte through deserialize', () => {
		const net = networkWith(
			[
				{ stock: 0, foil: 1, balance: 3, stockCreditLimit: 10, foilCreditLimit: 5 },
				{ stock: 2, foil: 0, balance: -4, stockCreditLimit: 20, foilCreditLimit: 8 },
			],
			3,
		)
		const restored = deserialize(serialize(net))
		expect(restored).toEqual(net)
	})

	it('preserves Infinity credit limits (unlimited) across the round-trip', () => {
		const net = networkWith(
			[{ stock: 0, foil: 1, balance: 0, stockCreditLimit: Infinity, foilCreditLimit: Infinity }],
			2,
		)
		const json = serialize(net)
		// Infinity is stored as the JSON null sentinel, not the string "Infinity" or a dropped field.
		expect(json).toContain('"stockCreditLimit":null')
		expect(json).toContain('"foilCreditLimit":null')
		const restored = deserialize(json)
		expect(restored.tallies[0].stockCreditLimit).toBe(Infinity)
		expect(restored.tallies[0].foilCreditLimit).toBe(Infinity)
		expect(restored).toEqual(net)
	})

	it('round-trips a one-sided Infinity limit', () => {
		const net = networkWith(
			[{ stock: 0, foil: 1, balance: 2, stockCreditLimit: Infinity, foilCreditLimit: 5 }],
			2,
		)
		const restored = deserialize(serialize(net))
		expect(restored.tallies[0].stockCreditLimit).toBe(Infinity)
		expect(restored.tallies[0].foilCreditLimit).toBe(5)
	})

	it('round-trips an empty network (no tallies)', () => {
		const net = networkWith([], 0)
		const restored = deserialize(serialize(net))
		expect(restored).toEqual(net)
		expect(restored.tallies).toEqual([])
	})

	it('is deterministic — the same network serialises to the same string', () => {
		const net = networkWith(
			[{ stock: 1, foil: 0, balance: 1, stockCreditLimit: 9, foilCreditLimit: 9 }],
			2,
		)
		expect(serialize(net)).toEqual(serialize(net))
	})

	it('rejects an unsupported format version', () => {
		const net = networkWith([], 0)
		const bumped = JSON.parse(serialize(net)) as { meta: { formatVersion: number } }
		bumped.meta.formatVersion = FORMAT_VERSION + 1
		expect(() => deserialize(JSON.stringify(bumped))).toThrow(/formatVersion/)
	})
})
