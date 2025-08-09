import type { Libp2p } from 'libp2p'
import { multiaddr as toMultiaddr } from '@multiformats/multiaddr'

export const BOOTSTRAP_PROTOCOL = '/taleus/bootstrap/1.0.0'

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

  registerPassiveListener(peer: Libp2p, options: RegisterOptions): () => void {
    const handler = async ({ stream }: any) => {
      const req = await readJson(stream)
      if (!req || typeof req !== 'object' || typeof req.type !== 'string') {
        await writeJson(stream, { approved: false, reason: 'malformed_request' })
        return
      }

      if (req.type === 'inboundContact') {
        const { token, partyId, identityBundle, proposedCadrePeerAddrs, idempotencyKey } = req
        const prior = idempotencyKey && this.hooks.getProvisioning ? await this.hooks.getProvisioning(idempotencyKey) : null
        if (prior && options.role === 'stock') {
          await writeJson(stream, { approved: true, provisionResult: prior, initiatorPeerId: peer.peerId.toString() })
          return
        }
        const tokenInfo = await this.hooks.getTokenInfo(token)
        if (!tokenInfo) {
          await writeJson(stream, { approved: false, reason: 'invalid_token' })
          return
        }
        // Optional identity validation
        if (this.hooks.validateIdentity) {
          const ok = await this.hooks.validateIdentity(identityBundle, tokenInfo.identityRequirements)
          if (!ok) {
            await writeJson(stream, { approved: false, reason: 'identity_insufficient' })
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
          })
          return
        } else {
          await writeJson(stream, {
            approved: true,
            participatingCadrePeerAddrs,
            initiatorPeerId: peer.peerId.toString()
          })
          return
        }
      }

      if (req.type === 'provisioningResult') {
        // For completeness we could acknowledge; in this minimal design we just ack
        await writeJson(stream, { ok: true })
        return
      }

      await writeJson(stream, { approved: false, reason: 'unknown_type' })
    }

    peer.handle(BOOTSTRAP_PROTOCOL, handler)
    return () => peer.unhandle(BOOTSTRAP_PROTOCOL)
  }

  async initiateFromLink(link: BootstrapLinkPayload, peer: Libp2p, args?: {
    identityBundle?: unknown
    idempotencyKey?: string
  }): Promise<ProvisionResult | { approved: false; reason: string }> {
    if (!link.responderPeerAddrs?.length) return { approved: false, reason: 'no_responder_addrs' }
    const maStr = link.responderPeerAddrs[0]
    const maddr = toMultiaddr(maStr)
    const stream = await (peer as any).dialProtocol(maddr, BOOTSTRAP_PROTOCOL)

    // Send inbound contact
    await writeJson(stream, {
      type: 'inboundContact',
      token: link.token,
      partyId: peer.peerId.toString(),
      proposedCadrePeerAddrs: peer.getMultiaddrs().map((a) => a.toString()),
      identityBundle: args?.identityBundle,
      idempotencyKey: args?.idempotencyKey
    })

    const res = await readJson(stream)
    if (!res || res.approved !== true) {
      return { approved: false, reason: res?.reason ?? 'rejected' }
    }
    if (res.provisionResult) {
      return res.provisionResult as ProvisionResult
    }
    if (link.initiatorRole === 'foil') {
      // B provisions and returns result to A
      const provision = await this.hooks.provisionDatabase('foil', String(res.initiatorPeerId ?? ''), peer.peerId.toString())
      // open a fresh stream to send the provisioning result
      const stream2 = await (peer as any).dialProtocol(maddr, BOOTSTRAP_PROTOCOL)
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

async function readJson(stream: any): Promise<any> {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of stream.source) {
    const anyChunk: any = chunk
    let u8: Uint8Array
    if (anyChunk && typeof anyChunk.subarray === 'function') {
      // Uint8Array or Uint8ArrayList
      u8 = anyChunk.subarray(0, anyChunk.byteLength ?? undefined)
    } else if (anyChunk && typeof anyChunk.slice === 'function') {
      // Fallback that often returns a Uint8Array
      u8 = anyChunk.slice(0)
    } else {
      u8 = anyChunk as Uint8Array
    }
    buf += decoder.decode(u8, { stream: true })
  }
  try { return JSON.parse(buf) } catch { return null }
}

async function writeJson(stream: any, obj: any): Promise<void> {
  const enc = new TextEncoder()
  const data = enc.encode(JSON.stringify(obj))
  await stream.sink([data])
  if (typeof stream.closeWrite === 'function') {
    await stream.closeWrite()
  } else if (typeof stream.close === 'function') {
    // Fallback
    try { await stream.close() } catch {}
  }
}


