/*
  Taleus Bootstrap POC tests (TDD scaffold)
  - Runs real libp2p nodes locally (loopback) within vitest
  - Exercises Method 6 (Role-Based Link Handshake) flows at a high level
  - Uses in-memory hooks until Quereus/Optimystic are available
*/

import { strict as assert } from 'assert'
import { describe, it, beforeAll as before, afterAll as after, beforeEach } from 'vitest'
import { createLibp2p, Libp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'
import { TallyBootstrap } from '../../src/tallyBootstrap.js'
import { createInMemoryHooks } from './helpers/consumerMocks.js'

// Shared protocol for bootstrap messages
const BOOTSTRAP_PROTOCOL = '/taleus/bootstrap/1.0.0'

type PartyRole = 'stock' | 'foil'

interface BootstrapLinkPayload {
  responderPeerAddrs: string[]
  token: string
  tokenExpiryUtc: string
  initiatorRole: PartyRole
  identityRequirements?: string
}

interface DraftTallyInfo { tallyId: string; createdBy: PartyRole }
interface ProvisionResult {
  tally: DraftTallyInfo
  dbConnectionInfo: { endpoint: string; credentialsRef: string }
}

async function createNode(): Promise<Libp2p> {
  return createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [mplex()],
    peerDiscovery: [],
    connectionGater: {
      denyDialMultiaddr: async (ma) => !ma.toString().includes('/ip4/127.0.0.1/')
    }
  })
}

describe('Taleus Bootstrap (Method 6) – POC', () => {

  let A: Libp2p
  let B1: Libp2p
  let B2: Libp2p
  const hooks = createInMemoryHooks([
    { token: 'one-time-abc', initiatorRole: 'stock', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: true },
    { token: 'one-time-xyz', initiatorRole: 'foil', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: true },
    { token: 'multi-use-qr', initiatorRole: 'stock', expiryUtc: new Date(Date.now() + 300_000).toISOString(), oneTime: false }
  ])
  const bootstrap = new TallyBootstrap(hooks)
  let unregisterA: (() => void) | undefined

  before(async () => {
    A = await createNode()
    B1 = await createNode()
    B2 = await createNode()
    await Promise.all([A.start(), B1.start(), B2.start()])
    // Establish direct connectivity on loopback
    const addrA = A.getMultiaddrs().find(ma => ma.nodeAddress().address === '127.0.0.1')
    const addrB1 = B1.getMultiaddrs().find(ma => ma.nodeAddress().address === '127.0.0.1')
    const addrB2 = B2.getMultiaddrs().find(ma => ma.nodeAddress().address === '127.0.0.1')
    assert(addrA && addrB1 && addrB2)
    await Promise.all([
      B1.dial(addrA),
      B2.dial(addrA),
      A.dial(addrB1),
      A.dial(addrB2)
    ])
    unregisterA = bootstrap.registerPassiveListener(A, { role: 'stock' })
  })

  after(async () => {
    await Promise.allSettled([A?.stop(), B1?.stop(), B2?.stop()])
  })

  beforeEach(() => {})

  describe('One-time token – A (stock) builds on approval', () => {
    it('approves valid respondent and returns DB access with draft tally', async () => {
      // Ensure A is registered as stock for this test
      unregisterA?.()
      unregisterA = bootstrap.registerPassiveListener(A, { role: 'stock' })
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'one-time-abc',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'stock',
        identityRequirements: 'email, phone'
      }

      const result = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'k1' })

      const pr = result as unknown as ProvisionResult
      assert.ok(pr.dbConnectionInfo)
    })
  })

  describe('One-time token – B (foil) builds on approval', () => {
    it('approves valid respondent and B provisions DB with draft tally', async () => {
      unregisterA?.()
      unregisterA = bootstrap.registerPassiveListener(A, { role: 'foil' })
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'one-time-xyz',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'foil'
      }

      const provision = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'k2' })

      const pr = provision as unknown as ProvisionResult
      assert.match(pr.tally.tallyId, /^tally-/)
      assert.equal(pr.tally.createdBy, 'foil')
      assert.ok(pr.dbConnectionInfo.endpoint.includes('127.0.0.1'))
    })
  })

  describe('Multi-use token – provisions unique DB per respondent', () => {
    it('creates separate tallies for two respondents using the same token', async () => {
      unregisterA?.()
      unregisterA = bootstrap.registerPassiveListener(A, { role: 'stock' })
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'multi-use-qr',
        tokenExpiryUtc: new Date(Date.now() + 300_000).toISOString(),
        initiatorRole: 'stock'
      }

      const pr1 = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'k4' }) as unknown as ProvisionResult
      const pr2 = await bootstrap.initiateFromLink(link, B2, { idempotencyKey: 'k5' }) as unknown as ProvisionResult

      assert.ok(pr1.tally.tallyId && pr2.tally.tallyId && pr1.tally.tallyId !== pr2.tally.tallyId)
    })
  })

  describe('Rejection path – missing identity requirements', () => {
    it('rejects with a clear reason if identity is insufficient', async () => {
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'one-time-reject',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'stock',
        identityRequirements: 'email, phone, selfie'
      }

      const failHooks = createInMemoryHooks([
        { token: 'one-time-reject', initiatorRole: 'stock', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: true }
      ], { validateIdentity: () => false })
      const bootstrap2 = new TallyBootstrap(failHooks)
      unregisterA?.()
      unregisterA = bootstrap2.registerPassiveListener(A, { role: 'stock' })

      const result = await bootstrap2.initiateFromLink(link, B1, { idempotencyKey: 'k3' })

      const rej = result as unknown as { approved: false; reason: string }
      // @ts-expect-error
      assert.equal(rej.approved, false)
      // @ts-expect-error
      assert.ok(rej.reason && (rej.reason as string).length > 0)
    })
  })
})


