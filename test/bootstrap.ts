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
import { multiaddr } from 'multiaddr'

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

describe.skip('Taleus Bootstrap (Method 6) – POC', () => {

  let A: Libp2p
  let B1: Libp2p
  let B2: Libp2p
  const provisioner = new FakeProvisioner()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const bootstrap: BootstrapService = createBootstrapService({ provisioner })

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
  })

  after(async () => {
    await Promise.allSettled([A?.stop(), B1?.stop(), B2?.stop()])
  })

  beforeEach(() => {
    // Future: reset any in-memory state if the service keeps it
  })

  describe.skip('One-time token – A (stock) builds on approval', () => {
    it('approves valid respondent and returns DB access with draft tally', async () => {
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'one-time-abc',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'stock',
        identityRequirements: 'email, phone'
      }

      const result = await bootstrap.handleInboundContact({
        token: link.token,
        initiatorRole: link.initiatorRole,
        initiatorPeer: A,
        respondentPeerInfo: {
          peer: B1,
          partyId: 'peer:did:key:zB1',
          proposedCadrePeerAddrs: B1.getMultiaddrs().map(ma => ma.toString())
        }
      })

      assert.equal(result.approved, true)
      assert.ok(result.provisionResult)
      assert.match(result!.provisionResult!.tally.tallyId, /^tally-/)
      assert.equal(result!.provisionResult!.tally.createdBy, 'stock')
      assert.ok(result!.provisionResult!.dbConnectionInfo.endpoint.includes('127.0.0.1'))
    })
  })

  describe.skip('One-time token – B (foil) builds on approval', () => {
    it('approves valid respondent and B provisions DB with draft tally', async () => {
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'one-time-xyz',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'foil'
      }

      const approval = await bootstrap.handleInboundContact({
        token: link.token,
        initiatorRole: link.initiatorRole,
        initiatorPeer: A,
        respondentPeerInfo: {
          peer: B1,
          partyId: 'peer:did:key:zB1',
          proposedCadrePeerAddrs: B1.getMultiaddrs().map(ma => ma.toString())
        }
      })

      assert.equal(approval.approved, true)
      assert.ok(Array.isArray(approval.participatingCadrePeerAddrs))

      const provision = await bootstrap.buildOnRespondent({
        initiatorPeer: A,
        respondentPeer: B1,
        participatingCadrePeerAddrs: approval.participatingCadrePeerAddrs!
      })

      assert.match(provision.tally.tallyId, /^tally-/)
      assert.equal(provision.tally.createdBy, 'foil')
      assert.ok(provision.dbConnectionInfo.endpoint.includes('127.0.0.1'))
    })
  })

  describe.skip('Multi-use token – provisions unique DB per respondent', () => {
    it('creates separate tallies for two respondents using the same token', async () => {
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'multi-use-qr',
        tokenExpiryUtc: new Date(Date.now() + 300_000).toISOString(),
        initiatorRole: 'stock'
      }

      const approveB1 = await bootstrap.handleInboundContact({
        token: link.token,
        initiatorRole: link.initiatorRole,
        initiatorPeer: A,
        respondentPeerInfo: {
          peer: B1,
          partyId: 'peer:did:key:zB1',
          proposedCadrePeerAddrs: B1.getMultiaddrs().map(ma => ma.toString())
        }
      })
      const approveB2 = await bootstrap.handleInboundContact({
        token: link.token,
        initiatorRole: link.initiatorRole,
        initiatorPeer: A,
        respondentPeerInfo: {
          peer: B2,
          partyId: 'peer:did:key:zB2',
          proposedCadrePeerAddrs: B2.getMultiaddrs().map(ma => ma.toString())
        }
      })

      const t1 = approveB1.provisionResult!.tally.tallyId
      const t2 = approveB2.provisionResult!.tally.tallyId
      assert.ok(t1 && t2 && t1 !== t2)
    })
  })

  describe.skip('Rejection path – missing identity requirements', () => {
    it('rejects with a clear reason if identity is insufficient', async () => {
      const link: BootstrapLinkPayload = {
        responderPeerAddrs: A.getMultiaddrs().map(ma => ma.toString()),
        token: 'one-time-reject',
        tokenExpiryUtc: new Date(Date.now() + 60_000).toISOString(),
        initiatorRole: 'stock',
        identityRequirements: 'email, phone, selfie'
      }

      const result = await bootstrap.handleInboundContact({
        token: link.token,
        initiatorRole: link.initiatorRole,
        initiatorPeer: A,
        respondentPeerInfo: {
          peer: B1,
          partyId: 'peer:did:key:zB1',
          proposedCadrePeerAddrs: [] // intentionally empty to provoke rejection later if policy demands
        }
      })

      assert.equal(result.approved, false)
      assert.ok(result.reason && result.reason.length > 0)
    })
  })
})


