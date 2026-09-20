/**
 * The `/taleus/chipnet/1.0.0` transport: a lightweight libp2p request/response
 * channel between the two cadres of a tally that carries ChipNet's messages
 * (see docs/architecture.md § Transport and § Identity and address mapping).
 *
 * ChipNet is a meta-protocol — it owns the discovery search and commit-consensus
 * state machines but delegates *communications* to host callbacks. This module
 * implements those two callbacks over libp2p and nothing above them:
 *
 *   - `queryPeer(request, linkId)`   — discovery request/response.
 *   - `updatePeer(address, record)`  — commit/consensus push.
 *
 * plus the inbound handler that dispatches received frames up to the agent's
 * registered responder/participant. It does NOT implement discovery or commit
 * logic (those are `feat-lift-agent-discovery` / `feat-lift-referee-commit`) —
 * only the message pipe, frame correlation, and the identity/address resolution
 * beneath them.
 *
 * ── ChipNet binding is deferred ──────────────────────────────────────────────
 * NOTE: `chipnet`/`chipcryptbase` are not installable today (unpublished; see
 * tickets/blocked/chipnet-npm-publish-needed.md). Until they land, the ChipNet
 * message types below (`QueryRequest`, `QueryResponse`, `TrxRecord`, `Address`)
 * are a LOCAL PORT that captures only the fields THIS transport reads for
 * routing/correlation. Every message's substantive content rides in an opaque
 * `body` the transport frames verbatim and never interprets — faithful to
 * ChipNet's design, where terms and the transaction payload are an opaque
 * `Record<string, unknown>`. When the packages are consumable, replace this port
 * with imports from `chipnet` and keep the wire envelope unchanged.
 */

import { sha256 } from '../crypto/index.js'
import {
	type CommsStream,
	type DialAddr,
	type InboundConnection,
	type TransportNode,
	readFrame,
	withTimeout,
	writeFrame,
} from './comms.js'

/** libp2p protocol id for the cadre-to-cadre ChipNet channel. */
export const CHIPNET_PROTOCOL = '/taleus/chipnet/1.0.0'

/** Default cap on a single ChipNet frame; discovery/commit messages are small. */
const DEFAULT_MAX_FRAME_BYTES = 256 * 1024
/** Default time to wait for a response before abandoning a dial (ms). */
const DEFAULT_DIAL_TIMEOUT_MS = 10_000
/** Default time the receiver waits for an inbound frame before aborting the read (ms). */
const DEFAULT_READ_TIMEOUT_MS = 10_000
/** Default cap on concurrent inbound streams (mirrors Sereus seed's maxConcurrentSeeds). */
const DEFAULT_MAX_CONCURRENT = 100

/* ── ChipNet message port (opaque bodies) ─────────────────────────────────── */

/**
 * ChipNet's member identity. `key` is the lift agent's signing key for the
 * party (an authorized cadre key). `cuid` is optional extra identity, disclosed
 * only where intended. The transport uses these solely to resolve a dial target.
 */
export interface Address {
	key: string
	cuid?: string
}

/** ChipNet discovery request. The transport reads only `sessionCode`; the rest is opaque. */
export interface QueryRequest {
	readonly sessionCode: string
}

/** ChipNet discovery response. */
export interface QueryResponse {
	readonly sessionCode: string
}

/** ChipNet commit/consensus record. The transport reads `sessionCode`/`transactionCode`; the rest is opaque. */
export interface TrxRecord {
	readonly sessionCode: string
	readonly transactionCode: string
}

/** ChipNet's discovery comms callback: resolve `linkId` (a tally), dial, round-trip one frame. */
export type QueryPeerFunc = (request: QueryRequest, linkId: string) => Promise<QueryResponse>

/** ChipNet's `TrxParticipant.updatePeer`: push a record to a reachable member, addressed by cadre. */
export type UpdatePeerFunc = (address: Address, record: TrxRecord) => Promise<void>

/* ── Inbound dispatch seam (registered by downstream tickets) ──────────────── */

/**
 * Answer an inbound discovery query for an edge the agent owns. Registered by
 * `feat-lift-agent-discovery`. `linkId` has already been resolved from the
 * on-wire nonce via the private map, and the sender has already been verified
 * as this edge's counterparty.
 */
export type QueryResponder = (request: QueryRequest, linkId: string) => Promise<QueryResponse>

/**
 * Ingest an inbound commit/consensus record. Registered by
 * `feat-lift-referee-commit`. `fromPeerId` is the verified sending cadre peer.
 */
export type RecordParticipant = (record: TrxRecord, fromPeerId: string) => Promise<void>

/* ── Host ports (satisfied in production by a Sereus CadreNode) ────────────── */

/** A resolved dial target: the counterparty cadre's peer id plus its dialable addresses. */
export interface DialTarget {
	/** Counterparty cadre peer id (also the membership-gate identity). */
	peerId: string
	/**
	 * Dialable addresses, signaling/relay-first (as `CadreNode.resolvePeerAddrs`
	 * orders them) so a NAT'd/relay-only peer is reachable via its `/p2p-circuit`
	 * address. Empty when the counterparty is unreachable.
	 */
	addrs: DialAddr[]
	/**
	 * The tally strand shared with this target, if known — the push-wake key for
	 * the commit window. Absent for pure comms/relay resolutions.
	 */
	strandHint?: string
}

/** Result of a push-wake attempt. */
export interface PushWakeResult {
	accepted: boolean
	reason?: string
}

/**
 * Everything the transport needs from its host cadre, injected so the transport
 * is testable without a live node. In production every method is backed by a
 * `@serfab/cadre-core` `CadreNode`:
 *
 *   - `node`            → the cadre's libp2p node (`handle`/`dialProtocol`).
 *   - `resolveEdge`     → `linkId` → tally membership → counterparty → `resolvePeerAddrs`.
 *   - `resolveAddress`  → ChipNet `Address` → cadre → `resolvePeerAddrs`.
 *   - `isCounterparty`  → tally membership check on an inbound sender.
 *   - `pushWake`        → `CadreNode.pushWake` (`/sereus/strand-wake` + `DeviceToken`).
 */
export interface ChipNetTransportHost {
	node: TransportNode
	/** Resolve a tally edge to its counterparty cadre dial target. Discovery path. */
	resolveEdge(linkId: string): Promise<DialTarget>
	/** Resolve a ChipNet member `Address` to a cadre dial target. Commit path. */
	resolveAddress(address: Address): Promise<DialTarget>
	/**
	 * Membership gate: is `remotePeerId` the counterparty cadre of the tally
	 * `linkId`? Rejecting inbound frames from a non-counterparty. `Address` from a
	 * frame is never trusted on its own.
	 */
	isCounterparty(remotePeerId: string, linkId: string): Promise<boolean>
	/**
	 * Commit-window push-wake: bring a hibernating participant's phone up so it can
	 * receive/forward the commit record. Only the `updatePeer` (commit) path calls
	 * this; discovery is opportunistic-while-awake and never push-wakes.
	 */
	pushWake?(peerId: string, strandId: string, reason?: string): Promise<PushWakeResult>
}

/** Tuning knobs; each falls back to a conservative default. */
export interface ChipNetTransportOptions {
	maxFrameBytes?: number
	dialTimeoutMs?: number
	readTimeoutMs?: number
	maxConcurrent?: number
	/** Optional structured logger; caught errors are reported here rather than swallowed. */
	log?: (message: string, ...args: unknown[]) => void
}

/* ── Wire envelope (Taleus-owned; ChipNet body is opaque) ──────────────────── */

type FrameKind = 'query-request' | 'query-response' | 'trx-record' | 'trx-ack' | 'error'

/**
 * The on-wire frame. Only a per-session `nonce` (never a raw `linkId` or tally
 * id) identifies the tally, preserving the graph-privacy property: a peer can
 * recognize a tally it already knows but learns nothing about ones it doesn't.
 * `body` carries the opaque ChipNet message.
 */
