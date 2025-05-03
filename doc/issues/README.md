# Taleus Project Development Roadmap

This file tracks the development progress, issues to be resolved, and future enhancements for the Taleus project.

## Current Development Phase
**Design and Documentation Phase**
- [x] Initial project setup
- [x] Brainstorming core concepts and approaches
- [ ] Finalize architecture design
- [ ] Document protocol specification
- [ ] Define message formats
- [ ] Design tally structure

## Key Issues to Resolve

### Architecture Questions
- [ ] **Consensus Model**: Determine whether to implement message-based or shared database model
  - Original MyCHIPs uses a message-based protocol where each party maintains their own record
  - Taleus is considering a shared database model using libp2p/Kademlia
  - Pro/con analysis of each approach needed

- [ ] **Standard Definition**: Determine how the standard is defined
  - In message-based protocol, the message format is the standard
  - In shared-database model, the library implementation may become the standard
  - Define what constitutes the "standard" for Taleus implementation

### Identity Questions
- [ ] **Party ID Implementation**: 
  - Determine how party IDs are established, tracked, and potentially changed
  - Decide whether to use libp2p peerID as the party ID
  - Research how SSI (Self-Sovereign Identity) keys can be cycled
  - Explore alternatives to SSI

- [ ] **Key Management Strategy**:
  - Decide if private keys should be in device vault or exportable
  - Design method for dealing with lost devices
  - Determine if multiple keys/seeds can be registered on a tally for recovery

### Schema Design
- [ ] **Schema Structure**:
  - Design schema structure for shared database model
  - Consider single table with flexible content vs. fully-normalized SQL schema
  - Evaluate pros/cons of each approach

### Contract Implementation
- [ ] **Contract Structure**:
  - Decide contract format (PDF vs. structured document)
  - Determine how contract references are stored and validated

## Development Checklist

### Phase 1: Core Architecture
- [ ] Finalize architecture decisions (message-based vs. shared DB)
- [ ] Design tally record structure
- [ ] Document message formats or database schema
- [ ] Design protocol flow

### Phase 2: Implementation
- [ ] Set up libp2p infrastructure
- [ ] Implement party identification
- [ ] Implement tally management
- [ ] Implement chit structure
- [ ] Develop consensus mechanism

### Phase 3: Testing
- [ ] Develop test suite
- [ ] Test in simulated network environment
- [ ] Test with multiple implementation patterns

### Phase 4: Integration
- [ ] Re-implement back into MyCHIPs engine
- [ ] Consider standalone mobile phone implementation
- [ ] Documentation and examples

## Open Questions
These questions are extracted from the Brainstorm.md document and need resolution:

1. Is a shared database model preferable to the split tally model?
2. What are the pros/cons of each model?
3. How should tally balance sign be handled?
4. How do cycled keys work in SSI?
5. Can we create a libp2p peer id based on the original SSI seed?
6. Is it necessary to keep a hash chain in a shared database model?
7. What would the schema look like to contain a full tally?
8. What defines the "standard" in a shared-database model?

## Future Enhancements
- Multisignature support for tallies
- Advanced contract templating
- Integration with other identity systems
- Mobile-specific optimizations
- Visual tally representation tools

---

*This document should be regularly updated as issues are resolved and the project progresses.*