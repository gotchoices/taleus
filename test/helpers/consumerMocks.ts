import type { Hooks, PartyRole, ProvisionResult } from '../../src/tallyBootstrap.js'

type TokenRecord = {
  token: string
  initiatorRole: PartyRole
  expiryUtc: string
  identityRequirements?: unknown
  oneTime?: boolean
  used?: boolean
}

export function createInMemoryHooks(tokens: TokenRecord[]): Hooks {
  const tokenMap = new Map(tokens.map(t => [t.token, { ...t }]))
  const provisionMap = new Map<string, ProvisionResult>()
  let nextId = 1

  return {
    async getTokenInfo(token) {
      const rec = tokenMap.get(token)
      if (!rec) return null
      if (rec.oneTime && rec.used) return null
      return {
        initiatorRole: rec.initiatorRole,
        expiryUtc: rec.expiryUtc,
        identityRequirements: rec.identityRequirements
      }
    },
    async validateIdentity() {
      return true
    },
    async markTokenUsed(token) {
      const rec = tokenMap.get(token)
      if (rec) rec.used = true
    },
    async provisionDatabase(createdBy, initiatorPeerId, respondentPeerId) {
      const tallyId = `tally-${nextId++}`
      return {
        tally: { tallyId, createdBy },
        dbConnectionInfo: { endpoint: `quereus://127.0.0.1/${tallyId}`, credentialsRef: `cred-${tallyId}` }
      }
    },
    async recordProvisioning(idempotencyKey, result) {
      provisionMap.set(idempotencyKey, result)
    },
    async getProvisioning(idempotencyKey) {
      return provisionMap.get(idempotencyKey) ?? null
    }
  }
}