interface ChipNetFrame {
	kind: FrameKind
	/** Anonymized tally id: base64(sha256(sessionCode ‖ linkId)). The only tally reference on the wire. */
	nonce?: string
	sessionCode?: string
	transactionCode?: string
	/** Opaque ChipNet message (QueryRequest / QueryResponse / TrxRecord). */
	body?: unknown
	/** Ack/error signalling. */
	ok?: boolean
	reason?: string
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard base64 encode of raw bytes. Cross-platform (no Buffer/btoa dependency). */
function base64(bytes: Uint8Array): string {
	let out = ''
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i]
		const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
		const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
		out += B64_ALPHABET[b0 >> 2]
		out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
		out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
		out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : '='
	}
	return out
}

/**
 * Derive the anonymized tally nonce ChipNet uses to hide graph identities:
 * `base64(sha256(sessionCode ‖ linkId))`. Salted per session, so an intermediary
 * sees a different hash each session and cannot correlate a tally across them.
 *
 * NOTE: The exact byte layout of the `sessionCode ‖ linkId` concatenation must be
 * reconciled with ChipNet's own `AnonymityService` when `chipnet` is installable
 * (blocked/chipnet-npm-publish-needed); both Taleus sides agree regardless, since
 * they run this same function. The session length prefix keeps the boundary unambiguous - a
 * bare delimiter (space or NUL) collides ("a b","c") with ("a","b c"),
 * and a nonce collision would let a peer conflate two tallies.
 */
export function computeNonce(sessionCode: string, linkId: string): string {
	const enc = new TextEncoder()
	const session = enc.encode(sessionCode)
	const link = enc.encode(linkId)
	const buf = new Uint8Array(4 + session.length + link.length)
	new DataView(buf.buffer).setUint32(0, session.length, false)
	buf.set(session, 4)
	buf.set(link, 4 + session.length)
	return base64(sha256(buf))
}

/**
 * The `/taleus/chipnet/1.0.0` transport. Construct it, `registerResponder` /
 * `registerParticipant` (downstream tickets), `registerEdge` the agent's own
 * tally edges for each session, then `start()` to accept inbound frames. The
 * two ChipNet comms callbacks are exposed as bound methods `queryPeer` /
 * `updatePeer`.
 */
export class ChipNetTransport {
	private readonly host: ChipNetTransportHost
	private readonly maxFrameBytes: number
	private readonly dialTimeoutMs: number
	private readonly readTimeoutMs: number
	private readonly maxConcurrent: number
	private readonly log: (message: string, ...args: unknown[]) => void

	/**
	 * Private nonce → real `linkId` map: only the owning agent maps a salted-hash
	 * nonce back to a real tally, and it never leaves this object.
	 */
	private readonly nonceToLinkMap = new Map<string, string>()

	private responder: QueryResponder | null = null
	private participant: RecordParticipant | null = null
	private started = false
	private activeStreams = 0

	constructor(host: ChipNetTransportHost, options: ChipNetTransportOptions = {}) {
		this.host = host
		this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
		this.dialTimeoutMs = options.dialTimeoutMs ?? DEFAULT_DIAL_TIMEOUT_MS
		this.readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS
		this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
		this.log = options.log ?? ((): void => {})
	}

	/** Number of in-flight inbound streams (bounded by `maxConcurrent`). */
	get activeCount(): number {
		return this.activeStreams
	}

	/** Register the discovery responder. Called once by `feat-lift-agent-discovery`. */
	registerResponder(responder: QueryResponder): void {
		this.responder = responder
	}

	/** Register the commit/consensus participant. Called once by `feat-lift-referee-commit`. */
	registerParticipant(participant: RecordParticipant): void {
		this.participant = participant
	}

