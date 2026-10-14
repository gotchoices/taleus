/**
 * A Taleus party's cadre node on a Node machine, kept in its folder (`home.ts`): what a CLI, a
 * scenario test or `taleus-node` runs where the phone runs `@serfab/cadre-rn`'s phone node.
 *
 * The node is shaped like the phone's (transaction profile, reachable through relays) so it
 * behaves as a phone does on the network, with Node's file-backed stores in place of the phone's
 * keychain and LevelDB, as sereus's `cadre-cli` and chat's CLI build them. Hibernation is off: a
 * process that is running is serving. `listen` adds listen addresses, which a phone cannot have,
 * so two parties on one machine can reach each other without a relay.
 */
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { multiaddr } from '@multiformats/multiaddr'
import { webSockets } from '@libp2p/websockets'
import { FileRawStorage } from '@optimystic/db-p2p-storage-fs'
import { CadreNode, DEFAULT_IDENTITY_KEY_ID, type CadreNodeConfig, type DurableSlot } from '@serfab/cadre-core'
import { FileBootstrapPeerStore } from '@serfab/cadre-core/bootstrap-peer-store-file'
import { FileEnrolledMachineStore } from '@serfab/cadre-core/enrolled-machine-store-file'
import { FileKeyStore } from '@serfab/cadre-core/key-store-file'
import { FileStrandNetworkStateStore } from '@serfab/cadre-core/strand-network-state-file'
import { FileTrustedOwnerStore } from '@serfab/cadre-core/trusted-owner-store-file'
import { readText, saveConfig, writeTextAtomic, type PartyConfig, type PartyDirs } from './home.js'

/** Owner genesis is bounded, as the phone kit bounds it: a start must not hang on it. */
const OWNER_GENESIS_MS = 60_000

export interface NodeHostOptions {
	dirs: PartyDirs
	config: PartyConfig
	/** The sApp whose strands this node attaches: the tally sApp's id. */
	sAppId: string
	/** Relays for this run, beside the saved ones. */
	extraRelays?: readonly string[]
	/** Listen addresses for this run; `loopbackListenAddress` gives the party's own. */
	listen?: readonly string[]
}

/** Start the party's node: built over its folder, started, and enrolled as its own owner. */
export async function startPartyNode(options: NodeHostOptions): Promise<CadreNode> {
	const node = new CadreNode(await nodeConfig(options))
	await node.start()
	await ownerGenesis(node)
	return node
}

async function nodeConfig({ dirs, config, sAppId, extraRelays = [], listen = [] }: NodeHostOptions): Promise<CadreNodeConfig> {
	const { partyId } = config
	return {
		keyStore: new FileKeyStore(dirs.keys),
		identityKeyId: DEFAULT_IDENTITY_KEY_ID,
		controlNetwork: { partyId, bootstrapNodes: [] },
		profile: 'transaction',
		storage: { provider: (scope: string) => new FileRawStorage(join(dirs.blocks, scope)) },
		network: {
			transports: [webSockets(), circuitRelayTransport()] as never,
			listenAddrs: [...listen],
			relayAddrs: [...new Set([...config.relays, ...extraRelays])],
			requireRelay: false,
			// Plain ws://, loopback and private addresses are fine to dial: Noise and the pinned
			// peer id decide who answers, as the phone kit allows.
			connectionGater: { denyDialMultiaddr: () => false },
		},
		strandFilter: { mode: 'sAppId', sAppId },
		hibernation: { enabled: false },
		// The tally sApp is unsigned until Taleus signs it at release (`taleusSApp`).
		requireSignedSchemas: false,
		strandReactivity: { enabled: true },
		trustedOwners: { store: await FileTrustedOwnerStore.open(dirs.node, partyId) },
		bootstrapPeers: { store: await FileBootstrapPeerStore.open(dirs.node, partyId) },
		enrolledMachines: { store: await FileEnrolledMachineStore.open(dirs.node, partyId) },
		strandNetworkState: { store: await FileStrandNetworkStateStore.open(dirs.node, partyId) },
	}
}

/**
 * Enroll the node as its own party's owner, as the phone kit does on every start (idempotent):
 * a node must be an owner to found strands and publish invitations.
 */
async function ownerGenesis(node: CadreNode): Promise<void> {
	const key = node.getIdentityOwnerKey()
	const genesis = (async () => {
		await node.getControlDatabase()!.ensureOwnerKey(key.publicKeyB64)
		await node.initializeSeedBootstrap(key.privateKeyB64)
	})()
	let timer: NodeJS.Timeout | undefined
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`owner genesis did not finish in ${OWNER_GENESIS_MS} ms`)), OWNER_GENESIS_MS)
		timer.unref()
	})
	try {
		await Promise.race([genesis, late])
	} finally {
		clearTimeout(timer)
	}
}

/** The party's loopback listen address: its kept port, or a free one chosen now and kept. */
export async function loopbackListenAddress(dirs: PartyDirs, config: PartyConfig): Promise<string> {
	if (!config.listenPort) {
		config.listenPort = await freePort()
		await saveConfig(dirs, config)
	}
	return `/ip4/127.0.0.1/tcp/${config.listenPort}/ws`
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.unref()
		server.on('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo
			server.close(() => resolve(port))
		})
	})
}

/**
 * A slot the engine keeps text in -- its session state, its identity, a contract document -- as one
 * file under the party's `slots/`: `<name>`, or `<name>--<key>` for keyed slots. A missing file is
 * an empty slot.
 */
export function fileSlot(dirs: PartyDirs, name: string, key?: string): DurableSlot {
	const file = join(dirs.slots, key === undefined ? name : `${name}--${encodeURIComponent(key)}`)
	return { load: () => readText(file), save: (text: string) => writeTextAtomic(file, text) }
}

/**
 * The peer id that answers at `address`: what a relay given without its `/p2p/` part is pinned to.
 * Trusts the first answer, so a caller says how the id was learned.
 */
export async function peerAt(node: CadreNode, address: string, timeoutMs = 15_000): Promise<string> {
	const control = node.getControlNode()
	if (!control) throw new Error('the node is not running')
	const connection = await control.dial(multiaddr(address), { signal: AbortSignal.timeout(timeoutMs) })
	return connection.remotePeer.toString()
}

/**
 * Every strand this party holds -- founded (`CadreControl.Strand`) or joined from another party
 * (`CadreControl.JoinedStrand`) -- by id: what a restarted node will launch. The node offers them
 * from its watcher's first poll, which runs a moment after `start()` resolves, so a caller that must
 * not act before its strands are back (a one-shot CLI command) waits for these ids.
 */
export async function heldStrandIds(node: CadreNode): Promise<string[]> {
	const control = node.getControlDatabase()
	if (!control) return []
	const [founded, joined] = await Promise.all([control.queryStrands(), control.queryJoinedStrands()])
	return [...new Set([...founded, ...joined].map(row => row.Id))]
}
