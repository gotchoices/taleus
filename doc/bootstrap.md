# Taleus Bootstrap: State Machine Architecture

This guide explains the production state machine architecture for Taleus bootstrap. The bootstrap process establishes shared databases and minimal draft tallies between two parties to enable tally negotiation.

## State Machine Overview

The Taleus bootstrap uses a **session-based state machine** architecture optimized for concurrent processing, fault tolerance, and production money system requirements.

### Key Design Principles

- **Session Independence**: Each bootstrap attempt runs in an isolated session
- **Concurrent Processing**: Unlimited parallel bootstrap sessions
- **Timeout Protection**: Multi-level timeouts prevent hangs and resource leaks
- **Error Isolation**: Failed sessions don't affect other sessions
- **Resource Management**: Automatic cleanup and monitoring
- **Audit Trail**: Complete logging for money system compliance

---

## Session State Diagrams

### ListenerSession Class (Party A - Receives Connections)

```mermaid
stateDiagram-v2
    [*] --> L_PROCESS_CONTACT: InboundContact received
    
    L_PROCESS_CONTACT --> L_SEND_RESPONSE: Hooks complete
    L_PROCESS_CONTACT --> L_FAILED: Token/identity rejected
    
    L_SEND_RESPONSE --> L_AWAIT_DATABASE: Response sent (foil role)
    L_SEND_RESPONSE --> L_DONE: Response sent (stock role)
    
    L_AWAIT_DATABASE --> L_DONE: DatabaseResult received
    L_AWAIT_DATABASE --> L_TIMEOUT: Database timeout
    L_AWAIT_DATABASE --> L_FAILED: Database provision failed
    
    L_PROCESS_CONTACT --> L_TIMEOUT: Hook timeout
    L_SEND_RESPONSE --> L_TIMEOUT: Send timeout
    
    L_FAILED --> [*]: Cleanup & log error
    L_TIMEOUT --> [*]: Cleanup & log timeout
    L_DONE --> [*]: Cleanup & log success
    
    note right of L_PROCESS_CONTACT
        Hook calls:
        - validateToken()
        - validateIdentity()
        - provisionDatabase() [stock role only]
    end note
```

### DialerSession Class (Party B - Initiates Connection)

```mermaid
stateDiagram-v2
    [*] --> D_SEND_CONTACT: Connect & send InboundContact
    [*] --> D_FAILED: Connection failed
    
    D_SEND_CONTACT --> D_AWAIT_RESPONSE: InboundContact sent
    D_SEND_CONTACT --> D_FAILED: Send failed
    
    D_AWAIT_RESPONSE --> D_HANDLE_RESPONSE: Response received
    D_AWAIT_RESPONSE --> D_TIMEOUT: Response timeout
    
    D_HANDLE_RESPONSE --> D_SEND_DATABASE: Valid (foil role)
    D_HANDLE_RESPONSE --> D_DONE: Valid (stock role)
    D_HANDLE_RESPONSE --> D_FAILED: Invalid response
    
    D_SEND_DATABASE --> D_DONE: DatabaseResult sent
    D_SEND_DATABASE --> D_FAILED: Database send failed
    
    D_HANDLE_RESPONSE --> D_TIMEOUT: Hook timeout
    D_SEND_DATABASE --> D_TIMEOUT: Send timeout
    
    D_FAILED --> [*]: Return error
    D_TIMEOUT --> [*]: Return timeout
    D_DONE --> [*]: Return success
    
    note right of D_HANDLE_RESPONSE
        Hook calls:
        - validateResponse()
        - provisionDatabase() [foil role only]
    end note
```

---

## Protocol Message Flow

### Stock Role Bootstrap (A provisions database)

