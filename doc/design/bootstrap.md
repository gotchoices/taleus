# Bootstrap Method Evaluation and Comparison

## Purpose
This document tracks and compares multiple proposed methods for the tally bootstrap process - the sequence leading up to establishing a shared database where partners can begin tally negotiations.

## Decision Factors

### Must-Have Requirements
- Support for one-time invitation tokens
- Support for multi-use invitation tokens
- Authentication of parties before database commitment
- Graceful handling of failed/rejected invitations
- Integration with libp2p networking layer

### Nice-to-Have Features
- Minimal resource commitment before validation
- Simple implementation and maintenance
- Leverages existing libp2p/DHT infrastructure
- Good user experience for both parties
- Supports offline invitation delivery (QR codes, etc.)

## Bootstrap Methods Under Consideration

### 1. Pre-Authenticated Handshake Method (Current)
**Status**: ✅ Detailed below in this file
**Details**: See "Pre-Authenticated Handshake: Detailed Flow"

**Summary**: Uses libp2p messages for initial handshake with token-based pre-authentication, creates database only after validation.

**Key Characteristics**:
- ✅ Pre-validation before resource commitment
- ✅ Supports both one-time and multi-use tokens
- ✅ Token-based authentication before cluster formation
- ⚠️ More complex message handling
- ⚠️ Requires separate authentication mechanism

### 2. Database-First Approach  
**Status**: ✅ Detailed below in this file
**Details**: See "Database-First: Detailed Flow"

**Summary**: Create database immediately, include access credentials in invitation.

**Key Characteristics**:
- ✅ Simpler implementation
- ⚠️ Resource commitment before validation
- ⚠️ Requires pre-authentication mechanisms

### 3. Escrow Service Approach
**Status**: 🔄 Proposed alternative
**Details**: TBD in this file

**Summary**: Third-party service facilitates initial handshake and database setup.

**Key Characteristics**:
- ✅ Reduces peer-to-peer complexity
- ❌ Introduces centralization dependency
- ⚠️ Third-party trust requirements

### 4. DHT-Based Discovery
**Status**: 🔄 Proposed alternative  
**Details**: TBD in this file

**Summary**: Use existing Kademlia DHT for initial contact and capability exchange.

**Key Characteristics**:
- ✅ Leverages existing infrastructure
- ⚠️ Complicates authentication and token validation
- ⚠️ May expose invitation attempts publicly

### 5. Offer-Record Discovery Method
**Status**: 🔄 New proposal (under development)
**Details**: TBD in this file

**Summary**: Party A publishes discoverable link containing cluster info and encrypted tally offer record accessible via token-based authentication.

**Key Characteristics**:
- ✅ Direct cluster discovery via published links
- ✅ Pre-populated tally offer streamlines negotiation
- ✅ Supports both one-time and multi-use offers
- ✅ Optional encryption for enhanced security
- ⚠️ **Details to be completed** - see full specification TBD

**Rough Process Flow**:
1. Party A publishes link with cluster connection info
2. Party B connects to available A cluster node using link
3. Party B provides token (file/record name) for authentication
4. A discloses encrypted offer record containing:
   - Tally negotiation parameters A finds acceptable
   - A's cluster peer IDs and certificate
   - One-time vs multi-use offer tracking
5. B builds shared Quereus cluster using both parties' info
6. B populates shared DB with tally offer, triggering notification to A
7. Formal negotiation begins in shared database

Note: Full technical specification and implementation details pending.

---

#### Pre-Authenticated Handshake: Detailed Flow

This section captures the previously described message-based, pre-database bootstrap sequence.

1. Invitation Creation
   - Initiator creates an invitation containing:
     - Initiator's Party ID and contact information (libp2p peer ID, addresses)
     - Invitation token (one-time or multi-use) with expiration date
     - Authentication requirements and expected response format

2. Token Types and Delivery
   - One-time Token: Invalid after first use; for specific individual invitations
   - Multi-use Token: Valid until expiration; enables multiple parties to create separate tallies (e.g., merchant QR codes)
   - Delivery Modes:
     - One-time: Communicated privately to intended respondent
     - Multi-use: Published publicly (QR codes, websites, etc.)

3. Initial Contact Message (Respondent → Initiator via libp2p)
   - Respondent provides:
     - Their Party ID and authentication token
     - Proposed node list for the Kademlia/Quereus cluster
     - Optional credentials or identity verification data

4. Validation Phase (Initiator)
   - Validate:
     - Token authenticity and expiration
     - Respondent's Party ID and credentials
     - Proposed node list and technical capabilities
     - Whether to proceed with this particular respondent

5. Database Instantiation (If approved)
   - Initiator creates a new shared database instance for this tally
   - Pre-populates initial chunks (e.g., contract proposals, identity)
   - Establishes database access controls

6. Access Grant Message (Initiator → Respondent)
   - Sends:
     - Database access credentials and connection information
     - Initial chunk data or references
     - Cluster formation instructions

7. Cluster Formation
   - Both parties' nodes join to establish the 50/50 consensus structure

8. Chunk Negotiation Phase
   - Shared database-based negotiation begins using chunk revisions and configuration signatures

Database State Transitions (for tracking):
- Invitation Available → Contact Established → Validation Complete → Database Instantiated → Cluster Formed → Tally Active → Chunk Operability

---

#### Database-First: Detailed Flow

Creates the shared database before authentication/validation, then invites the respondent to connect using provided access credentials.

