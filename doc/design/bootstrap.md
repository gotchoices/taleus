# Bootstrap Method Evaluation and Comparison

## Purpose
This document tracks and compares multiple proposed methods for the tally bootstrap process - the sequence leading up to establishing a shared database where partners can begin tally negotiations.

## Decision Factors

### Must-Have Requirements
- Strictly peer-to-peer bootstrap (no centralized third-party services in invitation, validation, or database instantiation)
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
**Details**: See [Pre-Authenticated Handshake: Detailed Flow](#pre-authenticated-handshake-detailed-flow)

**Summary**: Uses libp2p messages for initial handshake with token-based pre-authentication, creates database only after validation.

**Key Characteristics**:
- ✅ Pre-validation before resource commitment
- ✅ Supports both one-time and multi-use tokens
- ✅ Token-based authentication before cluster formation
- ⚠️ More complex message handling
- ⚠️ Requires separate authentication mechanism

**Rough Process Flow**:
1. Initiator creates invitation with token, expiry, and expected response fields
2. Respondent contacts initiator over libp2p with token, Party ID, and proposed nodes
3. Initiator validates token, identity material, and node capabilities
4. If approved, initiator instantiates the shared database and configures scoped access
5. Initiator sends DB connection info and credentials to respondent
6. Both parties’ nominated nodes join; 50/50 governance established
7. Minimal draft tally is inserted/verified in the shared DB
8. Shared database is ready for writes by both parties; negotiation continues outside this file

### 2. Database-First Approach  
**Status**: ✅ Detailed below in this file
**Details**: See [Database-First: Detailed Flow](#database-first-detailed-flow)

**Summary**: Create database immediately, include access credentials in invitation.

**Key Characteristics**:
- ✅ Simpler implementation
- ⚠️ Resource commitment before validation
- ⚠️ Requires pre-authentication mechanisms

### 3. Escrow Service Approach
**Status**: ⛔ Does not meet Must-Haves (centralized third-party escrow)
**Details**: TBD in this file

**Summary**: Third-party service facilitates initial handshake and database setup.

**Key Characteristics**:
- ✅ Reduces peer-to-peer complexity
- ❌ Introduces centralization dependency
- ⚠️ Third-party trust requirements

Note: This approach violates the Must-Have requirement for strictly peer-to-peer bootstrap and is therefore recommended for exclusion.

### 4. DHT-Based Discovery
**Status**: 🔄 Proposed alternative  
**Details**: See [DHT-Based Discovery: Detailed Flow](#dht-based-discovery-detailed-flow)

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
6. B (or A per method design) populates the shared DB with an initial draft tally (offer), triggering notification to A
7. Shared database is ready for writes by both parties; draft tally present. Negotiation proceeds outside the scope of this file

Note: Full technical specification and implementation details pending.

---

### 6. Role-Based Link Handshake (Consolidation of 1 and 5)
**Status**: 🔄 Proposed consolidation (replaces 1 and 5 when adopted)
**Details**: Rough Process Flow below

**Summary**: A privately shared link (email/QR) conveys A’s contact node peerIDs (responders), an auth token, A’s intended role (stock/foil), and optional identity requirements. B connects to any A node, proves token possession, and discloses B’s identity and proposed cadre. After validation, A discloses the participating cadre. The builder is chosen by role: if A=stock, A builds; if A=foil, B builds. Ends with a shared DB ready for writes and a draft tally present.

**Rough Process Flow**:
1. A generates a private link containing: A’s contact node peerIDs (responders), authentication token (with expiry), A’s role (stock/foil), and optional identity requirements for B
2. A shares the link privately with B (or multiple Bs via email/QR)
3. B connects to any available A node and presents: token proof, B’s Party ID, B’s cadre peerIDs, and desired tally contents/offer metadata
4. If A’s role is stock and B meets identity requirements: A instantiates the shared DB, inserts/verifies a minimal draft tally, and returns DB access info
5. If A’s role is foil: A discloses A’s identity and participating cadre peerIDs along with offer metadata; if B proceeds, B instantiates the shared DB, inserts a minimal draft tally, and returns DB access info
6. Both parties’ nominated nodes join; 50/50 governance established; shared DB is ready for writes by both parties; draft tally present

Method 6 items to address in detailed design (numbered):
1) Multi-use onboarding: message-based bootstrap implies no landing DB; provision a fresh per-respondent tally DB/namespace only after validation. Automate quotas and TTL cleanup for abandoned instances. Never reuse a single final tally DB across respondents
2) Privacy of cadre data: addressed by sharing only responder node peerIDs in the link; disclose participating cadre peerIDs after token validation
3) Identity requirements (deferred): specify proof formats (e.g., DID proofs) rather than free-form “requirements” in a later design phase
4) End-state definition: explicitly require “DB Ready (draft tally present)” with confirmed write access for both parties

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

