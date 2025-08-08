# Bootstrap Method Evaluation and Comparison

## Purpose
This document tracks and compares multiple proposed methods for the tally bootstrap process - the sequence leading up to establishing a shared database where partners can begin tally negotiations.

## Current Status
**Decision Status**: 🔄 **Under Evaluation**
**Recommended Approach**: *TBD after comparison analysis*

## Evaluation Criteria

### Technical Criteria
- [ ] **Simplicity**: Implementation complexity and maintenance burden
- [ ] **Security**: Authentication, authorization, and attack resistance  
- [ ] **Reliability**: Fault tolerance and error recovery
- [ ] **Performance**: Latency, resource usage, and scalability
- [ ] **libp2p Integration**: How well it leverages existing libp2p capabilities

### Operational Criteria  
- [ ] **User Experience**: Ease of invitation and acceptance
- [ ] **Decentralization**: Dependency on third parties or central services
- [ ] **Resource Efficiency**: Database/node commitment before validation
- [ ] **Flexibility**: Support for one-time vs multi-use invitations
- [ ] **Recovery**: Handling of failed or abandoned bootstrap attempts

## Bootstrap Methods Under Consideration

### 1. Pre-Authenticated Handshake Method (Current)
**Status**: ✅ **Currently Specified** in `doc/tally.md`
**File**: `doc/bootstrap/pre-authenticated-handshake.md`

**Summary**: Uses libp2p messages for initial handshake with token-based pre-authentication, creates database only after validation.

**Key Characteristics**:
- ✅ Pre-validation before resource commitment
- ✅ Supports both one-time and multi-use tokens
- ✅ Token-based authentication before cluster formation
- ⚠️ More complex message handling
- ⚠️ Requires separate authentication mechanism

### 2. Database-First Approach  
**Status**: 🔄 **Proposed Alternative** (mentioned in `doc/tally.md`)
**File**: `doc/bootstrap/database-first.md`

**Summary**: Create database immediately, include access credentials in invitation.

**Key Characteristics**:
- ✅ Simpler implementation
- ⚠️ Resource commitment before validation
- ⚠️ Requires pre-authentication mechanisms

### 3. Escrow Service Approach
**Status**: 🔄 **Proposed Alternative** (mentioned in `doc/tally.md`)
**File**: `doc/bootstrap/escrow-service.md`

**Summary**: Third-party service facilitates initial handshake and database setup.

**Key Characteristics**:
- ✅ Reduces peer-to-peer complexity
- ❌ Introduces centralization dependency
- ⚠️ Third-party trust requirements

### 4. DHT-Based Discovery
**Status**: 🔄 **Proposed Alternative** (mentioned in `doc/tally.md`)  
**File**: `doc/bootstrap/dht-discovery.md`

**Summary**: Use existing Kademlia DHT for initial contact and capability exchange.

**Key Characteristics**:
- ✅ Leverages existing infrastructure
- ⚠️ Complicates authentication and token validation
- ⚠️ May expose invitation attempts publicly

### 5. Offer-Record Discovery Method
**Status**: 🔄 **New Proposal** (under development)
**File**: `doc/bootstrap/offer-record-discovery.md`

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

**Note**: *Full technical specification and implementation details pending - placeholder for tomorrow's discussion.*

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

*Rankings: Excellent > High > Good > Medium > Low > Poor*

## Decision Factors

### Must-Have Requirements
- [ ] Support for one-time invitation tokens
- [ ] Support for multi-use invitation tokens  
- [ ] Authentication of parties before database commitment
- [ ] Graceful handling of failed/rejected invitations
- [ ] Integration with libp2p networking layer

### Nice-to-Have Features
- [ ] Minimal resource commitment before validation
- [ ] Simple implementation and maintenance
- [ ] Leverages existing libp2p/DHT infrastructure
- [ ] Good user experience for both parties
- [ ] Supports offline invitation delivery (QR codes, etc.)

## Implementation Checklist

### Evaluation Phase
- [ ] Detail each method in separate files
- [ ] Complete comparison matrix analysis
- [ ] Identify implementation complexity for each
- [ ] Consider integration with existing Taleus architecture
- [ ] Evaluate security implications of each approach

### Decision Phase  
- [ ] Select recommended approach based on criteria
- [ ] Document decision rationale
- [ ] Update main documentation to reflect choice
- [ ] Plan migration path if changing from current method

### Implementation Phase
- [ ] Create detailed implementation specification
- [ ] Update relevant protocol documentation
- [ ] Consider TLA+ modeling requirements (see doc/TLA.md)
- [ ] Plan testing strategy for bootstrap scenarios

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
1. Create detailed documentation for each method in `doc/bootstrap/` directory
2. Complete comparison matrix analysis
3. Make recommendation based on evaluation criteria

*This file should be updated as each method is analyzed and the final decision is made.*