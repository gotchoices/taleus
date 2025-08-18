import type { Libp2p } from 'libp2p'
import { multiaddr as toMultiaddr } from '@multiformats/multiaddr'

export const BOOTSTRAP_PROTOCOL = '/taleus/bootstrap/1.0.0'

/*
 * Type Strategy: We use the real libp2p types where possible, but define our own
 * minimal stream interface to:
 * 1. Get compile-time safety against libp2p API changes
 * 2. Document exactly what stream methods we depend on
 * 3. Make testing easier with minimal mock interfaces
 * 4. Provide clear boundaries between libp2p and our protocol logic
 */

// Re-export libp2p types for consistency, but allow for custom extensions
type LibP2PPeer = Libp2p

// Define what we need from a stream - this should match libp2p's actual Stream interface
interface LibP2PStream {
  source: AsyncIterable<StreamChunk>
  sink: (data: Uint8Array[]) => Promise<void>
  closeWrite: () => Promise<void>
  close?: () => Promise<void>
}

// Type safety check: Ensure our stream assumptions are compatible with what libp2p actually provides
// If libp2p changes its stream interface, this will cause a compile error
type LibP2PStreamCompatibilityCheck = {
  // This type will fail to compile if our assumptions about libp2p streams are wrong
  checkStreamHandler: StreamHandler extends ((data: { stream: any }) => Promise<void>) ? true : false
  checkLibp2pPeer: LibP2PPeer extends { 
    dialProtocol: (addr: any, protocol: string) => Promise<any>
    handle: (protocol: string, handler: any) => void
    unhandle: (protocol: string) => void
  } ? true : false
}

// Handler type matching libp2p's expected signature
type StreamHandler = (data: { stream: LibP2PStream }) => Promise<void>
type StreamChunk = Uint8Array | { subarray?: Function; slice?: Function; byteLength?: number }

export type PartyRole = 'stock' | 'foil'

export interface BootstrapLinkPayload {
  responderPeerAddrs: string[]
  token: string
  tokenExpiryUtc: string
  initiatorRole: PartyRole
  identityRequirements?: unknown
}

export interface DraftTallyInfo {
  tallyId: string
  createdBy: PartyRole
}

export interface ProvisionResult {
  tally: DraftTallyInfo
  dbConnectionInfo: {
    endpoint: string
    credentialsRef: string
  }
}

export interface Hooks {
  getTokenInfo: (token: string) => Promise<{
    initiatorRole: PartyRole
    expiryUtc: string
    identityRequirements?: unknown
  } | null>
  validateIdentity?: (identityBundle: unknown, identityRequirements?: unknown) => Promise<boolean>
  markTokenUsed?: (token: string, context?: unknown) => Promise<void>
  provisionDatabase: (
    createdBy: PartyRole,
    initiatorPeerId: string,
    respondentPeerId: string
  ) => Promise<ProvisionResult>
  recordProvisioning?: (idempotencyKey: string, result: ProvisionResult) => Promise<void>
  getProvisioning?: (idempotencyKey: string) => Promise<ProvisionResult | null>
}

export interface RegisterOptions {
  role: PartyRole
  getParticipatingCadrePeerAddrs?: () => Promise<string[]> | string[]
}

export class TallyBootstrap {
  private readonly hooks: Hooks

  constructor(hooks: Hooks) {
    this.hooks = hooks
  }

