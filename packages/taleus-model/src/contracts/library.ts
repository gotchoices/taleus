/**
 * The contracts a party's tallies are made under: where their documents come from, and the
 * guarantee that every copy is the document its CID names.
 *
 * A tally signs only its contract's CID; the documents themselves travel in the tally
 * (`App.Document`), are kept on the device, and are published by their authors. A document is
 * looked for in that order -- the tally, this device, then each known source -- and is used only
 * if its bytes hash to its CID, so no source has to be trusted. Whatever is found is kept, so a
 * party holds every contract it has seen.
 */
import { type Composed, compose, HttpResolver, type Resolver } from '@stroc/compose'
import { verifyDocument, type StrocDocument, type StrocSection } from '@stroc/core'
import type { StoredDocument, Tally } from 'taleus-core'
import type { DurableText } from '../engine/session.js'
import { CID } from 'multiformats/cid'

/**
 * The slice of `fetch` documents are read with. Every platform Taleus runs on has `fetch`, but the
 * model compiles without DOM types, so it names only what it uses.
 */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>

export interface FetchResponse {
	ok: boolean
	status: number
	json(): Promise<unknown>
	arrayBuffer(): Promise<ArrayBuffer>
}

/** The platform's `fetch`. */
export function platformFetch(): Fetch {
	const { fetch } = globalThis as { fetch?: Fetch }
	if (!fetch) throw new Error('this platform has no fetch')
	return (url, init) => fetch(url, init)
}

/** This device's copies of documents, by CID. */
export interface DocumentCache {
	get(cid: string): Promise<string | undefined>
	put(document: StoredDocument): Promise<void>
}

export class MemoryDocumentCache implements DocumentCache {
	private readonly documents = new Map<string, string>()

	async get(cid: string): Promise<string | undefined> {
		return this.documents.get(cid)
	}

	async put(document: StoredDocument): Promise<void> {
		this.documents.set(document.cid, document.json)
	}
}

/** A cache over the host's durable storage: one slot per document (LevelDB on the phone). */
export function slotDocumentCache(slot: (cid: string) => DurableText): DocumentCache {
	return {
		get: cid => slot(cid).load(),
		put: document => slot(document.cid).save(document.json),
	}
}

export interface ContractLibraryOptions {
	/** The domains documents may be fetched from, in order (sereus.org to start with). */
	sources: () => readonly string[]
	cache?: DocumentCache
	/** The HTTP client; the platform's `fetch` by default. */
	fetch?: Fetch
}

/** A contract with all its documents, or the CIDs it could not find. */
export interface Gathered {
	documents: StoredDocument[]
	missing: string[]
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export class ContractLibrary {
	private readonly cache: DocumentCache

	constructor(private readonly options: ContractLibraryOptions) {
		this.cache = options.cache ?? new MemoryDocumentCache()
	}

	/** One document, verified: from `tally` if given, else this device, else a source. */
	async document(cid: string, tally?: Tally): Promise<StoredDocument | undefined> {
		const found = (await this.fromTally(cid, tally)) ?? (await this.fromCache(cid)) ?? (await this.fromSources(cid))
		if (found) await this.cache.put(found)
		return found
	}

	/**
	 * A contract and every document it includes, as an offer stores them in a tally. A
	 * contract with any part missing is not one a party can read, so `missing` lists what was not
	 * found and `documents` is then incomplete.
	 */
	async gather(root: string, tally?: Tally): Promise<Gathered> {
		const documents = new Map<string, StoredDocument>()
		const missing: string[] = []
		const queue = [root]
		while (queue.length > 0) {
			const cid = queue.shift()!
			if (documents.has(cid) || missing.includes(cid)) continue
			const found = await this.document(cid, tally)
			if (!found) {
				missing.push(cid)
				continue
			}
			documents.set(cid, found)
			queue.push(...includesOf((await decoded(found))!))
		}
		return { documents: [...documents.values()], missing }
	}

	/** The contract composed into one numbered tree, its includes resolved through this library. */
	compose(root: string, tally?: Tally): Promise<Composed> {
		return compose(root, this.resolver(tally))
	}

	/** The root document itself, for its title, author and language. */
	async describe(cid: string, tally?: Tally): Promise<StrocDocument | undefined> {
		const found = await this.document(cid, tally)
		return found ? decoded(found) : undefined
	}

	/** This library as a Stroc resolver, for composing and rendering. */
	resolver(tally?: Tally): Resolver {
		return {
			get: async (cid: CID) => {
				const found = await this.document(cid.toString(), tally)
				return found ? encoder.encode(found.json) : undefined
			},
		}
	}

	private async fromTally(cid: string, tally?: Tally): Promise<StoredDocument | undefined> {
		const held = tally ? await tally.document(cid) : undefined
		return held && (await decoded(held)) ? held : undefined
	}

	private async fromCache(cid: string): Promise<StoredDocument | undefined> {
		const json = await this.cache.get(cid)
		const held = json === undefined ? undefined : { cid, json }
		return held && (await decoded(held)) ? held : undefined
	}

	private async fromSources(cid: string): Promise<StoredDocument | undefined> {
		for (const domain of this.options.sources()) {
			const bytes = await this.fetchFrom(domain, cid)
			const fetched = bytes ? { cid, json: decoder.decode(bytes) } : undefined
			if (fetched && (await decoded(fetched))) return fetched
		}
		return undefined
	}

	private async fetchFrom(domain: string, cid: string): Promise<Uint8Array | undefined> {
		try {
			const fetch = this.options.fetch ?? platformFetch()
			return await new HttpResolver(`https://${domain}`, { fetch: fetch as never }).get(CID.parse(cid))
		} catch (error) {
			console.warn(`taleus-model: fetching ${cid} from ${domain} failed:`, error)
			return undefined
		}
	}
}

/**
 * The document a copy holds, if the copy is the document its CID names; undefined if not. A copy
 * that is not is never used, or kept.
 */
async function decoded(document: StoredDocument): Promise<StrocDocument | undefined> {
	const result = await verifyDocument(encoder.encode(document.json), document.cid)
	return result.ok ? result.document : undefined
}

/** The CIDs of the documents `document` includes, at any depth of its own sections. */
function includesOf(document: StrocDocument): string[] {
	const found: string[] = []
	const walk = (sections: readonly StrocSection[] | undefined) => {
		for (const section of sections ?? []) {
			if ('source' in section) found.push(section.source.toString())
			else walk(section.sections)
		}
	}
	walk(document.sections)
	return found
}
