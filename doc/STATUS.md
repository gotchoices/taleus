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

## Document Review and Issues Found

### Accuracy Assessment of AI-Generated Files

**README.md**: ✅ Accurate
- Correctly reflects the shared database model choice from Brainstorm.md
- Accurately describes the libp2p stack (Taleus -> Quereus -> Optimystic -> Kademlia -> libp2p)
- Properly references the 50/50 voting power concept

**doc/architecture.md**: ⚠️ Mostly accurate but needs updates
- Correctly describes shared database model
- Contains some outdated references to "message-based model" comparisons that should be simplified
- Missing details about stock/foil nomenclature preference from Brainstorm.md
- Missing specific details about tally record types

**doc/protocol.md**: ⚠️ Mostly accurate but needs updates
- Correctly describes shared database protocol
- Still contains message-based protocol references that should be removed/simplified
- Missing detailed record type specifications from Brainstorm.md
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

Based on Brainstorm.md, the following information needs clarification:

## Critical Questions for Implementation

### Schema Design Questions
1. **Record Storage Model**: ✅ **RESOLVED** - Use mostly normalized SQL schema with JSON fields where flexibility is needed

2. **Tally ID Generation**: How exactly should we generate the UUID for tallies? Should it be a hash of both parties' IDs + creation date as suggested?

3. **Stock/Foil Nomenclature**: ✅ **RESOLVED** - Use stock/foil nomenclature (maintains compatibility with MyCHIPs)

### Identity and Key Management Questions
4. **SSI Implementation**: 🔄 **RESEARCH NEEDED** - Need to evaluate if SSI is the right approach and which framework to use. Design objective for now.

5. **Device Vault vs Exportable Keys**: 🔄 **RESEARCH NEEDED** - Need to evaluate options as part of overall key management strategy.

6. **Multi-Key Registration**: How do we implement the ability to register multiple keys/seeds on a tally for recovery purposes?

7. **libp2p PeerID vs SSI**: Should the party ID be the libp2p peerID directly, or derived from an SSI seed?

### Protocol Implementation Questions
8. **Consensus Rule Implementation**: How exactly should the 50/50 voting power be implemented? What happens when nodes disagree?

9. **Local Record Storage**: What records should parties store locally for dispute resolution in addition to the shared database?

10. **Chit Digest Format**: Should we implement the exact chit digest format specified in Brainstorm.md (tally ID, party indicator, date, memo, reference, units)?

### Contract and Negotiation Questions
11. **Contract Format**: Should contracts be PDFs or structured documents (YAML/JSON)? How do we handle content-addressable references?

12. **Negotiation Flow**: How exactly should the database-based negotiation work? What tables/records are created during negotiation?

13. **Offer Token System**: How should we implement the offer token system for tally proposals in the shared database model?

### Technical Stack Questions
14. **Quereus Integration**: What specific SQL operations will Quereus need to support? Do we need custom query types?

15. **Optimystic Configuration**: What optimistic database settings are appropriate for tally operations?

16. **Bootstrap and Discovery**: How should initial peer discovery work for tally establishment?

## Development Checklist

### Phase 1: Architecture Finalization (Current)
- [ ] Resolve remaining critical questions above
- [ ] Design complete normalized SQL schema (with JSON fields where needed)
- [ ] Specify exact record types and formats using stock/foil nomenclature
- [ ] Research and evaluate SSI vs alternative identity management approaches
- [ ] Document negotiation protocol details for shared database model

### Phase 2: Core Implementation
- [ ] Set up libp2p + Kademlia + Optimystic + Quereus stack
- [ ] Implement tally record types
- [ ] Implement party identification and certificates
- [ ] Implement credit terms and trading variables
- [ ] Implement chit creation and validation
- [ ] Implement consensus mechanism (50/50 voting)

### Phase 3: Testing and Validation
- [ ] Create test suite for all record types
- [ ] Test negotiation flows
- [ ] Test consensus scenarios
- [ ] Test key rotation and recovery
- [ ] Test dispute resolution scenarios

### Phase 4: Integration and Deployment
- [ ] Re-integrate with MyCHIPs engine
- [ ] Create standalone implementations
- [ ] Documentation and examples
- [ ] Performance optimization

## Files Requiring Updates

### Immediate Updates Needed
- [x] **REMOVE doc/messages.md** - obsolete due to shared database model ✅ COMPLETED
- [x] **Update doc/architecture.md** - remove message-based references, add stock/foil details ✅ COMPLETED
- [x] **Update doc/protocol.md** - focus on database operations, remove message-based sections ✅ COMPLETED
- [x] **Enhance doc/tally.md** - add specific chit digest format, clarify record types ✅ COMPLETED
- [x] **Update README.md** - remove references to deleted messages.md file ✅ COMPLETED

### New Files Needed
- [ ] **doc/schema.md** - detailed SQL schema design
- [ ] **doc/identity.md** - SSI and key management specification  
- [ ] **doc/negotiation.md** - detailed negotiation flow for shared database model

---

*This document should be regularly updated as questions are resolved and implementation progresses.*