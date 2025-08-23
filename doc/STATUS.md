# Taleus Project Development Roadmap and Current Status

This file tracks the development progress, issues to be resolved, and future enhancements for the Taleus project.

## Current Development Phase
**Design and Documentation Phase**
- [x] Initial project setup
- [x] Brainstorming core concepts and approaches
- [x] Basic architecture documented
- [ ] Finalize remaining architecture questions
- [ ] Complete protocol specification
- [ ] Design SQL schema for shared database model
- [ ] Resolve identity management questions
 - [x] Bootstrap methods evaluated; leading candidate selected (Method 6: Role-Based Link Handshake)

## Document Review and Issues Found

### Accuracy Assessment of AI-Generated Files

**README.md**: ✅ Accurate
- Correctly reflects the shared database model choice from PROJECT.md
- Accurately describes the libp2p stack (Taleus -> Quereus -> Optimystic -> Kademlia -> libp2p)
- Properly references the 50/50 voting power concept

**doc/architecture.md**: ⚠️ Mostly accurate but needs updates
- Correctly describes shared database model
- Contains some outdated references to "message-based model" comparisons that should be simplified
- Missing details about stock/foil nomenclature preference from PROJECT.md
- Missing specific details about tally record types

**doc/protocol.md**: ⚠️ Mostly accurate but needs updates
- Correctly describes shared database protocol
- Still contains message-based protocol references that should be removed/simplified
- Missing detailed record type specifications from PROJECT.md
- Needs more detail on the specific SQL operations

**doc/tally.md**: ✅ Mostly accurate
- Correctly captures most tally record types from Brainstorm.md
- Accurately describes party roles (stock/foil vs party1/party2 choice)
- Missing some specific details about chit digest format
- Good coverage of security considerations

**doc/messages.md**: ❌ OBSOLETE
- This file is obsolete given the shared database model choice
- Should be removed or completely rewritten to focus on database operations
- Currently confusing as it presents message-based as still under consideration

### AI Hallucinations and Unreasonable Extrapolations Identified

1. **doc/architecture.md**: 
   - References to "Byzantine fault tolerance at the database level" - this is not specifically mentioned in Brainstorm.md
   - Overly detailed consensus mechanism descriptions not grounded in the source material

2. **doc/protocol.md**:
   - Detailed "Route Discovery and Lifts" section - while lifts are mentioned, this level of detail wasn't specified
   - Some protocol versioning details that weren't requested

3. **doc/messages.md**:
   - Entire hybrid approach section is speculative
   - Message format details that contradict the shared database model choice

### Reference Resources

**MyCHIPs Repository**: https://github.com/gotchoices/MyCHIPs
- Schema definitions: `mychips/schema/tallies.wmt` (trading variables definitions)
- Original implementation patterns and data structures
- Protocol message examples and state transitions

### Missing Implementation Details Needed

Based on PROJECT.md, the following information needs clarification:

## Critical Questions for Implementation

### Schema Design Questions
1. **Record Storage Model**: ✅ **RESOLVED** - Use mostly normalized SQL schema with JSON fields where flexibility is needed

2. **Tally ID Generation**: ✅ **RESOLVED** - Tally UUID generated as hash of complete Tally Identity Chunk content (protocol version, timestamp, party IDs, master keys)

3. **Stock/Foil Nomenclature**: ✅ **RESOLVED** - Use stock/foil nomenclature (maintains compatibility with MyCHIPs)

### Identity and Key Management Questions
4. **SSI Implementation**: ✅ **RESOLVED** - did:key method recommended for SSI layer on top of libp2p
   - [x] Research SSI frameworks (did:key, did:ethr, did:ion, Hyperledger Indy) for hierarchical key derivation
   - [x] Clarify libp2p role as networking layer (not SSI alternative)
   - [x] Determine optimal SSI framework for master key + derived key validation
   - [x] Define key validation requirements for offline/distributed operation
   - [x] Comprehensive SSI framework analysis documented in doc/design/SSI.md

5. **Device Vault vs Exportable Keys**: 🔄 **RESEARCH NEEDED** - Need to evaluate options as part of overall key management strategy.

6. **Master Key Architecture**: ✅ **RESOLVED** - Master key system fully designed
   - [x] Define master key disclosure in Tally Identity Chunk
   - [x] Design Key Issuance Chunk for derived key management
   - [x] Specify key validation process (prove derivation from master)
   - [x] Define Tally Configuration Signature Block for chunk operability
   - [x] Merge Party Identity contact info into Party Certificate Chunk

6. **Multi-Key Registration**: How do we implement the ability to register multiple keys/seeds on a tally for recovery purposes?

7. **libp2p PeerID vs SSI**: ✅ **RESOLVED** - Party ID is libp2p peerID (hash of master key), maintains compatibility with libp2p while enabling key validation

### Protocol Implementation Questions
8. **Consensus Rule Implementation**: How exactly should the 50/50 voting power be implemented? What happens when nodes disagree?

9. **Local Record Storage**: What records should parties store locally for dispute resolution in addition to the shared database?

10. **Chit Digest Format**: ✅ **RESOLVED** - Chit digest format specified: tally ID, party indicator, date, memo, reference, units

### Contract and Negotiation Questions
11. **Contract Format**: Should contracts be PDFs or structured documents (YAML/JSON)? How do we handle content-addressable references?

