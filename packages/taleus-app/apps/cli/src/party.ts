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
import { fileSlot, saveConfig, startPartyNode, type PartyConfig, type PartyDirs } from 'taleus-sereus/node'

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
}

export function runningParty(options: PartyOptions): RunningParty {
	const { dirs, config } = options
	let node: CadreNode | undefined
	let engine: EngineModel | undefined

	async function start(): Promise<void> {
		node = await startPartyNode({ dirs, config, sAppId: SAPP.id, extraRelays: options.extraRelays, listen: options.listen })
		engine = await createEngineModel({
			store: cadreStoreProvider({ node, sApp: SAPP, disclosure: { purpose: 'tally' } }),
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
