import { readFileSync } from 'node:fs'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { webSockets } from '@libp2p/websockets'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { MemoryRawStorage } from '@optimystic/db-p2p'
import { CadreNode } from '@serfab/cadre-core'

const token = readFileSync(process.argv[2], 'utf8').trim()
const envelope = JSON.parse(Buffer.from(token.slice('taleus:offer:'.length), 'base64url').toString())
const node = new CadreNode({
	controlNetwork: { partyId: `probe-${Date.now()}`, bootstrapNodes: [] },
	profile: 'transaction', strandFilter: { mode: 'all' }, hostUnclaimedStrands: false,
	storage: { provider: () => new MemoryRawStorage() }, privateKey: await generateKeyPair('Ed25519'),
	network: { transports: [webSockets(), circuitRelayTransport()], listenAddrs: [], connectionGater: { denyDialMultiaddr: () => false } },
	hibernation: { enabled: false }, requireSignedSchemas: false,
})
await node.start()
const invitation = node.decodeInvitation(envelope.ticket.address)
console.log('invitation bootstrap:', JSON.stringify(invitation.bootstrap, null, 1))
const t = Date.now()
try {
	const formed = await node.formStrand(invitation, { purpose: 'probe' })
	console.log('FORMED in', Date.now() - t, 'ms', formed.strandId)
} catch (e) {
	console.log('FAILED in', Date.now() - t, 'ms:', e.name, e.code ?? '', e.message)
}
await node.stop()
process.exit(0)