	/**
	 * Bind one of the agent's own tally edges to a session so an inbound frame
	 * naming its nonce resolves back to the real `linkId`. Returns the nonce (also
	 * what `queryPeer` puts on the wire for this edge). Idempotent per (session,
	 * edge).
	 */
	registerEdge(sessionCode: string, linkId: string): string {
		const nonce = computeNonce(sessionCode, linkId)
		this.nonceToLinkMap.set(nonce, linkId)
		return nonce
	}

	/** Drop a session's edge nonce once a lift completes, so the map does not grow unbounded. */
	forgetEdge(sessionCode: string, linkId: string): void {
		this.nonceToLinkMap.delete(computeNonce(sessionCode, linkId))
	}

	/** Register the inbound protocol handler on the cadre node. */
	async start(): Promise<void> {
		if (this.started) {
			return
		}
		// `runOnLimitedConnection: true` is REQUIRED for the relay path: a NAT'd
		// counterparty is reached over a circuit-relay connection, which libp2p
		// marks "limited". Without this the receiver would refuse the inbound
		// stream on exactly the connection a phone↔phone tally depends on.
		await this.host.node.handle(
			CHIPNET_PROTOCOL,
			(stream: CommsStream, connection: InboundConnection) =>
				this.handleInbound(stream, connection.remotePeer.toString()),
			{ runOnLimitedConnection: true },
		)
		this.started = true
	}

	/** Unregister the handler. */
	async stop(): Promise<void> {
		if (!this.started) {
			return
		}
		await this.host.node.unhandle(CHIPNET_PROTOCOL)
		this.started = false
	}

	/**
	 * ChipNet `QueryPeerFunc`: resolve `linkId` to the counterparty cadre, dial
	 * `/taleus/chipnet/1.0.0`, send one `QueryRequest` frame, await one
	 * `QueryResponse`. Bounded by `dialTimeoutMs` and rejects promptly on an
	 * unreachable/sleeping edge — so ChipNet's per-query time budget simply skips
	 * that edge and folds any late response into the next phase. It does NOT retry
	 * beyond trying each resolved address once.
	 */
	queryPeer: QueryPeerFunc = async (request: QueryRequest, linkId: string): Promise<QueryResponse> => {
		const target = await this.host.resolveEdge(linkId)
		const nonce = computeNonce(request.sessionCode, linkId)
		const frame: ChipNetFrame = {
			kind: 'query-request',
			nonce,
			sessionCode: request.sessionCode,
			body: request,
		}
		const response = await this.roundTrip(target.addrs, frame, 'chipnet query')
		if (response.kind === 'error' || response.body === undefined) {
			throw new Error(`chipnet query rejected: ${response.reason ?? 'no response body'}`)
		}
		return response.body as QueryResponse
	}

	/**
	 * ChipNet `TrxParticipant.updatePeer`: push a `TrxRecord` to a member,
	 * addressed by its cadre. This is the commit path, so a hibernating phone-only
	 * participant is push-woken (Sereus `/sereus/strand-wake` + `DeviceToken`) and
	 * the dial retried once.
	 *
	 * NOTE: Push-wake can fail (token stale, phone off). On failure this throws
	 * rather than hanging, so `feat-lift-referee-commit` degrades the commit to a
	 * referee timeout-void instead of stalling the whole route. That contract is
	 * owned jointly with `feat-lift-referee-commit`.
	 */
	updatePeer: UpdatePeerFunc = async (address: Address, record: TrxRecord): Promise<void> => {
		const target = await this.host.resolveAddress(address)
		const frame: ChipNetFrame = {
			kind: 'trx-record',
			sessionCode: record.sessionCode,
			transactionCode: record.transactionCode,
			body: record,
		}
		try {
			await this.pushRecord(target.addrs, frame)
			return
		} catch (dialErr) {
			// NOTE: this catch fires on ANY push failure, including an application-level
			// ack rejection (participant threw), not only an unreachable dial — so the
			// push-wake retry below can re-deliver a record the participant already saw.
			// The registered RecordParticipant (feat-lift-referee-commit) must therefore
			// be idempotent (correlate by transactionCode) and not double-apply.
			this.log('updatePeer initial dial failed for %s: %o', target.peerId, dialErr)
			const woke = await this.tryPushWake(target)
			if (!woke) {
				throw dialErr instanceof Error ? dialErr : new Error(String(dialErr))
			}
			// Re-resolve: a just-woken phone may have published a fresh address.
			const rewoken = await this.host.resolveAddress(address)
			await this.pushRecord(rewoken.addrs, frame)
		}
	}

