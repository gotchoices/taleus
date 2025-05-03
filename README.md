# Taleus

A standardized library for managing private credit tallies using libp2p.

## Overview

Taleus is a library for establishing, maintaining, and negotiating private credit relationships (tallies) between participants in a Private Credit Network (PCN).

- A **Private Credit Network (PCN)** is a graph network where:
  - Nodes represent individuals, organizations, or entities
  - Edges represent peer-to-peer credit relationships (tallies)
  
- A **tally** is a mutually signed contract between two parties that:
  - Formalizes a trusted relationship
  - Contains identifying information including cryptographic keys
  - Tracks transactions (chits) between parties
  - Enables credit-based exchanges of value
  - Allows for automated credit clearing (lifts)

Taleus extends and builds upon concepts developed in the [MyCHIPs](https://github.com/gotchoices/MyCHIPs) project, but focuses on creating a standalone, standard library implementation built atop modern peer-to-peer technologies.

## Features

- **Decentralized Architecture**: Built on [libp2p](https://libp2p.io/), enabling truly peer-to-peer interactions
- **Standard Library**: Provides a consistent implementation for multiple PCN applications
- **Secure Identity**: Uses cryptographic identity verification and signatures
- **Contract Management**: Handles contract references and agreement validation
- **Transaction Tracking**: Records and validates chits (transactions)
- **Consensus Mechanisms**: Ensures both parties maintain consistent records

## Current Status

Taleus is currently in the design and documentation phase. We are:

- Establishing architecture and protocol specifications
- Researching and comparing database models and identity frameworks
- Defining message formats and communication patterns
- Designing tally structures and operations

For a detailed roadmap of development, see [Development Roadmap](doc/issues/README.md).

## Architecture

Taleus implements a decentralized tally management system using:

- **libp2p**: For peer discovery, connection, and communication
- **Distributed Database**: For shared tally record management
- **Cryptographic Signatures**: For transaction verification and validation
- **Consensus Protocol**: For ensuring consistency across parties

The project is exploring two primary models:
1. **Message-based protocol**: Similar to MyCHIPs, where each party maintains their copy of records
2. **Shared database model**: Using a distributed database approach where peers maintain a shared record

See [Architecture Documentation](doc/architecture.md) for more details.

## Relationship to MyCHIPs

MyCHIPs serves as the prototype implementation for a PCN, demonstrating the viability of private credit as a medium of exchange. Taleus aims to:

1. Extract and standardize the core tally management functionality
2. Implement this functionality using modern peer-to-peer technologies
3. Create a reusable library that can be incorporated into various applications
4. Enable broader adoption of private credit networks

## Documentation

- [Architecture Overview](doc/architecture.md)
- [Protocol Specification](doc/protocol.md)
- [Message Formats](doc/messages.md)
- [Tally Structure](doc/tally.md)
- [Development Roadmap](doc/issues/README.md)

## Contributing

The Taleus project follows the principles outlined in the [CONTEXT.md](CONTEXT.md) file. When contributing:

- Follow normalized coding practices
- Use TypeScript
- Solve problems the right way, avoiding kludges
- Follow conventions found in existing code
- Use test-driven workflow

## License

[License information will be added]

---

*Taleus is currently in active development. Documentation and implementation details are subject to change.*