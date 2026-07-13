import {
	CHIPNET_PROTOCOL,
	ChipNetTransport,
	computeNonce,
	type ChipNetTransportHost,
	type DialTarget,
	type PushWakeResult,
	type QueryResponse,
	type TrxRecord,
} from './chipnet-protocol.js'
import { readFrame, writeFrame } from './comms.js'
import { addr, InMemoryNode } from './test-harness.js'

interface TestResponse extends QueryResponse {
	result: string
}
interface TestRecord extends TrxRecord {
	note: string
}

/** Build a host whose defaults are harmless; each test overrides what it exercises. */
function makeHost(node: InMemoryNode, overrides: Partial<ChipNetTransportHost> = {}): ChipNetTransportHost {
	return {
		node,
		resolveEdge: () => Promise.reject(new Error('resolveEdge not stubbed')),
		resolveAddress: () => Promise.reject(new Error('resolveAddress not stubbed')),
		isCounterparty: () => Promise.resolve(true),
		...overrides,
	}
}

/** Dial the protocol directly and return the raw reply frame — for probing inbound behavior. */
async function rawExchange(
	from: InMemoryNode,
	targetPeerId: string,
	frame: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const stream = await from.dialProtocol(addr(targetPeerId), CHIPNET_PROTOCOL, {})
	writeFrame(stream, frame)
	await stream.close()
	return readFrame<Record<string, unknown>>(stream, { maxBytes: 4096, timeoutMs: 1000, label: 'raw' })
}

