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
import { TallyBootstrap } from '../../src/tallyBootstrap.js'

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
  const link = JSON.parse(readFileSync(linkPath, 'utf-8'))
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

  // Minimal hooks for dialer
  const bootstrap = new TallyBootstrap({
    async getTokenInfo() { return null }, // not used on dialer side
    async provisionDatabase(createdBy, initiatorPeerId, respondentPeerId) {
      console.log(`[B] provisionDatabase by ${createdBy}:`, { initiatorPeerId, respondentPeerId })
      const tallyId = `demo-${Date.now()}`
      const result = {
        tally: { tallyId, createdBy },
        dbConnectionInfo: { endpoint: `quereus://127.0.0.1/${tallyId}`, credentialsRef: `cred-${tallyId}` }
      }
      console.log('[B] provisioning complete:', result)
      return result
    }
  } as any)

  const res = await bootstrap.initiateFromLink(link, node, { identityBundle: identity, idempotencyKey: 'manual-1' })
  console.log('Bootstrap result:', res)

  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })


