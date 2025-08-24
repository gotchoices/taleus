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
import { SessionManager, type BootstrapLink, type ProvisionResult } from '../../src/tallyBootstrap.js'
import { createSessionAwareHooks, type SessionHooks } from '../auto/helpers/consumerMocks.js'
import { writeFileSync } from 'node:fs'

type PartyRole = 'stock' | 'foil'
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

  // SessionManager with hooks for demo
  let used = false
  const hooks: SessionHooks = {
    async validateToken(tok, sessionId) {
      if (tok !== token) return { valid: false, role: 'stock' }
      console.log(`[A] validateToken: ${tok} (session: ${sessionId})`)
      return { valid: true, role }
    },
    async validateIdentity(identity, sessionId) {
      console.log(`[A] validateIdentity: ${JSON.stringify(identity)} (session: ${sessionId})`)
      return true
    },
    async provisionDatabase(createdBy, partyA, partyB, sessionId) {
      console.log(`[A] provisionDatabase by ${createdBy}: ${partyA} ↔ ${partyB} (session: ${sessionId})`)
      // Demo DB record
      const tallyId = `demo-${Date.now()}`
      const result: ProvisionResult = {
        tally: { tallyId, createdBy },
        dbConnectionInfo: { endpoint: `quereus://127.0.0.1/${tallyId}`, credentialsRef: `cred-${tallyId}` }
      }
      console.log('[A] provisioning complete:', result)
      return result
    },
    async validateResponse(response, sessionId) {
      console.log(`[A] validateResponse (session: ${sessionId}):`, response)
      return true
    },
    async validateDatabaseResult(result, sessionId) {
      console.log(`[A] validateDatabaseResult (session: ${sessionId}):`, result)
      return true
    }
  }

  const sessionManager = new SessionManager(hooks, { 
    enableDebugLogging: true,
    sessionTimeoutMs: 30000,
    stepTimeoutMs: 10000,
    maxConcurrentSessions: 5
  })

  // Register the bootstrap protocol handler
  node.handle('/taleus/bootstrap/1.0.0', async ({ stream }) => {
    console.log('[A] Incoming bootstrap request...')
    await sessionManager.handleNewStream(stream as any)
    console.log('[A] Bootstrap session completed')
  })

  // Compose link and emit for dialer
  const link: BootstrapLink = {
    responderPeerAddrs: node.getMultiaddrs().map(a => a.toString()),
    token,
    tokenExpiryUtc: new Date(Date.now() + ttlMs).toISOString(),
    initiatorRole: role
  }

  writeFileSync(outPath, JSON.stringify(link, null, 2), 'utf-8')
  console.log('\nLink written to', outPath)
  console.log('Link JSON:')
  console.log(JSON.stringify(link, null, 2))

  const sample = `npx tsx test/manual/bootstrap-dial.ts --link ${outPath}`
  console.log('\nTo start the responder (B), run:')
  console.log(sample)

  console.log('\nPress Ctrl+C to stop the listener.')
  // Keep process alive
  process.stdin.resume()
}

main().catch(err => { console.error(err); process.exit(1) })


