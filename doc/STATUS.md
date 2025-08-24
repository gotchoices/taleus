# Taleus Project Development Roadmap and Current Status

This file tracks the development progress, issues to be resolved, and future enhancements for the Taleus project.

## Current Development Phase
**Bootstrap Production Implementation** ✅ **CORE COMPLETED**
- [x] Initial project setup ✅ COMPLETED
- [x] Brainstorming core concepts and approaches ✅ COMPLETED
- [x] Basic architecture documented ✅ COMPLETED  
- [x] Bootstrap methods evaluated; leading candidate selected (Method 6: Role-Based Link Handshake) ✅ COMPLETED
- [x] **State machine bootstrap implementation** ✅ COMPLETED
- [x] **Core test suite (stock/foil roles)** ✅ COMPLETED
- [ ] **NEXT PRIORITY**: Concurrent testing and advanced scenarios
- [ ] Complete protocol specification
- [ ] Design SQL schema for shared database model
- [ ] Resolve identity management questions

## 🚀 **Next Steps When Resuming Development**

### **Immediate Next Actions:**
1. **Enable Concurrent Tests**: Continue progressive test enablement in `test/auto/bootstrap.ts`
   - Enable concurrent multi-use token test (`should handle multiple customers with same merchant token`)
   - Enable session isolation test (`should handle multiple concurrent sessions without blocking`)
   - Enable timeout and error recovery tests

2. **Test Coverage Validation**: 
   - Run full test suite: `npm test bootstrap.ts`
   - Verify all critical paths are covered (both stock and foil bootstrap flows)
   - Test rejection scenarios and error handling

3. **Documentation Updates**: Update remaining core docs to reflect state machine implementation
   - `doc/architecture.md` - replace TallyBootstrap with SessionManager/sessions
   - `doc/protocol.md` - update bootstrap protocol section

### **Current Implementation Status:**
- ✅ **State Machine Core**: SessionManager, ListenerSession, DialerSession classes fully implemented
- ✅ **Stream Lifecycle**: Fixed libp2p 3-message flow using new stream pattern for foil role
- ✅ **Basic Tests**: Stock role (2-msg), Foil role (3-msg), SessionManager, SessionHooks tests all passing
- ✅ **TypeScript/ESM Setup**: Full development environment working with Vitest

### **Key Achievement:** 
Successfully solved the libp2p stream lifecycle issue for 3-message bootstrap flows by using separate streams for multi-turn communication - a production-ready, non-hack solution that follows proper libp2p patterns.

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

### Phase 2: Bootstrap Production Implementation ✅ **CORE COMPLETED** 
- [x] **Bootstrap Prototype**: Sequential handler POC validates Method 6 design ✅ COMPLETED
- [x] **State Machine Implementation**: Separate ListenerSession and DialerSession classes ✅ **COMPLETED**
 - [x] Implement `SessionManager` class with dual session management ✅ COMPLETED
 - [x] Implement `ListenerSession` class (L_PROCESS_CONTACT → L_SEND_RESPONSE → [L_AWAIT_DATABASE] → L_DONE) ✅ COMPLETED
 - [x] Implement `DialerSession` class (D_SEND_CONTACT → D_AWAIT_RESPONSE → [D_PROVISION_DATABASE] → D_DONE) ✅ COMPLETED
 - [x] Implement multi-level timeout protection (session + step timeouts) ✅ COMPLETED
 - [x] Implement session resource cleanup and error isolation ✅ COMPLETED
 - [x] Implement clean SessionHooks interface ✅ COMPLETED
 - [x] Define message types and serialization (InboundContact, ProvisioningResult, DatabaseResult) ✅ COMPLETED
 - [x] Implement libp2p stream utilities (readJson, writeJson with timeout protection) ✅ COMPLETED
 - [x] **CRITICAL FIX**: Fixed libp2p stream lifecycle for 3-message foil bootstrap using new stream pattern ✅ COMPLETED
 - [ ] Add comprehensive session audit logging and metrics (basic logging implemented)
 - [ ] Add rate limiting and DoS protection (per-peer limits)
 - [ ] Add graceful shutdown with session draining
 - [ ] Create session-based consumer mocks for testing (basic mocks completed)
 - [ ] Create manual test apps demonstrating concurrent sessions
 - [ ] Implement timeout management (SessionTimeouts class) (basic timeouts implemented)
 - [ ] Implement session audit logging (SessionAudit class) (basic logging implemented)
 - [ ] Implement session metrics collection (SessionMetrics class)
 - [ ] Implement rate limiting (RateLimiter class)
- [x] **Testing**: Session-based testing architecture **FOUNDATION COMPLETED**
 - [x] Implement `ListenerSession` lifecycle tests (L_PROCESS_CONTACT through L_DONE) ✅ COMPLETED
 - [x] Implement `DialerSession` lifecycle tests (D_SEND_CONTACT through D_DONE) ✅ COMPLETED
 - [x] **Test stock role bootstrap** (2-message flow: InboundContact → ProvisioningResult) ✅ PASSING
 - [x] **Test foil role bootstrap** (3-message flow: InboundContact → ProvisioningResult → DatabaseResult) ✅ PASSING
 - [x] **Test SessionManager creation and configuration** ✅ PASSING
 - [x] **Test SessionHooks integration** ✅ PASSING
 - [ ] **NEXT PRIORITY**: Test session isolation (memory, timeouts, error boundaries)
 - [ ] **NEXT PRIORITY**: Test concurrent multi-use token scenarios (same token, different sessions)
 - [ ] Test timeout scenarios (connection hangs, hook timeouts, response timeouts)
 - [ ] Test error isolation (failed session doesn't affect other sessions)
 - [ ] Test resource cleanup (sessions properly cleaned up on completion/failure)
 - [ ] Test rate limiting (reject excessive connections from same peer)
 - [ ] Test graceful shutdown (drain active sessions before termination)
 - [ ] Load testing (100+ concurrent sessions, memory/performance validation)
- [ ] **Documentation**: Session architecture documentation
  - [x] Add state diagrams to `doc/bootstrap.md` (ListenerSession and DialerSession states) ✅ COMPLETED
  - [x] Add sequence diagrams to `doc/bootstrap.md` (message flow, concurrent sessions) ✅ COMPLETED  
  - [x] Add class architecture and usage examples to `doc/bootstrap.md` ✅ COMPLETED
  - [ ] Update `doc/architecture.md` with SessionManager and session classes
  - [ ] Add session monitoring and metrics interface documentation
  - [ ] **Review and Update Core Documentation for Consistency**:
    - [ ] Review `doc/architecture.md` - replace TallyBootstrap class with SessionManager/ListenerSession/DialerSession architecture
    - [ ] Review `doc/architecture.md` - update Hooks interface to SessionHooks with new structure (token.validate, database.provision, etc.)
    - [ ] Review `doc/architecture.md` - remove obsolete registerPassiveListener/initiateFromLink API references
    - [ ] Review `doc/protocol.md` - update TallyBootstrap protocol section with session-based message flows
    - [ ] Review `doc/protocol.md` - ensure protocol message types match bootstrap.md sequence diagrams
    - [ ] Review `doc/protocol.md` - remove obsolete sequential handler references
    - [ ] Review `doc/tally.md` - update bootstrap process references to point to doc/bootstrap.md instead of doc/design/bootstrap.md
    - [ ] Review `doc/tally.md` - ensure tally data chunk descriptions align with current bootstrap implementation
    - [ ] Check for obsolete TallyBootstrap class references across all documentation
    - [ ] Ensure consistent terminology (SessionManager, ListenerSession, DialerSession) across all docs

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