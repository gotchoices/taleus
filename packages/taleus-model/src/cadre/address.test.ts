import { decodeStrandAddress, encodeStrandAddress } from './address.js'

const RELAY = '12D3KooWMD7E7UH4rkCqiFE69n7FNqrKo1Xx3yDUU8JvwtaH39bD'
const PEER = '12D3KooWC7CmKpkS9G27gqBj6gift96houptq8aCGRaiJ1H6NFfh'
const OVER_WS = `/dns4/relay.sereus.org/tcp/4011/ws/p2p/${RELAY}/p2p-circuit/p2p/${PEER}`
const OVER_TCP = `/dns4/relay.sereus.org/tcp/4001/p2p/${RELAY}/p2p-circuit/p2p/${PEER}`

const invitation = (bootstrap: string[]) => ({
	token: 'invite-1',
	sAppId: 'taleus-tally',
	expiration: new Date('2026-11-09T03:22:45.434Z'),
	bootstrap,
})

describe("a strand's invitation inside a Taleus invitation", () => {
	it('carries only the addresses a phone can dial, and round-trips', () => {
		const text = encodeStrandAddress(invitation([OVER_WS, OVER_TCP]))
		expect(decodeStrandAddress(text, 'taleus-tally')).toEqual(invitation([OVER_WS]))
	})

	it('keeps every address when none is over WebSockets, rather than none', () => {
		const text = encodeStrandAddress(invitation([OVER_TCP]))
		expect(decodeStrandAddress(text, 'taleus-tally').bootstrap).toEqual([OVER_TCP])
	})

	it('refuses what is not a strand address', () => {
		expect(() => decodeStrandAddress('{"t":1}', 'taleus-tally')).toThrow(/no readable strand address/)
	})
})
