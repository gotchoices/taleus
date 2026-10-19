/**
 * One party, running: its node from its folder (`taleus-sereus/node`) and the engine over it -- the
 * same composition the phone's `engine-cadre.ts` makes over the phone kit's node. Relays are node
 * start options, so changing them restarts both.
 */
import type { CadreNode } from '@serfab/cadre-core'
import type { TaleusModel } from 'taleus-model'
import { slotDocumentCache } from 'taleus-model/contracts'
import { createEngineModel, type EngineModel } from 'taleus-model/engine'
import { cadreStoreProvider, taleusSApp } from 'taleus-sereus'
import { fileSlot, heldStrandIds, saveConfig, startPartyNode, type PartyConfig, type PartyDirs } from 'taleus-sereus/node'

const SAPP = taleusSApp()

export interface RunningParty {
	readonly dirs: PartyDirs
	readonly config: PartyConfig
	/** The running node; throws before `start` resolves. */
	readonly node: CadreNode
	/** The model over it; throws before `start` resolves. */
	readonly model: TaleusModel
	start(): Promise<void>
	/** Save `relays` and restart the node and engine with them. */
	applyRelays(relays: readonly string[]): Promise<void>
	stop(): Promise<void>
}

export interface PartyOptions {
	dirs: PartyDirs
	config: PartyConfig
	/** Relays for this run, beside the saved ones. */
	extraRelays: readonly string[]
	/** Listen addresses for this run. */
	listen: readonly string[]
	/** Push wakes for the partner's commits (diagnostic switch; on by default). */
	reactivity: boolean
	/** The store's backstop poll, in seconds (0: none); unset, the store's default. */
	pollSeconds?: number
}

export function runningParty(options: PartyOptions): RunningParty {
	const { dirs, config } = options
	let node: CadreNode | undefined
	let engine: EngineModel | undefined

	async function start(): Promise<void> {
		node = await startPartyNode({ dirs, config, sAppId: SAPP.id, extraRelays: options.extraRelays, listen: options.listen, reactivity: options.reactivity })
		engine = await createEngineModel({
			store: cadreStoreProvider({
				node,
				sApp: SAPP,
				disclosure: { purpose: 'tally' },
				...(options.pollSeconds === undefined ? {} : { pollMs: options.pollSeconds * 1000 }),
			}),
			storage: { state: fileSlot(dirs, 'session'), identity: fileSlot(dirs, 'identity') },
			// Every contract document this party has seen, one file each.
			documents: slotDocumentCache(cid => fileSlot(dirs, 'document', cid)),
		})
	}

	async function stop(): Promise<void> {
		const [stoppingEngine, stoppingNode] = [engine, node]
		engine = undefined
		node = undefined
		await stoppingEngine?.stop()
		await stoppingNode?.stop()
	}

	return {
		dirs,
		config,
		get node() {
			if (!node) throw new Error('the node is not running')
			return node
		},
		get model() {
			if (!engine) throw new Error('the party is not running')
			return engine.model
		},
		start,
		async applyRelays(relays) {
			config.relays = [...relays]
			await saveConfig(dirs, config)
			await stop()
			await start()
		},
		stop,
	}
}

/**
 * Give a started party a bounded time to get going before it is asked anything -- its relay
 * reservation (when it has relays), and every strand it holds launched and past starting, so
 * `tallies` finds them: a restarted node offers its strands from a poll that runs a moment after it
 * starts (`heldStrandIds`).
 */
export async function settle(party: RunningParty, ms: number): Promise<void> {
	const deadline = Date.now() + ms
	const held = await heldStrandIds(party.node)
	const busy = () => {
		const node = party.node
		if (party.config.relays.length && node.getRelayReservationState()?.status !== 'reserved') return true
		const launched = node.getStrands()
		return held.some(id => !launched.has(id) || launched.get(id)?.status === 'starting')
	}
	while (Date.now() < deadline && busy()) await new Promise(resolve => setTimeout(resolve, 500))
}
