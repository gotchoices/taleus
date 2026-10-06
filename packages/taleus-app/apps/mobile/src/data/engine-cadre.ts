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
import { cadreStoreProvider, taleusSApp } from 'taleus-model/cadre'
import { createEngineModel } from 'taleus-model/engine'

import { installDevBridge } from './dev-bridge'
import { keychainSecureStore } from './keychain'

const leveldb = { openFn: (name: string, create: boolean, errorIfExists: boolean) => new LevelDB(name, create, errorIfExists), WriteBatch: LevelDBWriteBatch }

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
		// No `strandReactivity` yet, though the tally tables carry `optimystic.network_watch`:
		// each watched table pays a registration proof of work at every strand build, hashed
		// in pure JS (@noble/hashes, not crypto.subtle), which under Hermes starves the JS thread
		// for minutes -- long enough for the relay reservation to lapse. The store's backstop
		// poll stands in until that proof of work is cheap on a phone.
	}),
})

/**
 * Start this phone's node -- with the options it last ran with, or as a fresh party reserving on
 * `relayAddrs` -- and the engine over it. The relays are what make the phone reachable: an
 * invitation from a phone with none cannot be redeemed.
 */
export async function startCadreEngine(relayAddrs: readonly string[]): Promise<TaleusModel> {
	const saved = await phone.loadSavedStart()
	const options: PhoneNodeOptions = saved?.options ?? { partyId: `taleus-${randomId()}`, bootstrapAddrs: [], relayAddrs: [...relayAddrs] }
	const node = await phone.start(options)
	createBackgroundRunner({ ...phoneNodeLifecycle(phone), appState: AppState }).start()

	const session = new LevelDBKVStore(openOptimysticRNDb({ ...leveldb, name: SESSION_DB }), 'taleus:session:')
	const engine = await createEngineModel({
		store: cadreStoreProvider({ node, sApp: taleusSApp(), disclosure: { purpose: 'tally' } }),
		storage: {
			state: kvStoreSlot(session, SESSION_STATE_KEY),
			identity: secureStoreSlot(keychainSecureStore, IDENTITY_SLOT),
		},
	})
	installDevBridge(engine.model, () => {
		const running = phone.node
		return running
			? { peerId: running.peerId?.toString(), addrs: running.getMultiaddrs().map(a => a.toString()), relay: running.getRelayReservationState(), strands: [...running.getStrands().keys()] }
			: { status: phone.status.state }
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
