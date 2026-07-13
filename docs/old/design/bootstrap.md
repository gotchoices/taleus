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
**Status**: ✅ Defined with Rough Process Flow

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
**Status**: ✅ Defined with Rough Process Flow

**Summary**: Create database immediately, include access credentials in invitation.

**Key Characteristics**:
- ✅ Simpler implementation
- ⚠️ Resource commitment before validation
- ⚠️ Requires pre-authentication mechanisms

**Rough Process Flow**:
1. Initiator provisions a new shared DB instance (or namespace) and minimal access controls
2. Invitation includes DB connection info and scoped credentials (one-time or multi-use)
3. Respondent connects, submits registration (Party ID, proposed nodes, optional certificate)
4. Initiator validates and upgrades access; invites respondent’s nodes to join
5. Minimal draft tally is created/verified; DB access info provided; negotiation proceeds outside this file

### 3. Escrow Service Approach
**Status**: ⛔ Does not meet Must-Haves (centralized third-party escrow)
**Summary**: Third-party service facilitates initial handshake and database setup.

**Key Characteristics**:
- ✅ Reduces peer-to-peer complexity
- ❌ Introduces centralization dependency
- ⚠️ Third-party trust requirements

Note: This approach violates the Must-Have requirement for strictly peer-to-peer bootstrap and is therefore recommended for exclusion.

### 4. DHT-Based Discovery
**Status**: 🔄 Proposed alternative  

**Summary**: Use existing Kademlia DHT for initial contact and capability exchange.

**Key Characteristics**:
- ✅ Leverages existing infrastructure
- ⚠️ Complicates authentication and token validation
- ⚠️ May expose invitation attempts publicly

**Rough Process Flow**:
1. Initiator shares a DHT advert key (or out-of-band key) and rendezvous topic with token policy
2. Respondent connects and completes a token-bound challenge/response
3. Initiator discloses an encrypted offer capsule pointer; respondent decrypts and reads offer metadata
4. Respondent submits registration; initiator validates and instantiates the shared DB (or delegates builder per design)
5. Nodes join; minimal draft tally present; DB access info provided; negotiation proceeds outside this file

### 5. Offer-Record Discovery Method
**Status**: 🔄 New proposal (under development)

**Summary**: Party A shares a private link containing cluster info and an encrypted tally offer record accessible via token-based authentication.

**Key Characteristics**:
- ✅ Direct, private link distribution (email/QR)
- ✅ Pre-packaged offer streamlines negotiation preparation
- ✅ Supports both one-time and multi-use tokens
- ✅ Encrypted offer content; minimal metadata exposure

**Rough Process Flow**:
1. A shares a private link with token and pointer to an encrypted offer record (plus minimal bootstrap info)
2. B connects to an A responder node and presents the token; decrypts the offer record
3. B submits registration material (Party ID, proposed nodes) and either builds the DB (per design) or requests A to build
4. Builder instantiates shared DB; minimal draft tally present; DB access info provided to both parties
5. Nodes join; negotiation proceeds outside this file

---

### 6. Role-Based Link Handshake (Consolidation of 1 and 5)
**Status**: 🔄 Proposed consolidation (replaces 1 and 5 when adopted)
**Details**: Rough Process Flow and Detailed Flow below

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

#### Role-Based Link Handshake: Detailed Flow

1. Link Generation (Initiator → Out-of-band)
   - Compose a private link payload with:
     - Responder node peerIDs (contact endpoints only)
     - Authentication token with expiry (one-time or multi-use)
     - Intended role: stock or foil (determines builder)
     - Optional identity requirements reference (plain text or schema URI)
   - Distribute link via private channel (email/QR). No cadre peerIDs disclosed at this stage

2. Initial Contact (Respondent → Initiator Responder Node)
   - Respondent connects to any responder node listed in the link
   - Presents: token, Party ID, proposed cadre peerIDs, and (optionally) certificate/identity materials

3. Validation (Initiator)
   - Verify token expiry/format; evaluate identity requirements (deferred formal schema); sanity-check proposed nodes
   - Decision:
     - Reject: return reason; invite may remain valid (multi-use) or be closed (one-time)
     - Approve: proceed and disclose participating cadre peerIDs

4. Builder Selection and DB Instantiation
   - If role = stock: Initiator builds the shared Quereus/Optimystic DB instance
   - If role = foil: Respondent builds the shared DB instance
   - Prepare minimal access controls and share DB connection info with the counterparty

5. Cadre Formation (Post-Validation Disclosure)
   - Disclose participating cadre peerIDs (both parties)
   - Invite nominated nodes to join; enforce 50/50 governance parameters

6. Draft Tally Preparation and Handoff
   - Insert/verify a minimal draft tally sufficient to begin negotiation (identity/config prerequisites as needed)
   - Provide DB access information to both parties (no pre-flight read/write required)
   - Handoff: Subsequent tally negotiation is out of scope for this file

State Transitions (for tracking):
- Link Shared → Contact Established → Validation Complete → DB Instantiated (by stock/foil per role) → Cadre Formed → DB Ready (draft tally present)
### Future Methods
Additional approaches can be added as separate files and referenced here.

## Comparison Matrix

| Method | Simplicity | Security | Reliability | Performance | UX | Decentralization |
|--------|------------|----------|-------------|-------------|----|--------------| 
| Pre-Authenticated Handshake | Medium | High | High | Good | Good | Excellent |
| Database-First | High | Medium | Medium | Good | Good | Good |
| Escrow Service (N/A) | N/A | N/A | N/A | N/A | N/A | N/A |
| DHT Discovery | Medium | High | Medium | Good | Good | Excellent |
| Offer-Record Discovery | Medium | High | Medium | Good | Good | Excellent |

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
1. Adopt Method 6 as the leading candidate pending resolution of its design items (1–4 above)
2. Specify identity requirement proof formats (deferred item 3) and finalize minimal draft tally components
3. Produce a small POC for Method 6 bootstrap flow (message exchange, DB instantiation, draft tally insertion)
4. Reassess the comparison matrix after POC results; mark Methods 1 and 5 as covered by Method 6

*This file should be updated as each method is analyzed and the final decision is made.*