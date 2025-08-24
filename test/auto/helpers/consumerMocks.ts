/*
  Mock implementations for Taleus Bootstrap State Machine Testing
  
  Provides session-aware hooks that track activity per session
  and simulate database provisioning for different scenarios.
*/

// Session-aware hooks interface for state machine architecture
export interface SessionHooks {
  validateToken(token: string, sessionId: string): Promise<{role: 'stock'|'foil', valid: boolean}>
  validateIdentity(identity: any, sessionId: string): Promise<boolean>
  provisionDatabase(role: 'stock'|'foil', partyA: string, partyB: string, sessionId: string): Promise<any>
  validateResponse(response: any, sessionId: string): Promise<boolean>
  validateDatabaseResult(result: any, sessionId: string): Promise<boolean>
}

// Session-aware hooks for state machine architecture
export function createSessionAwareHooks(validTokens: string[] = ['test-token']): SessionHooks {
  const tokenDatabase = new Map<string, any>()
  const provisioningDatabase = new Map<string, any>()
  const sessionLogs = new Map<string, any[]>()
  
  // Pre-populate with test tokens
  validTokens.forEach(token => {
    if (token === 'stock-token') {
      tokenDatabase.set(token, { role: 'stock', valid: true, multiUse: false })
    } else if (token === 'foil-token') {
      tokenDatabase.set(token, { role: 'foil', valid: true, multiUse: false })
    } else if (token === 'multi-use-token') {
      tokenDatabase.set(token, { role: 'stock', valid: true, multiUse: true })
    } else {
      tokenDatabase.set(token, { role: 'stock', valid: true, multiUse: false })
    }
  })
  
  function logActivity(sessionId: string, activity: any) {
    if (!sessionLogs.has(sessionId)) {
      sessionLogs.set(sessionId, [])
    }
    sessionLogs.get(sessionId)!.push({ ...activity, timestamp: Date.now() })
  }
  
  return {
    async validateToken(token: string, sessionId: string) {
      logActivity(sessionId, { action: 'validateToken', token })
      
      const tokenInfo = tokenDatabase.get(token)
      if (!tokenInfo) {
        return { role: 'stock', valid: false }
      }
      
      return { role: tokenInfo.role, valid: tokenInfo.valid }
    },
    
    async validateIdentity(identity: any, sessionId: string) {
      logActivity(sessionId, { action: 'validateIdentity', identity })
      
      // Simple validation: identity must have required fields
      return !!(identity && typeof identity === 'object' && identity.partyId)
    },
    
    async provisionDatabase(role: 'stock'|'foil', partyA: string, partyB: string, sessionId: string) {
      logActivity(sessionId, { action: 'provisionDatabase', role, partyA, partyB })
      
      const tallyId = `tally-${partyA}-${partyB}-${Date.now()}`
      const result = {
        tally: { tallyId, createdBy: role },
        dbConnectionInfo: {
          endpoint: `wss://db-${tallyId}.example.com`,
          credentialsRef: `creds-${tallyId}`
        }
      }
      
      provisioningDatabase.set(sessionId, result)
      return result
    },
    
    async validateResponse(response: any, sessionId: string) {
      logActivity(sessionId, { action: 'validateResponse', response })
      
      // Simple validation: response must have required structure  
      return response && response.approved !== undefined
    },
    
    async validateDatabaseResult(result: any, sessionId: string) {
      logActivity(sessionId, { action: 'validateDatabaseResult', result })
      
      // Simple validation: result must have tally and dbConnectionInfo
      return result && result.tally && result.dbConnectionInfo
    }
  }
}


