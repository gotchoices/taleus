/** party: shapes and policy shared by every implementation of the model. */
import type { Instant, Result } from './types.js'

/**
 * Something of this party's that can act as them (story 13).
 *
 * A party is not one device: several can act for the same person, and what a
 * party can do while nobody is holding anything depends on at least one of them
 * being available.
 */
export interface Device {
	id: string
	/** The party's own name for it. Meaningful to them, not to a machine. */
	name: string
	/** What it is to a person — not what it is to a machine. */
	kind: 'phone' | 'tablet' | 'node'
	lastActive: Instant
	/** A device that stays reachable — a node rather than a phone. */
	alwaysOn?: boolean
	/** The one in the party's hand. */
	thisDevice?: boolean
	/**
	 * Story 14's split: `durability` is a copy of the party's own records,
	 * `availability` is something that stays on. A phone gives the first and not
	 * the second.
	 */
	contributes: ('durability' | 'availability')[]
	/** A provider's name, or null for a machine the party runs themselves. */
	hostedBy?: string | null
	/** When it last took part in settling — story 13 step 7. */
	lastParticipated?: Instant
	/** False when it cannot be reached right now. Never a guess about why. */
	reachable?: boolean
	retired?: boolean
}

/**
 * Who this party is, from their own side (stories 10, 11, 42).
 *
 * `null` is a real answer, not an error: before first run completes there is no
 * identity, and that is the state story 10 is about.
 */
export interface Party {
	sid: string
	/** Empty until the party chooses one — story 10 step 5. */
	displayName: string
	displayUnit: string
	disclosed: Record<string, string>
	devices: Device[]
}

/** What a screen can read and do about party. Both the mock and the engine implement it. */
export interface PartyModel {
	readParty(): Promise<Result<Party | null>>
	/**
	 * Story 10 step 3: the app does this. There is no key ceremony to walk the
	 * party through, no algorithm to choose, and nothing to name — they are told it
	 * happened rather than asked to do it. Story 10 path C: it needs no network.
	 */
	createIdentity(): Promise<Result<Party>>
	/** Story 10 step 5: the one thing asked for up front. */
	setDisplayName(name: string): Promise<Result<Party>>
}