```mermaid
sequenceDiagram
    participant B as Party B
    participant HooksB as Hooks B
    participant NodeB as Dialer Node B
    participant NodeA as Listener Node A
    participant HooksA as Hooks A
    participant A as Party A
    
    Note over B,A: Bootstrap Initiation
    
    B->>NodeB: initiateFromLink(link)
    NodeB->>NodeA: dialProtocol('/taleus/bootstrap/1.0.0')
    
    Note over NodeB,NodeA: Message 1: InboundContact<br/>B discloses B's cadre first
    
    NodeB->>NodeA: InboundContact {token, partyId, identityBundle, cadrePeerAddrs: B_cadre}
    NodeA->>HooksA: validateToken(token)
    HooksA-->>NodeA: tokenInfo {role: 'stock', ...}
    NodeA->>HooksA: validateIdentity(identityBundle)
    HooksA-->>NodeA: identityValid
    NodeA->>HooksA: provisionDatabase(stock, partyA, partyB)
    HooksA-->>NodeA: provisionResult {tally, dbConnectionInfo}
    
    Note over NodeB,NodeA: Message 2: ProvisioningResult<br/>A discloses A's cadre after validation
    
    NodeA->>NodeB: ProvisioningResult {approved: true, provisionResult, cadrePeerAddrs: A_cadre}
    NodeB->>HooksB: validateResponse(provisionResult)
    HooksB-->>NodeB: responseValid
    NodeB-->>B: Success {tally, dbConnectionInfo}
    
    Note over B,A: Bootstrap Complete - Shared database ready
```

### Foil Role Bootstrap (B provisions database)

```mermaid
sequenceDiagram
    participant B as Party B
    participant HooksB as Hooks B
    participant NodeB as Dialer Node B
    participant NodeA as Listener Node A
    participant HooksA as Hooks A
    participant A as Party A
    
    Note over B,A: Bootstrap Initiation
    
    B->>NodeB: initiateFromLink(link)
    NodeB->>NodeA: dialProtocol('/taleus/bootstrap/1.0.0')
    
    Note over NodeB,NodeA: Message 1: InboundContact<br/>B discloses B's cadre first
    
    NodeB->>NodeA: InboundContact {token, partyId, identityBundle, cadrePeerAddrs: B_cadre}
    NodeA->>HooksA: validateToken(token)
    HooksA-->>NodeA: tokenInfo {role: 'foil', ...}
    NodeA->>HooksA: validateIdentity(identityBundle)
    HooksA-->>NodeA: identityValid
    
    Note over NodeB,NodeA: Message 2: ProvisioningResult<br/>A discloses A's cadre after validation
    
    NodeA->>NodeB: ProvisioningResult {approved: true, partyId, cadrePeerAddrs: A_cadre}
    NodeB->>HooksB: validateResponse(result)
    HooksB-->>NodeB: responseValid
    NodeB->>HooksB: provisionDatabase(foil, partyA, partyB)
    HooksB-->>NodeB: provisionResult {tally, dbConnectionInfo}
    
    Note over NodeB,NodeA: Message 3: DatabaseResult<br/>B provides provisioned database access
    
    NodeB->>NodeA: DatabaseResult {tally, dbConnectionInfo}
    NodeA->>HooksA: validateDatabaseResult(result)
    HooksA-->>NodeA: resultValid
    NodeA-->>A: Success {tally, dbConnectionInfo}
    NodeB-->>B: Success {tally, dbConnectionInfo}
    
    Note over B,A: Bootstrap Complete - Shared database ready
```

### Concurrent Multi-Use Token Handling

