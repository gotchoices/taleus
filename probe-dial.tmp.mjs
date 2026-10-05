import { generateKeyPair } from '@libp2p/crypto/keys'
import { webSockets } from '@libp2p/websockets'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { MemoryRawStorage } from '@optimystic/db-p2p'
import { CadreNode } from '@serfab/cadre-core'
import { multiaddr } from '@multiformats/multiaddr'
const node = new CadreNode({
	controlNetwork: { partyId: `probe-${Date.now()}`, bootstrapNodes: [] }, profile: 'transaction', strandFilter: { mode: 'all' }, hostUnclaimedStrands: false,
	storage: { provider: () => new MemoryRawStorage() }, privateKey: await generateKeyPair('Ed25519'),
	network: { transports: [webSockets(), circuitRelayTransport()], listenAddrs: [], connectionGater: { denyDialMultiaddr: () => false } },
	hibernation: { enabled: false }, requireSignedSchemas: false,
})
await node.start()
for (const peer of process.argv.slice(2)) {
	const addr = `/ip4/127.0.0.1/tcp/4002/ws/p2p/12D3KooWKYBa4PwUhac6SE6YDUv1NvYDz87D8DtYQ8f4uDP471Zz/p2p-circuit/p2p/${peer}`
	const t = Date.now()
	try { await node.getControlNode().dial(multiaddr(addr), { signal: AbortSignal.timeout(20000) }); console.log('REACHED', peer, Date.now() - t, 'ms') }
	catch (e) { console.log('UNREACHABLE', peer, Date.now() - t, 'ms', e.message.slice(0, 160)) }
}
await node.stop(); process.exit(0)