describe('ChipNetTransport', () => {
	const SESSION = 's1'
	const LINK = 'tally-1'

	function twoNodes(): { registry: Map<string, InMemoryNode>; a: InMemoryNode; b: InMemoryNode } {
		const registry = new Map<string, InMemoryNode>()
		return { registry, a: new InMemoryNode('A', registry), b: new InMemoryNode('B', registry) }
	}

	it('round-trips a discovery query between two cadre transports', async () => {
		const { a, b } = twoNodes()
		let seenLink: string | null = null
		let seenSession: string | null = null

		const transportB = new ChipNetTransport(makeHost(b, { isCounterparty: (peer, link) => Promise.resolve(peer === 'A' && link === LINK) }))
		transportB.registerEdge(SESSION, LINK)
		transportB.registerResponder((request, link) => {
			seenLink = link
			seenSession = request.sessionCode
			const response: TestResponse = { sessionCode: request.sessionCode, result: 'capacity-42' }
			return Promise.resolve(response)
		})
		await transportB.start()

		const transportA = new ChipNetTransport(makeHost(a, { resolveEdge: () => Promise.resolve({ peerId: 'B', addrs: [addr('B')] }) }))
		const response = (await transportA.queryPeer({ sessionCode: SESSION }, LINK)) as TestResponse

		expect(response.result).toBe('capacity-42')
		expect(seenLink).toBe(LINK)
		expect(seenSession).toBe(SESSION)
	})

	it('pushes an updatePeer record to the addressed member', async () => {
		const { a, b } = twoNodes()
		const received: Array<{ record: TestRecord; from: string }> = []

		const transportB = new ChipNetTransport(makeHost(b))
		transportB.registerParticipant((record, from) => {
			received.push({ record: record as TestRecord, from })
			return Promise.resolve()
		})
		await transportB.start()

		const target: DialTarget = { peerId: 'B', addrs: [addr('B')], strandHint: LINK }
		const transportA = new ChipNetTransport(makeHost(a, { resolveAddress: () => Promise.resolve(target) }))

		const record: TestRecord = { sessionCode: SESSION, transactionCode: 't1', note: 'commit-vote' }
		await transportA.updatePeer({ key: 'B-agent-key' }, record)

		expect(received).toHaveLength(1)
		expect(received[0].record.transactionCode).toBe('t1')
		expect(received[0].record.note).toBe('commit-vote')
		expect(received[0].from).toBe('A')
	})

	it('skips an unreachable/sleeping edge without failing sibling queries', async () => {
		const { a, b } = twoNodes()
		const transportB = new ChipNetTransport(makeHost(b))
		transportB.registerEdge(SESSION, 'reachable')
		transportB.registerResponder((request) => Promise.resolve({ sessionCode: request.sessionCode } as QueryResponse))
		await transportB.start()

		const transportA = new ChipNetTransport(
			makeHost(a, {
				// A sleeping counterparty resolves to an address nobody answers on.
				resolveEdge: (link) => Promise.resolve({ peerId: link === 'asleep' ? 'ghost' : 'B', addrs: [addr(link === 'asleep' ? 'ghost' : 'B')] }),
			}),
			{ dialTimeoutMs: 100 },
		)

		await expect(transportA.queryPeer({ sessionCode: SESSION }, 'asleep')).rejects.toThrow(/unreachable/)
		// The dead edge did not poison the live one.
		await expect(transportA.queryPeer({ sessionCode: SESSION }, 'reachable')).resolves.toBeDefined()
	})

	it('rejects an edge that never responds within the dial timeout', async () => {
		const { a, b } = twoNodes()
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})

		const transportB = new ChipNetTransport(makeHost(b))
		transportB.registerEdge(SESSION, LINK)
		transportB.registerResponder(async (request) => {
			await gate
			return { sessionCode: request.sessionCode }
		})
		await transportB.start()

		const transportA = new ChipNetTransport(
			makeHost(a, { resolveEdge: () => Promise.resolve({ peerId: 'B', addrs: [addr('B')] }) }),
			{ dialTimeoutMs: 40 },
		)
		try {
			await expect(transportA.queryPeer({ sessionCode: SESSION }, LINK)).rejects.toThrow(/timed out after 40ms/)
		} finally {
			release()
		}
	})

	it('treats an unmappable nonce as an unknown edge, not an error, and does not invoke the responder', async () => {
		const { a, b } = twoNodes()
		let responderCalls = 0
		const transportB = new ChipNetTransport(makeHost(b))
		// Deliberately do NOT registerEdge, so the nonce maps to nothing.
		transportB.registerResponder(() => {
			responderCalls++
			return Promise.resolve({ sessionCode: SESSION } as QueryResponse)
		})
		await transportB.start()

		const reply = await rawExchange(a, 'B', {
			kind: 'query-request',
			nonce: computeNonce(SESSION, LINK),
			sessionCode: SESSION,
			body: { sessionCode: SESSION },
		})

		expect(reply.kind).toBe('query-response')
		expect(reply.ok).toBe(false)
		expect(reply.reason).toBe('unknown edge')
		expect(responderCalls).toBe(0)
	})

	it('rejects an inbound query whose sender is not the edge counterparty', async () => {
		const { a, b } = twoNodes()
		let responderCalls = 0
		const transportB = new ChipNetTransport(makeHost(b, { isCounterparty: () => Promise.resolve(false) }))
		transportB.registerEdge(SESSION, LINK)
		transportB.registerResponder(() => {
			responderCalls++
			return Promise.resolve({ sessionCode: SESSION } as QueryResponse)
		})
		await transportB.start()

		const reply = await rawExchange(a, 'B', {
			kind: 'query-request',
			nonce: computeNonce(SESSION, LINK),
			sessionCode: SESSION,
			body: { sessionCode: SESSION },
		})

		expect(reply.kind).toBe('error')
		expect(reply.reason).toMatch(/not the edge counterparty/)
		expect(responderCalls).toBe(0)
	})

	it('replies with an error for an unexpected frame kind', async () => {
		const { a, b } = twoNodes()
		const transportB = new ChipNetTransport(makeHost(b))
		await transportB.start()

		const reply = await rawExchange(a, 'B', { kind: 'bogus', body: {} })
		expect(reply.kind).toBe('error')
		expect(reply.reason).toMatch(/unexpected frame kind/)
	})

	it('caps concurrent inbound streams, rejecting the overflow', async () => {
		const { a, b } = twoNodes()
		let entered: () => void = () => {}
		const inFlight = new Promise<void>((resolve) => {
			entered = resolve
		})
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let responderCalls = 0

		const transportB = new ChipNetTransport(
			makeHost(b, { isCounterparty: () => Promise.resolve(true) }),
			{ maxConcurrent: 1 },
		)
		transportB.registerEdge(SESSION, LINK)
		transportB.registerResponder(async (request) => {
			responderCalls++
			entered()
			await gate
			return { sessionCode: request.sessionCode }
		})
		await transportB.start()

		const transportA = new ChipNetTransport(makeHost(a, { resolveEdge: () => Promise.resolve({ peerId: 'B', addrs: [addr('B')] }) }))

		const first = transportA.queryPeer({ sessionCode: SESSION }, LINK)
		await inFlight
		expect(transportB.activeCount).toBe(1)

		await expect(transportA.queryPeer({ sessionCode: SESSION }, LINK)).rejects.toThrow(/too many concurrent streams/)
		expect(responderCalls).toBe(1)

		release()
		await expect(first).resolves.toBeDefined()
	})

	it('push-wakes then retries a commit dial to a hibernating member', async () => {
		const { a, b } = twoNodes()
		const received: TrxRecord[] = []
		const transportB = new ChipNetTransport(makeHost(b))
		transportB.registerParticipant((record) => {
			received.push(record)
			return Promise.resolve()
		})
		await transportB.start()

		const wakeCalls: Array<{ peerId: string; strandId: string; reason?: string }> = []
		let resolveCalls = 0
		const transportA = new ChipNetTransport(
			makeHost(a, {
				resolveAddress: () => {
					resolveCalls++
					// First resolution: asleep (unreachable). After wake: reachable.
					return Promise.resolve(
						resolveCalls === 1
							? { peerId: 'B', addrs: [addr('ghost')], strandHint: LINK }
							: { peerId: 'B', addrs: [addr('B')], strandHint: LINK },
					)
				},
				pushWake: (peerId, strandId, reason): Promise<PushWakeResult> => {
					wakeCalls.push({ peerId, strandId, reason })
					return Promise.resolve({ accepted: true })
				},
			}),
		)

		const record: TestRecord = { sessionCode: SESSION, transactionCode: 't2', note: 'commit' }
		await transportA.updatePeer({ key: 'B' }, record)

		expect(wakeCalls).toEqual([{ peerId: 'B', strandId: LINK, reason: 'lift-commit' }])
		expect(received).toHaveLength(1)
		expect((received[0] as TestRecord).transactionCode).toBe('t2')
	})

	it('fails the commit dial (not hang) when push-wake is refused', async () => {
		const { a } = twoNodes()
		const transportA = new ChipNetTransport(
			makeHost(a, {
				resolveAddress: () => Promise.resolve({ peerId: 'B', addrs: [addr('ghost')], strandHint: LINK }),
				pushWake: () => Promise.resolve({ accepted: false, reason: 'token stale' }),
			}),
		)

		await expect(
			transportA.updatePeer({ key: 'B' }, { sessionCode: SESSION, transactionCode: 't3' }),
		).rejects.toThrow(/unreachable/)
	})

	it('derives a deterministic, session-salted nonce and never the raw linkId', () => {
		const n1 = computeNonce(SESSION, LINK)
		const n2 = computeNonce(SESSION, LINK)
		expect(n1).toBe(n2)
		expect(n1).not.toContain(LINK)
		expect(computeNonce('s2', LINK)).not.toBe(n1)
		expect(computeNonce(SESSION, 'tally-2')).not.toBe(n1)
		expect(n1).toMatch(/^[A-Za-z0-9+/]+=*$/)
	})

	it('start() and stop() are idempotent', async () => {
		const { b } = twoNodes()
		const transportB = new ChipNetTransport(makeHost(b))
		await transportB.start()
		await transportB.start()
		await transportB.stop()
		await transportB.stop()
		expect(transportB.activeCount).toBe(0)
	})
})