12. **Negotiation Flow**: ✅ **RESOLVED** - Chunk-based negotiation with Tally Configuration Signature Blocks for atomic agreement

13. **Bootstrap Token System**: ✅ **RESOLVED** - Message-based bootstrap with one-time and multi-use invitation tokens

### Technical Stack Questions
14. **Quereus Integration**: What specific SQL operations will Quereus need to support? Do we need custom query types?

15. **Optimystic Configuration**: What optimistic database settings are appropriate for tally operations?

16. **Bootstrap and Discovery**: ✅ **PROTOTYPE COMPLETED** — Method 6 (Role-Based Link Handshake) implemented and tested. Sequential handler prototype validates design; production state machine implementation required for robustness

## Development Checklist

### Phase 1: Architecture Finalization (Current)
- [x] Resolve core architectural questions ✅ MAJOR PROGRESS
- [x] Design chunk-based data organization with signature blocks ✅ COMPLETED  
- [x] Specify exact record types and formats using stock/foil nomenclature ✅ COMPLETED
- [x] Document negotiation protocol details for shared database model ✅ COMPLETED
- [ ] Design complete normalized SQL schema (ready to implement from tally.md)
- [ ] Research and evaluate SSI vs alternative identity management approaches
 - [x] Document bootstrap methods and consolidate on Method 6 as leading approach ✅ COMPLETED
 - [x] Create POC implementation of Method 6 with sequential handler ✅ COMPLETED  
 - [x] Analyze concurrency and robustness requirements for production ✅ COMPLETED

### Phase 2: Bootstrap Production Implementation (Current Priority)
- [x] **Bootstrap Prototype**: Sequential handler POC validates Method 6 design ✅ COMPLETED
- [ ] **State Machine Refactor**: Replace sequential handler with production-grade state machine
  - [ ] Design `BootstrapSession` class with lifecycle management
  - [ ] Implement state transitions (DIALING → READING → VALIDATING → PROVISIONING → RESPONDING)
  - [ ] Add per-session timeout protection (configurable, default 30s)
  - [ ] Add session resource cleanup and error isolation
  - [ ] Add concurrent session processing (unlimited parallel bootstraps)
  - [ ] Add comprehensive session audit logging
  - [ ] Add rate limiting and DoS protection
  - [ ] Add graceful shutdown with session draining
- [ ] **Testing**: Multi-responder concurrent testing
  - [ ] Test multiple simultaneous responders (2, 5, 10+ concurrent)
  - [ ] Test timeout scenarios (network hangs, slow responses)
  - [ ] Test error isolation (one failed session doesn't affect others)
  - [ ] Test resource limits and cleanup
  - [ ] Load testing for production readiness
- [ ] **Documentation**: Update architecture docs for state machine approach

### Phase 3: Core Implementation
- [ ] Set up libp2p + Kademlia + Optimystic + Quereus stack
- [ ] Define Taleus module boundaries and interfaces (see "Upcoming Architecture Work")
- [ ] Provide `DatabaseProvisioner` interface (stub) to integrate Quereus/Optimystic when available
- [ ] Implement tally record types
- [ ] Implement party identification and certificates
- [ ] Implement credit terms and trading variables
- [ ] Implement chit creation and validation
- [ ] Implement consensus mechanism (50/50 voting)

### Phase 4: Testing and Validation  
- [x] Create test suite for bootstrap flows ✅ COMPLETED
- [x] Test Bootstrap Method 6 flows: one-time token, multi-use token, rejection paths, approval paths ✅ COMPLETED
- [ ] Create test suite for all record types
- [ ] Test negotiation flows
- [ ] Test consensus scenarios
- [ ] Test key rotation and recovery
- [ ] Test dispute resolution scenarios

### Phase 5: Integration and Deployment
- [ ] Re-integrate with MyCHIPs engine
- [ ] Create standalone implementations
- [ ] Documentation and examples
- [ ] Performance optimization

## Upcoming Architecture Work

- [ ] Identify and document core Taleus modules and their interfaces:
  - `BootstrapService` (Method 6 handshake, token, responder-node routing)
  - `IdentityService` (party IDs, certificates, future DID proofs)
  - `CadreManager` (node nomination, 50/50 governance orchestration)
  - `DatabaseProvisioner` (abstraction for Quereus/Optimystic instantiation and access control)
  - `TallyService` (draft tally creation; later: negotiation orchestration)
  - `CryptoService` (signing, digest, verification utilities)
  - `Config` (policy, timeouts, limits)

## Files Requiring Updates

### Immediate Updates Needed
- [x] **REMOVE doc/messages.md** - obsolete due to shared database model ✅ COMPLETED
- [x] **Update doc/architecture.md** - remove message-based references, add stock/foil details ✅ COMPLETED
- [x] **Update doc/protocol.md** - focus on database operations, remove message-based sections ✅ COMPLETED
- [x] **Enhance doc/tally.md** - add specific chit digest format, clarify record types ✅ COMPLETED
- [x] **Update README.md** - remove references to deleted messages.md file ✅ COMPLETED

### New Files Needed
- [ ] **doc/schema.md** - detailed SQL schema design
- [x] **doc/SSI.md** - SSI framework analysis and key management specification ✅ COMPLETED
- [x] **doc/design/bootstate.md** - bootstrap state management architecture analysis ✅ COMPLETED
- [ ] **doc/negotiation.md** - detailed negotiation flow for shared database model

---

*This document should be regularly updated as questions are resolved and implementation progresses.*