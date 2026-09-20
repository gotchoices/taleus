import {
	digest,
	newKey,
	sidFor,
	signText,
	type KeyPairText,
} from '../store/index.js'
import {
	Tally,
	newInvitation,
	newParty,
	type Party,
} from '../store/test-harness.js'
import { seatFoil, seatStock } from './formation.js'
import { addKey, adoptKey, revokeKey } from './keys.js'

/**
 * Keys, on a strand two parties share.
 *
 * A party's key set is its own business, but it is not private: every add and every
 * revocation is replicated, and the counterparty's engine validates it. That is what makes
 * a stolen key containable -- Sam's node refuses a chit signed by a key Jan revoked,
 * without Sam having to notice. So even the tests that look single-party run on two
 * replicas; the interesting assertion is usually what the *other* party's engine does.
 *
 * Adoption is the exception that proves it: a party who has lost every device has nothing
 * left to sign with, and only the counterparty can vouch for them.
 */

async function seated() {
	const jan = newParty('jan')
	const sam = newParty('sam')
	const invitation = newInvitation()
	const tally = await Tally.open([jan, sam])
	await tally.propose(seatStock({ sid: jan.sid, genesis: jan.keys[0], invitation }))
	await tally.propose(seatFoil({ sid: sam.sid, genesis: sam.keys[0], invitation }))
	return { jan, sam, tally }
}

const authorized = (tally: Tally, party: Party, of: Party) =>
	tally.sees<{ PublicKey: string }>(party, 'select PublicKey from AuthorizedKey where Sid = ?', [
		of.sid,
	])

describe('adding a key', () => {
	it('an authorized key admits another, and the counterparty’s engine agrees', async () => {
		const { jan, sam, tally } = await seated()
		const tablet = newKey()
		await tally.propose([addKey({ sid: jan.sid, key: tablet, by: jan.keys[0], revision: 2 })])

		// Sam's node now accepts Jan's tablet as Jan, without Sam doing anything.
		await expect(authorized(tally, sam, jan)).resolves.toHaveLength(2)
		await expect(authorized(tally, jan, jan)).resolves.toHaveLength(2)
	})

	it('a key cannot admit itself', async () => {
		const { jan, tally } = await seated()
		const rogue = newKey()
		// Naming itself as the authorizer would mint authority from nothing. The check reads
		// the committed snapshot precisely so the in-flight row cannot vouch for itself.
		await expect(
			tally.refuses([addKey({ sid: jan.sid, key: rogue, by: rogue, revision: 2 })]),
		).resolves.toMatch(/AuthKeyAuthorized/)
	})

	it('a stranger’s key cannot admit one', async () => {
		const { jan, sam, tally } = await seated()
		const rogue = newKey()
		// Sam is authorized -- for Sam. Authority does not cross the party boundary.
		await expect(
			tally.refuses([addKey({ sid: jan.sid, key: rogue, by: sam.keys[0], revision: 2 })]),
		).resolves.toMatch(/AuthKeyAuthorized/)
	})

	it('revisions are contiguous: no gaps, no reuse', async () => {
		const { jan, tally } = await seated()
		await expect(
			tally.refuses([addKey({ sid: jan.sid, key: newKey(), by: jan.keys[0], revision: 3 })]),
		).resolves.toMatch(/RevisionMonotonic/)

		await tally.propose([addKey({ sid: jan.sid, key: newKey(), by: jan.keys[0], revision: 2 })])
		// Revision 2 is spent; a second one collides on the primary key.
		await expect(
			tally.refuses([addKey({ sid: jan.sid, key: newKey(), by: jan.keys[0], revision: 2 })]),
		).resolves.toMatch(/UNIQUE constraint failed: PartyKey/)
	})

	it('the same key cannot be registered twice', async () => {
		const { jan, tally } = await seated()
		await expect(
			tally.refuses([addKey({ sid: jan.sid, key: jan.keys[0], by: jan.keys[0], revision: 2 })]),
		).resolves.toMatch(/UniqueKey/)
	})
})

