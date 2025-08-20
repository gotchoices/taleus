/*
  Taleus Bootstrap POC tests (TDD scaffold)
  - Runs real libp2p nodes locally (loopback) within mocha
  - Exercises Method 6 (Role-Based Link Handshake) flows at a high level
  - Uses a Fake DatabaseProvisioner until Quereus/Optimystic are available

  Notes:
  - These tests are initially skipped. Un-skip once the bootstrap module is implemented.
  - Keep networking local to 127.0.0.1; avoid external discovery.
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

// Types (to be replaced by real Taleus interfaces)
type PartyRole = 'stock' | 'foil'

interface BootstrapLinkPayload {
  responderPeerAddrs: string[] // multiaddrs of A's responder nodes (not full cadre)
  token: string
  tokenExpiryUtc: string
  initiatorRole: PartyRole
  identityRequirements?: string // future: schema URI or plain description
}

interface DraftTallyInfo {
  tallyId: string
  createdBy: PartyRole
}

interface ProvisionResult {
  tally: DraftTallyInfo
  dbConnectionInfo: {
    endpoint: string
    credentialsRef: string
  }
}

interface DatabaseProvisioner {
  provision(params: {
    createdBy: PartyRole
    initiatorPeerId: string
    respondentPeerId: string
  }): Promise<ProvisionResult>
}

interface BootstrapService {
  // A-side: handle inbound contact from respondent (token + identity)
  handleInboundContact(params: {
    token: string
    initiatorRole: PartyRole
    initiatorPeer: Libp2p
    respondentPeerInfo: {
      peer: Libp2p
      partyId: string
      proposedCadrePeerAddrs: string[]
    }
  }): Promise<{
    approved: boolean
    reason?: string
    participatingCadrePeerAddrs?: string[]
    // If A builds (stock), include provisioned result
    provisionResult?: ProvisionResult
  }>

  // B-side: build DB when A is foil
  buildOnRespondent(params: {
    initiatorPeer: Libp2p
    respondentPeer: Libp2p
    participatingCadrePeerAddrs: string[]
  }): Promise<ProvisionResult>
}

// Fake provisioner for tests
class FakeProvisioner implements DatabaseProvisioner {
  private nextCounter = 1
  async provision(params: { createdBy: PartyRole; initiatorPeerId: string; respondentPeerId: string }): Promise<ProvisionResult> {
    const tallyId = `tally-${this.nextCounter++}`
    return {
      tally: { tallyId, createdBy: params.createdBy },
      dbConnectionInfo: {
        endpoint: `quereus://127.0.0.1/${tallyId}`,
        credentialsRef: `cred-${tallyId}`
      }
    }
  }
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

// Placeholder factory to be replaced with real implementation import
function createBootstrapService(_deps: { provisioner: DatabaseProvisioner }): BootstrapService {
  // Return a stub that throws only when invoked (keeps suite definition safe)
  return {
    async handleInboundContact() {
      throw new Error('BootstrapService.handleInboundContact not implemented')
    },
    async buildOnRespondent() {
      throw new Error('BootstrapService.buildOnRespondent not implemented')
    }
  }
}

describe('Taleus Bootstrap (Method 6) – POC', () => {

  let A: Libp2p
  let B1: Libp2p
  let B2: Libp2p
  const hooks = createInMemoryHooks([
    { token: 'one-time-abc', initiatorRole: 'stock', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: true },
    { token: 'one-time-xyz', initiatorRole: 'foil', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: true },
    { token: 'multi-use-qr', initiatorRole: 'stock', expiryUtc: new Date(Date.now() + 300_000).toISOString(), oneTime: false },
    // Idempotency test tokens
    { token: 'idempotent-stock', initiatorRole: 'stock', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: false },
    { token: 'idempotent-foil', initiatorRole: 'foil', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: false },
    { token: 'multi-provision', initiatorRole: 'stock', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: false }
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
    // Register passive listener on A with role=stock by default; individual tests can override if needed
    unregisterA = bootstrap.registerPassiveListener(A, { role: 'stock' })
  })

  after(async () => {
    await Promise.allSettled([A?.stop(), B1?.stop(), B2?.stop()])
  })

  beforeEach(() => {
    // Future: reset any in-memory state if the service keeps it
  })

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

      // When A is stock, initiateFromLink should return a ProvisionResult directly
      const pr = result as unknown as ProvisionResult
      assert.ok(pr.dbConnectionInfo)
    })
  })

  describe('One-time token – B (foil) builds on approval', () => {
    it('approves valid respondent and B provisions DB with draft tally', async () => {
      // Switch A listener to foil role for this test
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
      // Ensure A is registered as stock for this test
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

      // override hooks to fail identity
      const failHooks = createInMemoryHooks([
        { token: 'one-time-reject', initiatorRole: 'stock', expiryUtc: new Date(Date.now() + 60_000).toISOString(), oneTime: true }
      ], { validateIdentity: () => false })
      const bootstrap2 = new TallyBootstrap(failHooks)
      // Ensure we don't have duplicate handlers
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

  describe('Idempotency Testing', () => {
    it('returns cached result for duplicate stock requests', async () => {
      unregisterA?.()
      unregisterA = bootstrap.registerPassiveListener(A, { role: 'stock' })
      
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'idempotent-stock',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'stock'
      }

      // First request
      const result1 = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'duplicate-stock' })
      // Second request with same idempotencyKey
      const result2 = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'duplicate-stock' })

      const pr1 = result1 as unknown as ProvisionResult
      const pr2 = result2 as unknown as ProvisionResult
      
      assert.equal(pr1.tally.tallyId, pr2.tally.tallyId)
      assert.equal(pr1.dbConnectionInfo.endpoint, pr2.dbConnectionInfo.endpoint)
    })

    it('returns cached result for duplicate foil requests', async () => {
      unregisterA?.()
      unregisterA = bootstrap.registerPassiveListener(A, { role: 'foil' })
      
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'idempotent-foil',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'foil'
      }

      // First request
      const result1 = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'duplicate-foil' })
      // Second request with same idempotencyKey
      const result2 = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'duplicate-foil' })

      const pr1 = result1 as unknown as ProvisionResult
      const pr2 = result2 as unknown as ProvisionResult
      
      assert.equal(pr1.tally.tallyId, pr2.tally.tallyId)
      assert.equal(pr1.dbConnectionInfo.endpoint, pr2.dbConnectionInfo.endpoint)
    })

    it('provisions separate resources for different idempotencyKeys', async () => {
      unregisterA?.()
      unregisterA = bootstrap.registerPassiveListener(A, { role: 'stock' })
      
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'multi-provision',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'stock'
      }

      const result1 = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'unique-1' })
      const result2 = await bootstrap.initiateFromLink(link, B1, { idempotencyKey: 'unique-2' })

      const pr1 = result1 as unknown as ProvisionResult
      const pr2 = result2 as unknown as ProvisionResult
      
      assert.notEqual(pr1.tally.tallyId, pr2.tally.tallyId)
    })
  })

  describe('Edge Cases', () => {
    it('rejects invalid tokens', async () => {
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'invalid-token-xyz',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'stock'
      }

      const result = await bootstrap.initiateFromLink(link, B1)
      const rej = result as unknown as { approved: false; reason: string }
      
      // @ts-expect-error
      assert.equal(rej.approved, false)
      // @ts-expect-error
      assert.equal(rej.reason, 'invalid_token')
    })

    it('handles missing responder addresses', async () => {
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: [],
        token: 'any-token',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'stock'
      }

      const result = await bootstrap.initiateFromLink(link, B1)
      const rej = result as unknown as { approved: false; reason: string }
      
      // @ts-expect-error
      assert.equal(rej.approved, false)
      // @ts-expect-error
      assert.equal(rej.reason, 'no_responder_addrs')
    })
  })
})