1. Database Provisioning (Initiator)
   - Create a new Quereus/Optimystic database instance (or namespace/keyspace) on an initiator-controlled cluster.
   - Initialize minimal bootstrap schema and access controls (ephemeral account, strict permissions, short TTL).
   - Optionally pre-populate initial offer metadata (contract reference, desired terms) in read-only form.
   - Multi-use tokens: provision a template/landing DB only. Do not reuse a single "final tally" DB across respondents. Each accepted respondent must end up with its own isolated tally DB/namespace.

2. Invitation Creation and Delivery
   - Compose invitation containing:
     - Cluster connection information (libp2p multiaddrs, bootstrap peers)
     - Database connection parameters (namespace/keyspace)
     - Access credentials (one-time or multi-use), expiration, and scope of permissions
     - Optional: expected respondent constraints (eg, specific Party ID hash prefix)
     - Optional: link to initiator certificate and proposed nodes list
   - Deliver privately for one-time invites; publish for multi-use (e.g., QR, URL) with careful rate limiting.
   - Multi-use tokens SHOULD reference the landing DB. On redemption, the system provisions a fresh per-respondent tally DB/namespace and returns new scoped credentials.

3. Respondent Connection and Registration
   - Respondent connects to the cluster and database using provided credentials.
   - Initial interactions occur in client mode using token-gated DB RPCs (do not require prior peerID allowlisting at transport). Without a valid token, no data is disclosed.
   - Writes a registration record including:
     - Respondent Party ID and authentication material
     - Proposed node list and capabilities
     - Optional certificate/identity disclosure pointers
   - All writes are constrained to the bootstrap schema and audited.

4. Validation Phase (Initiator)
   - Review registration and any attached credentials.
   - Automated checks: token freshness, credential scope, node capability sanity, Party ID format.
   - Decision:
     - Approve → proceed to access upgrade
     - Reject → revoke credentials and schedule database cleanup
   - On approval, bind the ephemeral credential to the presenting Party ID and/or peerID for subsequent cluster participation.

5. Access Control Upgrade (On Approval)
   - Convert respondent from ephemeral to scoped account appropriate for tally negotiation.
   - Grant permission to write initial tally chunks or copy them from offer metadata.
   - Share initiator’s node list; invite respondent nodes to join the cluster.
   - For multi-use: allocate or switch the respondent to their dedicated tally DB/namespace cloned from the landing template.

6. Cluster Formation
   - Both parties’ nominated nodes join; enforce 50/50 governance parameters.
   - Confirm replication and availability across both parties’ nodes.

7. Transition to Negotiation
   - Begin chunk-based negotiation inside the shared database (identity, certificates, terms, contract reference, configuration signatures).

State Transitions (for tracking):
- Database Provisioned → Invitation Sent → Respondent Registered → Validation Complete → Access Upgraded → Cluster Formed → Tally Active

Security and Operational Considerations:
- Resource Commitment: Database exists prior to validation; mitigate with isolation (per-invite namespace), rate limits, quotas, TTL-based auto-cleanup. This may be heavier than a message-based prelude (Method 1).
- Credential Hygiene: One-time or short-lived credentials; immediate revocation on rejection; audit logging.
- Multi-Use Invites: Require a landing/template DB with per-respondent provisioning (clone or namespace). Do not share a single final tally DB among multiple respondents.
- Access Gating: Gate at the DB protocol layer (token-gated RPC); avoid early peerID allowlists that would require knowing the respondent’s peerID in advance.
- Abuse Resistance: CAPTCHAs or proof-of-work on public invites; connection throttling.
- ACL Complexity: Per-respondent namespaces and promotions add operational overhead compared with message-based handshake.

Differences vs Pre-Authenticated Handshake:
- Pros: Simpler conceptual flow for one-time invitations; fewer moving parts in the prelude.
- Cons: Earlier resource commitment; larger attack surface if credentials leak; more emphasis on access control discipline; multi-use requires landing/template DB and per-respondent provisioning which can exceed the operational overhead of Method 1.

Known Limitations:
- Not ideal for high-volume public onboarding (multi-use) without robust automation (provisioning, isolation, cleanup).
- Harder to fully isolate responders in a single physical DB without complex ACLs; prefer separate DBs or strong namespaces.
- Operational burden can be higher than the message-based prelude when many respondents are expected.

### 6. [Future Methods]
Additional approaches can be added as separate files and referenced here.

## Comparison Matrix

| Method | Simplicity | Security | Reliability | Performance | UX | Decentralization |
|--------|------------|----------|-------------|-------------|----|--------------| 
| Pre-Authenticated Handshake | Medium | High | High | Good | Good | Excellent |
| Database-First | High | Medium | Medium | Excellent | Excellent | Good |
| Escrow Service | High | Medium | High | Good | Excellent | Poor |
| DHT Discovery | Medium | Low | Medium | Excellent | Medium | Excellent |
| Offer-Record Discovery | TBD | TBD | TBD | TBD | TBD | TBD |

Rankings: Excellent > High > Good > Medium > Low > Poor


## Notes and Considerations

### Relationship to Existing Architecture
- Must integrate with Taleus → Quereus → Optimystic → Kademlia → libp2p stack
- Should leverage 50/50 consensus model established for tally operations
- Consider how bootstrap affects the "stock/foil" party designation

### Migration Considerations
- If changing from current method, need migration plan
- Backward compatibility considerations
- Timeline for deprecating old approach

---

**Next Steps**: 
1. Create detailed documentation for each method in this file
2. Complete comparison matrix analysis
3. Make recommendation based on evaluation criteria

*This file should be updated as each method is analyzed and the final decision is made.*