8. Initial Draft Tally and Handoff
   - Ensure a minimal draft tally (identity/config prerequisites as needed) is present in the shared database and provide access information to both parties (no pre-flight read/write required)
   - Handoff: Subsequent tally negotiation (chunk revisions, configuration signatures) is out of scope for this file

Database State Transitions (for tracking):
- Invitation Available → Contact Established → Validation Complete → Database Instantiated → Cluster Formed → DB Ready (draft tally present)

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

7. Initial Draft Tally and Handoff
   - Populate a minimal draft tally (identity/config prerequisites as needed) and provide access information to both parties (no pre-flight read/write required)
   - Handoff: Subsequent tally negotiation is out of scope for this file

State Transitions (for tracking):
- Database Provisioned → Invitation Sent → Respondent Registered → Validation Complete → Access Upgraded → Cluster Formed → DB Ready (draft tally present)

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
-
---

#### DHT-Based Discovery: Detailed Flow

Uses the Kademlia DHT for invitation discovery and token-bound validation before shared database creation. Avoids centralized escrow; does not require prior knowledge of the respondent’s peerID.

1. Invite Advertisement (Initiator → DHT)
   - Publish an invite advert under a DHT key (e.g., CID of invite metadata) including:
     - Initiator libp2p multiaddrs and a rendezvous topic
     - Challenge parameters (nonce length, signature/HMAC scheme)
     - Pointer to an encrypted offer capsule (e.g., DHT key or IPFS CID)
     - Token policy (one-time or multi-use), expiry
   - Only minimal metadata is public; sensitive content stays encrypted.

2. Discovery and Contact (Respondent → Initiator)
   - Respondent locates the advert (searches topic or is given the DHT key out of band)
   - Connects to the rendezvous topic and requests a challenge

3. Token-Bound Challenge/Response
   - Initiator issues a random challenge nonce
   - Respondent proves possession using HMAC(token, nonce) or a token-bound signature
   - On failure: rate-limit and optionally require a computational puzzle to deter abuse

4. Offer Capsule Disclosure
   - If proof is valid, Initiator discloses:
     - Encrypted offer capsule CID and salt
     - Minimal cluster bootstrap info (bootstrap peers)
   - Respondent derives decryption key from token (e.g., KDF(token, salt)) and decrypts the capsule

5. Validation Material and Registration
   - Capsule contains initiator’s proposed nodes, initial offer metadata, and expected respondent fields (Party ID, nodes)
   - Respondent submits registration material back to Initiator (via libp2p), including Party ID and proposed nodes

6. Decision and Shared DB Instantiation
   - Initiator validates registration and either:
     - Rejects: aborts; advert may remain for other respondents (multi-use) or be withdrawn (one-time)
     - Approves: creates the shared database (Method 1 or 2 style instantiation) and prepares scoped credentials

7. Access Grant and Cluster Formation
   - Initiator sends DB access info and credentials; both parties’ nominated nodes join to establish 50/50 governance

8. Initial Draft Tally and Handoff
   - Ensure a minimal draft tally is present and provide access information to both parties (no pre-flight read/write required)
   - Handoff: Subsequent negotiation occurs outside the scope of this file

State Transitions (for tracking):
- Advert Published → Contact Established → Token Proof Valid → Capsule Decrypted → Registration Received → DB Instantiated → Cluster Formed → DB Ready (draft tally present)
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
| Escrow Service (N/A) | N/A | N/A | N/A | N/A | N/A | N/A |
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