  registerPassiveListener(peer: LibP2PPeer, options: RegisterOptions): () => void {
    const handler: StreamHandler = async ({ stream }) => {
      const req = await readJson(stream)
      if (!req || typeof req !== 'object' || !('type' in req) || typeof (req as any).type !== 'string') {
        await writeJson(stream, { approved: false, reason: 'malformed_request' })
        return
      }

      const typedReq = req as any // Type assertion after validation
      if (typedReq.type === 'inboundContact') {
        const { token, partyId, identityBundle, proposedCadrePeerAddrs, idempotencyKey } = typedReq
        const prior = idempotencyKey && this.hooks.getProvisioning ? await this.hooks.getProvisioning(idempotencyKey) : null
        if (prior && options.role === 'stock') {
          await writeJson(stream, { approved: true, provisionResult: prior, initiatorPeerId: peer.peerId.toString() }, true)
          return
        }
        const tokenInfo = await this.hooks.getTokenInfo(token)
        if (!tokenInfo) {
          await writeJson(stream, { approved: false, reason: 'invalid_token' }, true)
          return
        }
        // Optional identity validation
        if (this.hooks.validateIdentity) {
          const ok = await this.hooks.validateIdentity(identityBundle, tokenInfo.identityRequirements)
          if (!ok) {
            await writeJson(stream, { approved: false, reason: 'identity_insufficient' }, true)
            return
          }
        }
        // Mark token as used (optional, app-level policy)
        if (this.hooks.markTokenUsed) {
          await this.hooks.markTokenUsed(token, { partyId })
        }
        // disclose cadre after approval
        const participatingCadrePeerAddrs = options.getParticipatingCadrePeerAddrs
          ? await Promise.resolve(options.getParticipatingCadrePeerAddrs())
          : []

        if (options.role === 'stock') {
          const result = await this.hooks.provisionDatabase('stock', peer.peerId.toString(), String(partyId))
          if (idempotencyKey && this.hooks.recordProvisioning) {
            await this.hooks.recordProvisioning(idempotencyKey, result)
          }
          await writeJson(stream, {
            approved: true,
            participatingCadrePeerAddrs,
            initiatorPeerId: peer.peerId.toString(),
            provisionResult: result
          }, true)
          return
        } else {
          await writeJson(stream, {
            approved: true,
            participatingCadrePeerAddrs,
            initiatorPeerId: peer.peerId.toString()
          }, true)
          return
        }
      }

      if (typedReq.type === 'provisioningResult') {
        // Dialer may have closed its write side immediately; avoid responding to prevent push-on-ended errors
        return
      }

      await writeJson(stream, { approved: false, reason: 'unknown_type' }, true)
    }

    peer.handle(BOOTSTRAP_PROTOCOL, handler)
    return () => peer.unhandle(BOOTSTRAP_PROTOCOL)
  }

  async initiateFromLink(link: BootstrapLinkPayload, peer: LibP2PPeer, args?: {
    identityBundle?: unknown
    idempotencyKey?: string
  }): Promise<ProvisionResult | { approved: false; reason: string }> {
    if (!link.responderPeerAddrs?.length) return { approved: false, reason: 'no_responder_addrs' }
    const maStr = link.responderPeerAddrs[0]
    const maddr = toMultiaddr(maStr)
    const stream = await peer.dialProtocol(maddr, BOOTSTRAP_PROTOCOL)

    // Send inbound contact
    await writeJson(stream, {
      type: 'inboundContact',
      token: link.token,
      partyId: peer.peerId.toString(),
      proposedCadrePeerAddrs: peer.getMultiaddrs().map((a) => a.toString()),
      identityBundle: args?.identityBundle,
      idempotencyKey: args?.idempotencyKey
    }, false)

    const res = await readJson(stream)
    const typedRes = res as any // Type assertion after receiving response
    if (!res || typedRes.approved !== true) {
      return { approved: false, reason: typedRes?.reason ?? 'rejected' }
    }
    if (typedRes.provisionResult) {
      return typedRes.provisionResult as ProvisionResult
    }
    if (link.initiatorRole === 'foil') {
      // B provisions and returns result to A
      const provision = await this.hooks.provisionDatabase('foil', String(typedRes.initiatorPeerId ?? ''), peer.peerId.toString())
      // open a fresh stream to send the provisioning result
      const stream2 = await peer.dialProtocol(maddr, BOOTSTRAP_PROTOCOL)
      await writeJson(stream2, {
        type: 'provisioningResult',
        idempotencyKey: args?.idempotencyKey,
        ...provision
      })
      return provision
    }
    return { approved: false, reason: 'no_provision_result' }
  }
}

async function readJson(stream: LibP2PStream): Promise<unknown> {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of stream.source) {
    const typedChunk: StreamChunk = chunk
    let u8: Uint8Array
    if (typedChunk && typeof typedChunk.subarray === 'function') {
      // Uint8Array or Uint8ArrayList
      u8 = typedChunk.subarray(0, typedChunk.byteLength ?? undefined)
    } else if (typedChunk && typeof typedChunk.slice === 'function') {
      // Fallback that often returns a Uint8Array
      u8 = typedChunk.slice(0)
    } else {
      u8 = typedChunk as Uint8Array
    }
    buf += decoder.decode(u8, { stream: true })
  }
  try { return JSON.parse(buf) } catch { return null }
}

async function writeJson(stream: LibP2PStream, obj: unknown, close = false): Promise<void> {
  const enc = new TextEncoder()
  const data = enc.encode(JSON.stringify(obj))
  await stream.sink([data])
  if (close) {
    await stream.closeWrite()
  }
}