```mermaid
sequenceDiagram
    participant C1 as Customer 1
    participant C2 as Customer 2
    participant C3 as Customer 3
    participant NodeM as Merchant Node
    participant HooksM as Merchant Hooks
    participant M as Merchant
    
    Note over C1,M: Multiple customers scan same QR code simultaneously
    
    par Session 1 (C1 → M)
        C1->>NodeM: InboundContact {token, cadrePeerAddrs: C1_cadre}
        NodeM->>HooksM: validateToken(token)
        HooksM-->>NodeM: valid (multi-use)
        NodeM->>HooksM: provisionDatabase(stock, merchant, customer1)
        HooksM-->>NodeM: database1 {tallyId: 'merchant-customer1'}
        NodeM-->>C1: ProvisioningResult {approved: true, cadrePeerAddrs: M_cadre, database1}
    and Session 2 (C2 → M)
        C2->>NodeM: InboundContact {token, cadrePeerAddrs: C2_cadre}
        NodeM->>HooksM: validateToken(token)
        HooksM-->>NodeM: valid (multi-use)
        NodeM->>HooksM: provisionDatabase(stock, merchant, customer2)
        HooksM-->>NodeM: database2 {tallyId: 'merchant-customer2'}
        NodeM-->>C2: ProvisioningResult {approved: true, cadrePeerAddrs: M_cadre, database2}
    and Session 3 (C3 → M)
        C3->>NodeM: InboundContact {token, cadrePeerAddrs: C3_cadre}
        NodeM->>HooksM: validateToken(token)
        HooksM-->>NodeM: valid (multi-use)
        NodeM->>HooksM: provisionDatabase(stock, merchant, customer3)
        HooksM-->>NodeM: database3 {tallyId: 'merchant-customer3'}
        NodeM-->>C3: ProvisioningResult {approved: true, cadrePeerAddrs: M_cadre, database3}
    end
    
    Note over C1,M: All sessions process independently<br/>Each gets unique tally and database
```

---

## Class Architecture

### SessionManager Class

The `SessionManager` coordinates all bootstrap operations, managing both listener and dialer sessions.

```typescript
class SessionManager {
  private listenerSessions = new Map<string, ListenerSession>()
  private dialerSessions = new Map<string, DialerSession>()
  private hooks: SessionHooks
  private config: SessionManagerConfig
  
  constructor(hooks: SessionHooks, config?: SessionManagerConfig) {
    this.hooks = hooks
    this.config = { sessionTimeoutMs: 30000, maxConcurrentSessions: 100, ...config }
  }
  
  // Handle incoming streams (passive listener)
  async handleNewStream(stream: LibP2PStream): Promise<void> {
    const sessionId = this.generateSessionId()
    const session = new ListenerSession(sessionId, stream, this.hooks, this.config)
    
    this.listenerSessions.set(sessionId, session)
    
    // Process session independently (non-blocking)
    session.execute().finally(() => {
      this.listenerSessions.delete(sessionId)
    })
  }
  
  // Initiate bootstrap (active dialer)
  async initiateBootstrap(link: BootstrapLink, node: LibP2P): Promise<BootstrapResult> {
    const sessionId = this.generateSessionId()
    const session = new DialerSession(sessionId, link, node, this.hooks, this.config)
    
    this.dialerSessions.set(sessionId, session)
    
    try {
      return await session.execute()
    } finally {
      this.dialerSessions.delete(sessionId)
    }
  }
}
```

### ListenerSession Class

Handles incoming bootstrap requests from other parties.

```typescript
class ListenerSession {
  private state: ListenerState = 'L_PROCESS_CONTACT'
  
  constructor(
    private sessionId: string,
    private stream: LibP2PStream,
    private hooks: SessionHooks,
    private config: SessionConfig
  ) {}
  
  async execute(): Promise<void> {
    try {
      await this.processContact()
      await this.sendResponse()
      
      if (this.tokenInfo.role === 'foil') {
        await this.awaitDatabase()
      }
      
      this.transitionTo('L_DONE')
    } catch (error) {
      this.transitionTo('L_FAILED', error)
    }
  }
}
```

### DialerSession Class

Initiates bootstrap requests to other parties.

```typescript
class DialerSession {
  private state: DialerState = 'D_SEND_CONTACT'
  
  constructor(
    private sessionId: string,
    private link: BootstrapLink,
    private node: LibP2P,
    private hooks: SessionHooks,
    private config: SessionConfig
  ) {}
  
  async execute(): Promise<BootstrapResult> {
    try {
      const stream = await this.connectAndSend()
      const response = await this.awaitResponse(stream)
      
      if (this.tokenInfo.role === 'foil') {
        await this.sendDatabase(stream)
      }
      
      this.transitionTo('D_DONE')
      return this.result
    } catch (error) {
      this.transitionTo('D_FAILED', error)
      throw error
    }
  }
}
```

