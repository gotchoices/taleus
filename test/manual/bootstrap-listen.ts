/*
Taleus manual demo (listener)

What this does
- Starts a libp2p node on 127.0.0.1
- Registers the tally bootstrap protocol as the Initiator (party A)
- Prints a JSON "link" and a ready-to-copy command to launch the Responder

Usage (defaults shown in brackets)
- tsx test/manual/bootstrap-listen.ts --role stock --token demo-abc --ttl 600000 --out /tmp/tally-link.json

Notes
- Role 'stock' means A will provision the DB on approval
- Role 'foil' means B will provision the DB and report back to A
*/

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'
import { TallyBootstrap, type PartyRole, type ProvisionResult } from '../../src/tallyBootstrap.js'
import { writeFileSync } from 'node:fs'

type Args = { role: PartyRole; token: string; ttlMs: number; outPath: string }

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const get = (name: string, def?: string) => {
    const idx = argv.indexOf(`--${name}`)
    return idx >= 0 ? argv[idx + 1] : def
  }
  const role = (get('role', 'stock') as PartyRole)
  const token = get('token', 'demo-abc')!
  const ttlMs = parseInt(get('ttl', '600000')!, 10)
  const outPath = get('out', '/tmp/tally-link.json')!
  return { role, token, ttlMs, outPath }
}

async function main() {
  const { role, token, ttlMs, outPath } = parseArgs()

  console.log('Starting libp2p listener...')
  const node = await createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [mplex()],
    peerDiscovery: []
  })
  await node.start()

  console.log(`Node started: ${node.peerId.toString()}`)
  console.log('Listening multiaddrs:')
  node.getMultiaddrs().forEach(ma => console.log(' -', ma.toString()))

  // In-memory hooks for demo
  let used = false
  const bootstrap = new TallyBootstrap({
    async getTokenInfo(tok) {
      if (tok !== token) return null
      const expiryUtc = new Date(Date.now() + ttlMs).toISOString()
      return { initiatorRole: role, expiryUtc }
    },
    async validateIdentity(identity) {
      console.log('[A] validateIdentity:', identity)
      return true
    },
    async markTokenUsed(tok) {
      if (tok === token) used = true
      console.log('[A] markTokenUsed:', tok, 'used =', used)
    },
    async provisionDatabase(createdBy, initiatorPeerId, respondentPeerId) {
      console.log(`[A] provisionDatabase by ${createdBy}:`, { initiatorPeerId, respondentPeerId })
      // Demo DB record
      const tallyId = `demo-${Date.now()}`
      const result: ProvisionResult = {
        tally: { tallyId, createdBy },
        dbConnectionInfo: { endpoint: `quereus://127.0.0.1/${tallyId}`, credentialsRef: `cred-${tallyId}` }
      }
      console.log('[A] provisioning complete:', result)
      return result
    }
  })

  bootstrap.registerPassiveListener(node, { role, getParticipatingCadrePeerAddrs: () => node.getMultiaddrs().map(a => a.toString()) })

  // Compose link and emit for dialer
  const link = {
    responderPeerAddrs: node.getMultiaddrs().map(a => a.toString()),
    token,
    tokenExpiryUtc: new Date(Date.now() + ttlMs).toISOString(),
    initiatorRole: role
  }

  writeFileSync(outPath, JSON.stringify(link, null, 2), 'utf-8')
  console.log('\nLink written to', outPath)
  console.log('Link JSON:')
  console.log(JSON.stringify(link, null, 2))

  const sample = `tsx test/manual/bootstrap-dial.ts --link ${outPath}`
  console.log('\nTo start the responder (B), run:')
  console.log(sample)

  console.log('\nPress Ctrl+C to stop the listener.')
  // Keep process alive
  process.stdin.resume()
}

main().catch(err => { console.error(err); process.exit(1) })