	/** Attempt the commit-window push-wake. Returns true only if a waker exists and accepted. */
	private async tryPushWake(target: DialTarget): Promise<boolean> {
		if (!this.host.pushWake || target.strandHint === undefined) {
			return false
		}
		try {
			const result = await this.host.pushWake(target.peerId, target.strandHint, 'lift-commit')
			return result.accepted
		} catch (err) {
			this.log('push-wake failed for %s: %o', target.peerId, err)
			return false
		}
	}

	/** Dial each candidate address in turn, sending the frame and reading one response frame. */
	private async roundTrip(addrs: DialAddr[], frame: ChipNetFrame, label: string): Promise<ChipNetFrame> {
		if (addrs.length === 0) {
			throw new Error(`${label}: no dialable address for target`)
		}
		let lastError: Error | null = null
		for (const addr of addrs) {
			// One controller per attempt: on timeout, `onTimeout` aborts it, which
			// aborts the in-flight dialProtocol (via the signal) and the live stream —
			// so neither the connect nor the unbounded response-read leaks.
			const controller = new AbortController()
			try {
				return await withTimeout(
					this.dialTimeoutMs,
					`${label} dial ${addr.toString()}`,
					() => this.sendAndRead(addr, frame, controller.signal),
					() => controller.abort(),
				)
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err))
				this.log('%s dial to %s failed: %o', label, addr.toString(), err)
			}
		}
		throw lastError ?? new Error(`${label} dial failed`)
	}

	/** Open one stream, send `frame`, half-close, and read the single response frame. */
	private async sendAndRead(addr: DialAddr, frame: ChipNetFrame, signal: AbortSignal): Promise<ChipNetFrame> {
		const stream = await this.host.node.dialProtocol(addr, CHIPNET_PROTOCOL, {
			runOnLimitedConnection: true,
			signal,
		})
		const abortErr = new Error('chipnet dial aborted by timeout')
		const onAbort = (): void => stream.abort(abortErr)
		if (signal.aborted) {
			onAbort()
			throw abortErr
		}
		signal.addEventListener('abort', onAbort, { once: true })
		try {
			writeFrame(stream, frame)
			// Half-close the write end (EOF) while the read end stays open for the response.
			await stream.close()
			return await readFrame<ChipNetFrame>(stream, {
				maxBytes: this.maxFrameBytes,
				timeoutMs: this.dialTimeoutMs,
				label: 'chipnet response',
			})
		} finally {
			signal.removeEventListener('abort', onAbort)
		}
	}

	/** Push a record frame and consume the ack (one round trip, ack ignored beyond delivery). */
	private async pushRecord(addrs: DialAddr[], frame: ChipNetFrame): Promise<void> {
		const ack = await this.roundTrip(addrs, frame, 'chipnet record')
		if (ack.kind === 'error' || ack.ok === false) {
			throw new Error(`chipnet record rejected: ${ack.reason ?? 'not acked'}`)
		}
	}

	/**
	 * Inbound handler: read one frame, dispatch it up to the registered
	 * responder/participant, write the reply. Reentrant — many concurrent lifts
	 * and discovery sessions share this protocol, correlated by the frame's
	 * `nonce`/`sessionCode`/`transactionCode`. Bounded by `maxConcurrent` so a
	 * peer cannot pin unbounded streams open.
	 */
	private async handleInbound(stream: CommsStream, remotePeerId: string): Promise<void> {
		if (this.activeStreams >= this.maxConcurrent) {
			this.log('rejecting inbound from %s: %d streams at cap %d', remotePeerId, this.activeStreams, this.maxConcurrent)
			await this.replyAndClose(stream, { kind: 'error', reason: 'too many concurrent streams' })
			return
		}
		this.activeStreams++
		try {
			const frame = await readFrame<ChipNetFrame>(stream, {
				maxBytes: this.maxFrameBytes,
				timeoutMs: this.readTimeoutMs,
				label: 'chipnet inbound',
			})
			const reply = await this.dispatch(frame, remotePeerId)
			writeFrame(stream, reply)
		} catch (err) {
			this.log('error handling inbound from %s: %o', remotePeerId, err)
			try {
				writeFrame(stream, { kind: 'error', reason: err instanceof Error ? err.message : 'unknown error' })
			} catch {
				// Ignore send failures on the error path.
			}
		} finally {
			this.activeStreams--
			try {
				await stream.close()
			} catch {
				// Ignore close failures.
			}
		}
	}

	/** Route a decoded inbound frame to the right seam and produce the reply frame. */
	private async dispatch(frame: ChipNetFrame, remotePeerId: string): Promise<ChipNetFrame> {
		switch (frame.kind) {
			case 'query-request':
				return this.dispatchQuery(frame, remotePeerId)
			case 'trx-record':
				return this.dispatchRecord(frame, remotePeerId)
			default:
				return { kind: 'error', reason: `unexpected frame kind: ${frame.kind}` }
		}
	}

	/** Handle an inbound discovery query: nonce → edge, membership-gate, responder. */
	private async dispatchQuery(frame: ChipNetFrame, remotePeerId: string): Promise<ChipNetFrame> {
		if (frame.nonce === undefined || frame.body === undefined) {
			return { kind: 'error', reason: 'query missing nonce or body' }
		}
		const linkId = this.nonceToLinkMap.get(frame.nonce)
		if (linkId === undefined) {
			// Privacy: a nonce we cannot map is an unknown edge, not an error to leak.
			return { kind: 'query-response', nonce: frame.nonce, sessionCode: frame.sessionCode, ok: false, reason: 'unknown edge' }
		}
		if (!(await this.host.isCounterparty(remotePeerId, linkId))) {
			return { kind: 'error', reason: 'sender is not the edge counterparty' }
		}
		if (!this.responder) {
			return { kind: 'error', reason: 'no responder registered' }
		}
		const response = await this.responder(frame.body as QueryRequest, linkId)
		return { kind: 'query-response', nonce: frame.nonce, sessionCode: frame.sessionCode, body: response }
	}

	/** Handle an inbound commit/consensus record: membership-gate (if the edge is known), participant. */
	private async dispatchRecord(frame: ChipNetFrame, remotePeerId: string): Promise<ChipNetFrame> {
		if (frame.body === undefined) {
			return { kind: 'error', reason: 'record missing body' }
		}
		// If the record names a nonce we own, gate the sender as that edge's
		// counterparty. Records that fan out over a `C`-intent relay hop may name a
		// nonce we do not map; those are dispatched for the participant to correlate
		// by sessionCode/transactionCode, never trusting the frame's own Address.
		if (frame.nonce !== undefined) {
			const linkId = this.nonceToLinkMap.get(frame.nonce)
			if (linkId !== undefined && !(await this.host.isCounterparty(remotePeerId, linkId))) {
				return { kind: 'error', reason: 'sender is not the edge counterparty' }
			}
		}
		if (!this.participant) {
			return { kind: 'error', reason: 'no participant registered' }
		}
		await this.participant(frame.body as TrxRecord, remotePeerId)
		return { kind: 'trx-ack', ok: true, transactionCode: frame.transactionCode, sessionCode: frame.sessionCode }
	}

	/** Best-effort write-then-close for reject paths that never dispatch. */
	private async replyAndClose(stream: CommsStream, frame: ChipNetFrame): Promise<void> {
		try {
			writeFrame(stream, frame)
		} catch {
			// Ignore send failures on the reject path.
		}
		try {
			await stream.close()
		} catch {
			// Ignore close failures.
		}
	}
}
