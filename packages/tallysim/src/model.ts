/**
 * The network data model: plain, JSON-serialisable data describing a graph of **entities** (nodes)
 * joined by **tallies** (edges). A tally is one credit relationship between two entities. The model is
 * deliberately inert — it is built by the generators (`generators/`), searched by the later oracle tier,
 * and read by the structural utilities (`structure.ts`); it carries no behaviour itself.
 *
 * Entities are **index-based**: an entity is just an integer id in `0 .. entityCount - 1`. No per-entity
 * payload is needed at this tier, so there is no `Entity` object — {@link EntityId} is a plain number.
 *
 * ── Serialisation and `Infinity` ─────────────────────────────────────────────────────────────────
 * A credit limit of `Infinity` means *unbounded* (the "unlimited capacity" experiment variant).
 * `JSON.stringify` turns `Infinity` into `null`, so {@link serialize} / {@link deserialize} map
 * `Infinity` ↔ the JSON value `null` on the two credit-limit fields, letting a saved scenario round-trip
 * exactly (including unlimited limits and an empty network). See `docs/design.md` § Model.
 */

/** An entity is a node, identified by an integer id in `0 .. entityCount - 1`. */
export type EntityId = number

/**
 * A credit relationship between two entities — one edge. Multiple tallies between the same pair are
 * allowed (two tallies are two edges). Generators produce no self-loops (`stock !== foil`) unless
 * explicitly asked for them.
 *
 * `balance` (`b`) is measured from the foil's obligation: the units the foil currently owes the stock,
 * signed, so `b ∈ [-foilCreditLimit, +stockCreditLimit]`. The two credit limits bound how far each side
 * lets the other owe it. See `capacity.ts` for how a balance and the two limits yield directed capacity.
 */
export interface Tally {
	/** Entity id of the stock holder (conventionally the creditor side). */
	stock: EntityId
	/** Entity id of the foil holder (conventionally the debtor side). */
	foil: EntityId
	/** `b`: units the foil currently owes the stock (signed). `b ∈ [-foilCreditLimit, +stockCreditLimit]`. */
	balance: number
	/** `L_stock`: how far the stock lets the foil owe it — the upper bound on `b`. `Infinity` = unbounded. */
	stockCreditLimit: number
	/** `L_foil`: how far the foil lets the stock owe it — the lower bound `b >= -L_foil`. `Infinity` = unbounded. */
	foilCreditLimit: number
}

/** Provenance of a {@link Network}: which generator built it, with which params and seed. */
export interface NetworkMeta {
	/** Generator id, e.g. `'uniform' | 'scale-free' | 'clustered' | 'small-world'`. */
	generator: string
	/** The generator's numeric structural params (not the capacity distribution, which is an object). */
	params: Record<string, number>
	/** The seed the network was generated from. Same seed + same params ⇒ byte-identical network. */
	seed: number
	/** Bumped when the on-disk shape changes; {@link deserialize} checks it. */
	formatVersion: number
}

/** A whole network: a count of entities and the tallies (edges) between them, plus provenance. */
export interface Network {
	entityCount: number
	tallies: Tally[]
	meta: NetworkMeta
}

/** The current on-disk format version. Bump when {@link Network}'s serialised shape changes. */
export const FORMAT_VERSION = 1

/**
 * The on-disk shape of a {@link Tally}: identical except the two credit limits are `number | null`,
 * where `null` is the sentinel for `Infinity` (which `JSON.stringify` cannot represent).
 */
interface SerializedTally {
	stock: number
	foil: number
	balance: number
	stockCreditLimit: number | null
	foilCreditLimit: number | null
}

interface SerializedNetwork {
	entityCount: number
	tallies: SerializedTally[]
	meta: NetworkMeta
}

/** `Infinity` → `null`; every finite number passes through unchanged. */
function limitToJson(limit: number): number | null {
	return limit === Infinity ? null : limit
}

/** `null` → `Infinity`; every number passes through unchanged. */
function limitFromJson(limit: number | null): number {
	return limit === null ? Infinity : limit
}

/**
 * Serialise a network to a JSON string, mapping `Infinity` credit limits to `null` so they survive the
 * round-trip. Fields are written in a fixed order so the output is deterministic for a given network.
 */
export function serialize(network: Network): string {
	const serialized: SerializedNetwork = {
		entityCount: network.entityCount,
		tallies: network.tallies.map((tally) => ({
			stock: tally.stock,
			foil: tally.foil,
			balance: tally.balance,
			stockCreditLimit: limitToJson(tally.stockCreditLimit),
			foilCreditLimit: limitToJson(tally.foilCreditLimit),
		})),
		meta: {
			generator: network.meta.generator,
			params: network.meta.params,
			seed: network.meta.seed,
			formatVersion: network.meta.formatVersion,
		},
	}
	return JSON.stringify(serialized)
}

/**
 * Parse a network from a {@link serialize} string, mapping the `null` credit-limit sentinel back to
 * `Infinity`. Throws if the format version is one this build does not understand.
 */
export function deserialize(text: string): Network {
	const parsed = JSON.parse(text) as SerializedNetwork
	if (parsed.meta.formatVersion !== FORMAT_VERSION) {
		throw new Error(
			`deserialize: unsupported formatVersion ${String(parsed.meta.formatVersion)} (this build reads ${FORMAT_VERSION})`,
		)
	}
	return {
		entityCount: parsed.entityCount,
		tallies: parsed.tallies.map((tally) => ({
			stock: tally.stock,
			foil: tally.foil,
			balance: tally.balance,
			stockCreditLimit: limitFromJson(tally.stockCreditLimit),
			foilCreditLimit: limitFromJson(tally.foilCreditLimit),
		})),
		meta: parsed.meta,
	}
}