describe('revoking a key', () => {
	async function withTablet() {
		const world = await seated()
		const tablet = newKey()
		await world.tally.propose([
			addKey({ sid: world.jan.sid, key: tablet, by: world.jan.keys[0], revision: 2 }),
		])
		return { ...world, tablet }
	}

	it('a surviving device retires a lost one, and both engines stop accepting it', async () => {
		const { jan, sam, tally, tablet } = await withTablet()
		await tally.propose([revokeKey({ sid: jan.sid, publicKey: tablet.publicKey, by: jan.keys[0] })])

		for (const party of [jan, sam]) {
			const keys = await authorized(tally, party, jan)
			expect(keys.map(k => k.PublicKey)).toEqual([jan.keys[0].publicKey])
		}
	})

	it('a revoked key cannot authorize anything afterwards', async () => {
		const { jan, tally, tablet } = await withTablet()
		await tally.propose([revokeKey({ sid: jan.sid, publicKey: tablet.publicKey, by: jan.keys[0] })])
		// The thief still holds the key; it buys them nothing from here on.
		await expect(
			tally.refuses([addKey({ sid: jan.sid, key: newKey(), by: tablet, revision: 3 })]),
		).resolves.toMatch(/AuthKeyAuthorized/)
	})

	it('a revoked key cannot revoke', async () => {
		const { jan, tally, tablet } = await withTablet()
		await tally.propose([revokeKey({ sid: jan.sid, publicKey: tablet.publicKey, by: jan.keys[0] })])
		await expect(
			tally.refuses([
				revokeKey({ sid: jan.sid, publicKey: jan.keys[0].publicKey, by: tablet }),
			]),
		).resolves.toMatch(/RevokerAuthorized/)
	})

	it('a revoked key can never be re-added', async () => {
		const { jan, tally, tablet } = await withTablet()
		await tally.propose([revokeKey({ sid: jan.sid, publicKey: tablet.publicKey, by: jan.keys[0] })])
		// The PartyKey row is insert-only and stays, so a re-add makes the count two.
		await expect(
			tally.refuses([addKey({ sid: jan.sid, key: tablet, by: jan.keys[0], revision: 3 })]),
		).resolves.toMatch(/UniqueKey/)
	})

	it('a key cannot revoke itself, so the last key survives', async () => {
		const { jan, tally } = await seated()
		// The live AuthorizedKey view already excludes this in-flight revocation, so a key
		// naming itself as the revoker is not authorized by the time the check runs.
		// Retire a device from another surviving device; self-revocation is not a path.
		await expect(
			tally.refuses([
				revokeKey({ sid: jan.sid, publicKey: jan.keys[0].publicKey, by: jan.keys[0] }),
			]),
		).resolves.toMatch(/RevokerAuthorized/)
	})

	it('a batch that would empty the set is refused — but not by the guard meant for it', async () => {
		const { jan, tally, tablet } = await withTablet()
		const reason = await tally.refuses([
			revokeKey({ sid: jan.sid, publicKey: tablet.publicKey, by: jan.keys[0] }),
			revokeKey({ sid: jan.sid, publicKey: jan.keys[0].publicKey, by: tablet }),
		])
		// FINDING: `NotLastKey` is what the schema wrote for this, and it never runs. The
		// first revocation drops `tablet` out of the live AuthorizedKey view, so the second
		// one -- signed BY tablet -- fails RevokerAuthorized first. The set is protected, by
		// a different rule than the one intended.
		expect(reason).toMatch(/RevokerAuthorized/)
		await expect(authorized(tally, jan, jan)).resolves.toHaveLength(2)
	})

	it('FINDING: NotLastKey is unreachable in process, so the guarantee rests on the transactor', async () => {
		// Every route to an empty authorized set is closed earlier:
		//   - self-revocation      -> RevokerAuthorized (the revoker is already excluded)
		//   - a batch, in order    -> RevokerAuthorized (the first revocation excludes the
		//                             second's signer)
		// What `NotLastKey` was written for is the case this harness structurally cannot
		// reach: two CONCURRENT, independent transactions -- device A revokes B while device
		// B revokes A. Each alone leaves one key; together they leave none, and they collide
		// on no primary key.
		//
		// So the last-key guarantee depends entirely on Optimystic re-evaluating the deferred
		// CHECK against the latest committed snapshot at each commit. The schema's own NOTE
		// says so. It is listed unconfirmed in docs/STATUS.md § Cross-repo, and this test
		// exists to keep it from being forgotten.
		const { jan, tally, tablet } = await withTablet()
		await tally.propose([revokeKey({ sid: jan.sid, publicKey: tablet.publicKey, by: jan.keys[0] })])
		// One key left, and the only key that could revoke it is itself.
		await expect(authorized(tally, jan, jan)).resolves.toHaveLength(1)
	})
})