### SessionHooks Interface

Applications implement these hooks to provide business logic.

```typescript
interface SessionHooks {
  // Token validation and management
  validateToken(token: string): Promise<TokenInfo>
  markTokenUsed?(token: string, sessionId: string): Promise<void>
  
  // Identity validation  
  validateIdentity?(bundle: unknown, requirements?: unknown): Promise<boolean>
  
  // Database provisioning
  provisionDatabase(
    role: PartyRole,
    initiatorPeerId: string,
    respondentPeerId: string,
    sessionId: string
  ): Promise<DatabaseResult>
  
  // Response validation (for dialers)
  validateResponse?(response: ProvisioningResult): Promise<boolean>
  
  // Audit logging
  logSessionEvent?(sessionId: string, event: SessionEvent): Promise<void>
}
```

---

## Basic Usage

### Setting Up the Bootstrap Service

```typescript
import { SessionManager } from 'taleus/bootstrap'
import { createLibp2p } from 'libp2p'

// 1. Implement hooks for your application
const hooks: SessionHooks = {
  async validateToken(token: string) {
    const tokenData = await yourTokenStore.get(token)
    if (!tokenData || tokenData.expires < Date.now()) {
      return null
    }
    return {
      role: tokenData.role,
      expiryUtc: tokenData.expires.toISOString(),
      identityRequirements: tokenData.identityRequirements
    }
  },
  
  async provisionDatabase(role, initiatorPeerId, respondentPeerId, sessionId) {
    const tallyId = generateTallyId(initiatorPeerId, respondentPeerId)
    const database = await yourDatabaseService.create(tallyId, role)
    
    return {
      tally: {
        tallyId,
        createdBy: role,
        initiatorPeerId,
        respondentPeerId,
        createdAt: new Date().toISOString()
      },
      dbConnectionInfo: {
        nodes: database.nodeAddresses,
        credentials: database.accessToken
      }
    }
  }
}

// 2. Create session manager
const sessionManager = new SessionManager(hooks, {
  sessionTimeoutMs: 30000,
  maxConcurrentSessions: 50
})

// 3. Set up libp2p node and register bootstrap protocol
const node = await createLibp2p({
  addresses: { listen: ['/ip4/0.0.0.0/tcp/9000'] },
  // ... other libp2p config
})

node.handle('/taleus/bootstrap/1.0.0', ({ stream }) => {
  sessionManager.handleNewStream(stream)
})

await node.start()
```

### Passive Listening (Receiving Bootstrap Requests)

```typescript
// The session manager automatically handles incoming streams
// Each stream becomes a new ListenerSession that processes independently

console.log('Bootstrap service listening on /taleus/bootstrap/1.0.0')
console.log('Ready to accept incoming bootstrap requests')

// Monitor active sessions
setInterval(() => {
  console.log(`Active listener sessions: ${sessionManager.getActiveListenerCount()}`)
}, 5000)
```

### Active Initiation (Starting Bootstrap Requests)

```typescript
// Create a bootstrap link (typically done out-of-band)
const bootstrapLink: BootstrapLink = {
  token: 'your-bootstrap-token',
  responderPeerAddrs: ['/ip4/192.168.1.100/tcp/9000/p2p/12D3KooW...'],
  role: 'stock', // or 'foil'
  identityRequirements: { email: true }
}

// Initiate bootstrap to another party
try {
  const result = await sessionManager.initiateBootstrap(bootstrapLink, node)
  
  console.log('Bootstrap successful!')
  console.log('Tally ID:', result.tally.tallyId)
  console.log('Database nodes:', result.dbConnectionInfo.nodes)
  
  // Now you can connect to the shared database and begin tally negotiation
} catch (error) {
  console.error('Bootstrap failed:', error.message)
}
```

This architecture provides **clean separation** between the two session types while maintaining **simple APIs** for integration into applications.
