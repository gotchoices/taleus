/*
Taleus manual demo (dialer)

What this does
- Starts a libp2p node on 127.0.0.1
- Reads a saved link JSON from disk (written by bootstrap-listen)
- Initiates the tally bootstrap flow and prints the result

Usage (defaults shown in brackets)
- tsx test/manual/bootstrap-dial.ts --link /tmp/tally-link.json --id '{"email":"b@example.com"}'
*/

import { readFileSync } from 'node:fs'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'
import { SessionManager, type BootstrapLink } from '../../src/tallyBootstrap.js'
import { type SessionHooks } from '../auto/helpers/consumerMocks.js'

function parseArgs(): { linkPath: string; identity?: unknown } {
  const argv = process.argv.slice(2)
  const get = (name: string, def?: string) => {
    const idx = argv.indexOf(`--${name}`)
    return idx >= 0 ? argv[idx + 1] : def
  }
  const linkPath = get('link', '/tmp/tally-link.json')!
  const identityStr = get('id', undefined)
  const identity = identityStr ? JSON.parse(identityStr) : undefined
  return { linkPath, identity }
}

async function main() {
  const { linkPath, identity } = parseArgs()
  const link: BootstrapLink = JSON.parse(readFileSync(linkPath, 'utf-8'))
  console.log('Loaded link:', link)

  console.log('Starting libp2p dialer...')
  const node = await createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [mplex()],
    peerDiscovery: []
  })
  await node.start()
  console.log(`Node started: ${node.peerId.toString()}`)

  // SessionManager with hooks for dialer
  const hooks: SessionHooks = {
    async validateToken(token, sessionId) {
      // Not used on dialer side
      return { valid: false, role: 'stock' }
    },
    async validateIdentity(identity, sessionId) {
      console.log(`[B] validateIdentity: ${JSON.stringify(identity)} (session: ${sessionId})`)
      return true
    },
    async provisionDatabase(createdBy, partyA, partyB, sessionId) {
      console.log(`[B] provisionDatabase by ${createdBy}: ${partyA} ↔ ${partyB} (session: ${sessionId})`)
      const tallyId = `demo-${Date.now()}`
      const result = {
        tally: { tallyId, createdBy },
        dbConnectionInfo: { endpoint: `quereus://127.0.0.1/${tallyId}`, credentialsRef: `cred-${tallyId}` }
      }
      console.log('[B] provisioning complete:', result)
      return result
    },
    async validateResponse(response, sessionId) {
      console.log(`[B] validateResponse (session: ${sessionId}):`, response)
      return true
    },
    async validateDatabaseResult(result, sessionId) {
      console.log(`[B] validateDatabaseResult (session: ${sessionId}):`, result)
      return true
    }
  }

  const sessionManager = new SessionManager(hooks, { 
    enableDebugLogging: true,
    sessionTimeoutMs: 30000,
    stepTimeoutMs: 10000,
    maxConcurrentSessions: 5
  })

  console.log('[B] Initiating bootstrap...')
  const res = await sessionManager.initiateBootstrap(link, node)
  console.log('[B] ✅ Bootstrap successful!')
  console.log('Result:', JSON.stringify(res, null, 2))

  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })


