/**
 * Engine mode on a real cadre (Mode C): this phone's own Sereus node, each tally a strand shared
 * with the counterparty. The only module that imports the node code; `config.ts` loads it on
 * demand, so mock mode and every test never evaluate it.
 *
 * The node is the cadre kit's (`@serfab/cadre-rn`): identity in the keychain, its records in
 * LevelDB, the saved start for the next launch, and the lifecycle runner hibernating its strands
 * in the background.
 */
import { AppState } from 'react-native'
import { LevelDB, LevelDBWriteBatch } from 'rn-leveldb'
import { LevelDBKVStore, openOptimysticRNDb } from '@optimystic/db-p2p-storage-rn'
import { createBackgroundRunner, phoneNodeLifecycle } from '@serfab/cadre-rn/lifecycle'
import { kvStoreSlot, secureStoreSlot } from '@serfab/cadre-rn/node-local'
import { buildNoiseCrypto, DEFAULT_NOISE_CRYPTO_MODE } from '@serfab/cadre-rn/noise-crypto'
import { createPhoneNode, type PhoneNodeOptions } from '@serfab/cadre-rn/phone-node'
import type { TaleusModel } from 'taleus-model'
import { cadreStoreProvider, taleusSApp } from 'taleus-sereus'
import { slotDocumentCache } from 'taleus-model/contracts'
import { createEngineModel } from 'taleus-model/engine'

import { installDevBridge } from './dev-bridge'
import { recordStatement } from './statement-log'
import { keychainSecureStore } from './keychain'

const leveldb = {
	openFn: (name: string, create: boolean, errorIfExists: boolean) => new LevelDB(name, create, errorIfExists),
	WriteBatch: LevelDBWriteBatch,
	// The kit deletes a cadre's data with it, when the phone leaves or is removed from one.
	destroy: (name: string) => LevelDB.destroyDB(name),
}

/**
 * The names this app's data is filed under. Each is a persistence contract: renaming one
 * orphans every installed phone's records.
 */
const NAMES = {
	storagePrefix: 'taleus-',
	nodeLocalDb: 'taleus-node-local',
	nodeLocalKvPrefix: 'taleus:node-local:',
	savedStartKey: 'start-options',
}
const SESSION_DB = 'taleus-session'
const SESSION_STATE_KEY = 'state'
const DOCUMENT_KEY_PREFIX = 'document:'
const WRITE_LOG_KEY_PREFIX = 'writes:'
/** The strand mode a fresh party starts in. */
const STRAND_OFFLINE_MODE = 'offline' as const
const IDENTITY_SLOT = 'taleus.identity'

/** The format of the data this build writes, reported back by the next start's saved record. */
const DATA_VERSION = '1'

const phone = createPhoneNode({
	secureStore: keychainSecureStore,
	leveldb,
	names: NAMES,
	dataVersion: DATA_VERSION,
	// Noise's per-frame crypto in native code (react-native-quick-crypto) rather than pure JS.
	noiseCrypto: { build: buildNoiseCrypto, defaultMode: DEFAULT_NOISE_CRYPTO_MODE },
	configure: config => ({
		...config,
		// The tally sApp is unsigned until Taleus signs it at release (`taleusSApp`).
		requireSignedSchemas: false,
		// The tally tables carry `optimystic.network_watch`, so a counterparty's commit reaches
		// this phone's `subscribe` without polling. Before Optimystic 1.12 each watched table paid
		// a registration proof of work in pure JS that starved Hermes for minutes
		// (gotchoices/Optimystic#31); a keyed node now signs a self-endorsement instead.
		strandReactivity: { enabled: true },
	}),
})

/**
 * Start this phone's node -- with the options it last ran with, or as a fresh party reserving on
 * `relayAddrs` -- and the engine over it. The relays are what make the phone reachable: an
 * invitation from a phone with none cannot be redeemed.
 */
export async function startCadreEngine(relayAddrs: readonly string[]): Promise<TaleusModel> {
	const saved = await phone.loadSavedStart()
	// Strand offline mode (sereus docs/strands.md, "Offline mode"): an act returns once it is saved on
	// this phone and is sent to the counterparty after, each entry marked until they hold it. A fresh
	// party starts in it; a saved start keeps the mode it last ran with (the developer switch sets it).
	const options: PhoneNodeOptions = saved?.options ?? {
		partyId: `taleus-${randomId()}`,
		bootstrapAddrs: [],
		relayAddrs: [...relayAddrs],
		strandOfflineMode: STRAND_OFFLINE_MODE,
	}
	const node = await phone.start(options)
	createBackgroundRunner({ ...phoneNodeLifecycle(phone), appState: AppState }).start()

	const session = new LevelDBKVStore(openOptimysticRNDb({ ...leveldb, name: SESSION_DB }), 'taleus:session:')
	const engine = await createEngineModel({
		// Reactivity carries a counterparty's commits; the store's backstop poll (default 10 min)
		// only catches a missed watch.
		store: cadreStoreProvider({
			node,
			sApp: taleusSApp(),
			disclosure: { purpose: 'tally' },
			// Which of its own writes this phone still follows, per tally, beside the device state.
			writeLog: strandId => kvStoreSlot(session, `${WRITE_LOG_KEY_PREFIX}${strandId}`),
			...(__DEV__ ? { onStatement: recordStatement } : {}),
		}),
		storage: {
			state: kvStoreSlot(session, SESSION_STATE_KEY),
			identity: secureStoreSlot(keychainSecureStore, IDENTITY_SLOT),
		},
		// Every contract document this party has seen, kept beside the device state.
		documents: slotDocumentCache(cid => kvStoreSlot(session, `${DOCUMENT_KEY_PREFIX}${cid}`)),
	})
	installDevBridge(engine.model, () => {
		const running = phone.node
		return running
			? {
					peerId: running.peerId?.toString(),
					addrs: running.getMultiaddrs().map(a => a.toString()),
					relay: running.getRelayReservationState(),
					strands: [...running.getStrands().values()].map(strand => ({
						id: strand.strandId,
						status: strand.status,
						connectedPeers: strand.connectedPeers,
						error: strand.error,
						connections: strand.libp2pNode?.getConnections().map(connectionOf),
					})),
					control: running.getControlNode()?.getConnections().map(connectionOf) ?? [],
				}
			: { status: phone.status.state }
	}, async (strandId, text) => {
		const database = phone.node?.getStrand(strandId)?.database
		if (!database) throw new Error(`no database for ${strandId}`)
		const rows: unknown[] = []
		for await (const row of database.getDatabase().eval(text)) rows.push(row)
		return rows
	})
	return engine.model
}

/** Installed by `@serfab/cadre-rn/polyfills` (react-native-get-random-values) before the app loads. */
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T }

function randomId(): string {
	const bytes = new Uint8Array(8)
	crypto.getRandomValues(bytes)
	return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** One libp2p connection as the dev bridge's `status` reports it, with its open streams' protocols. */
function connectionOf(connection: {
	remotePeer: { toString(): string }
	remoteAddr: { toString(): string }
	status: string
	streams: { protocol?: string; direction: string }[]
}) {
	return {
		peer: connection.remotePeer.toString(),
		addr: connection.remoteAddr.toString(),
		status: connection.status,
		streams: connection.streams.map(stream => `${stream.direction === 'inbound' ? 'in' : 'out'} ${stream.protocol ?? '?'}`),
	}
}