describe('adoption: getting back in after losing everything', () => {
	it('the counterparty attests a fresh key, and the party can act again', async () => {
		const { jan, sam, tally } = await seated()
		// Jan has lost every device. He has no key to sign with, which is exactly why this
		// ceremony exists: only Sam can vouch for him.
		const recovered = newKey()
		await tally.propose([
			adoptKey({ sid: jan.sid, key: recovered, counterparty: sam.keys[0] }),
		])

		for (const party of [jan, sam]) {
			const keys = await authorized(tally, party, jan)
			expect(keys.map(k => k.PublicKey)).toContain(recovered.publicKey)
		}
	})

	it('an adopted key can authorize fresh device keys', async () => {
		const { jan, sam, tally } = await seated()
		const recovered = newKey()
		await tally.propose([adoptKey({ sid: jan.sid, key: recovered, counterparty: sam.keys[0] })])

		// Without this, an adopted key could sign rows but never rebuild the set, and
		// recovery would stop one step short of being recovery.
		const replacement = newKey()
		await tally.propose([
			addKey({ sid: jan.sid, key: replacement, by: recovered, revision: 2 }),
		])
		await expect(authorized(tally, sam, jan)).resolves.toHaveLength(3)
	})

	it('a party cannot attest for itself', async () => {
		const { jan, tally } = await seated()
		const recovered = newKey()
		// Self-attestation would make the ceremony worthless: anyone holding a fresh key
		// could claim any identity on the strand.
		await expect(
			tally.refuses([adoptKey({ sid: jan.sid, key: recovered, counterparty: jan.keys[0] })]),
		).resolves.toMatch(/CounterpartyIsOther/)
	})

	it('the fresh key must prove it is held', async () => {
		const { jan, sam, tally } = await seated()
		const recovered = newKey()
		const somebodyElse = newKey()
		const write = adoptKey({ sid: jan.sid, key: recovered, counterparty: sam.keys[0] })
		// Sam attests a key nobody has demonstrated possession of. The self-signature is the
		// half of the ceremony Sam cannot supply.
		await expect(
			tally.refuses([
				{
					...write,
					row: {
						...write.row,
						SelfSignature: signText(somebodyElse, digest(jan.sid, recovered.publicKey)),
					},
				},
			]),
		).resolves.toMatch(/SelfSigValid/)
	})

	it('an adopted key is revocable like any other', async () => {
		const { jan, sam, tally } = await seated()
		const recovered = newKey()
		await tally.propose([adoptKey({ sid: jan.sid, key: recovered, counterparty: sam.keys[0] })])
		await tally.propose([
			revokeKey({ sid: jan.sid, publicKey: recovered.publicKey, by: jan.keys[0] }),
		])
		const keys = await authorized(tally, sam, jan)
		expect(keys.map(k => k.PublicKey)).not.toContain(recovered.publicKey)
	})
})

describe('what a Sid is', () => {
	it('is the content address of the genesis key, by construction', () => {
		const party = newParty('anybody')
		expect(party.sid).toBe(sidFor(party.keys[0].publicKey))
	})

	it('FINDING: the schema does not hold anyone to that', async () => {
		// `docs/architecture.md` says the Sid IS "the hash of the genesis (Revision 1) public
		// key", and `PartyKey.Sid`'s own comment repeats it. Nothing enforces it. A party may
		// seat under any Sid it likes.
		//
		// Within one strand this is contained: every signature is checked against keys
		// registered ON THIS STRAND, so a squatter cannot act as the party they are naming.
		// What it costs is the Sid's portability -- the claim "this is the same party you
		// dealt with elsewhere" is exactly what a content address is for, and an unchecked
		// one carries no weight.
		//
		// Recorded rather than fixed: adding `SidIsGenesisDigest` means fixing the Sid's
		// encoding across the whole system, which is Nate's call. See test/STATUS.md § 0.
		const invitation = newInvitation()
		const impostor: Party = { sid: 'sid:not-a-digest-of-anything', keys: [newKey()] }
		const tally = await Tally.open([impostor])
		await expect(
			tally.propose(seatStock({ sid: impostor.sid, genesis: impostor.keys[0], invitation })),
		).resolves.toBeUndefined()
	})
})

/** Unused import guard: `KeyPairText` documents the shape the helpers pass around. */
export type { KeyPairText }
