  
  
Technical Details

- Taleus will be built on libp2p.  Specifically, the stack is:
  - Taleus -> SQLiter -> Optimystic -> Kademlia -> libp2p
    https://github.com/gotchoices/sqliter
    https://github.com/gotchoices/Optimystic
- Tallies contain several types of records
  - Tally ID:
    - Somewhere, somehow, we need to establish a UUID or similar ID for the tally so all other records can be relational to it.
    - Current thinking is to establish this as a hash of data that includes both parties' ID's and the tally creation date.
  - Party ID and keys: 
    - Each of the two parties to the tally need to have an ID recorded on, or associated with the tally.
    - The two parties need to be distinctly identified.  Current thinking is to keep the historical stock/foil
    terminology from MyCHIPs and so to refer to one party as stock and the other as foil.
    - Whoever first forms a tally proposal would record their ID first and become stock (or proposer)
    - The respondant would become foil (or respondant)
    - Transactions in the tally ledger will be signed.  By default, a positive number represents a pledge of value from foil to stock.  Negative numbers are a pledge from stock to foil.
    - The party ID should be a libp2p peerid if possible
    - However, if the party ID ever has to change, it necessitates closing the tally and opening a new one.
    - IOW, the party ID should be writable one-time to a tally and be immutable through the life of the tally.
    - It would be nice if the party ID could be derived from a SSI (self-sovereign-identify) seed so that
      a party could issue a series of keys over the lifetime of the tally.  Is there a way to do this with SSI?
      (see https://www.identity.com/self-sovereign-identity/)
      All new keys issued would be the progeny of the original seed ID so they could be verified as valid by
      the partner.  But a partner could invalidate old keys and issue new ones as needed.
    - If we use SSI (or similar) can/should the private key be contained within a device vault (i.e. not even
      accessible to the user)?  Or should the private key be exportable so it can be moved from one device to
      the next?
    - If the private key(s) are kept in a device vault, do we have a way to deal with lost devices?  Can I
      register multiple keys (or key seeds) on a tally so I can use them to revoke old keys or register new
      keys later?
  - Identity Certificate
    - Each party should disclose to the other a set of identifying information collectively referred to as the party's certificate.
    - This includes things such as:
      - All names the person has been known by
      - Communication points (phone, pager, email, web, etc)
      - Addresses (home, mailing, shipping, etc)
      - Files (images, scans, documents).  These might be content addresses (like ipfs).
      - Key(s) perhaps public key info belongs in the certificate
    - Certficates should be signed by the party they represent (certifying a representation/disclosure) to the other party.
  - Credit offering
    - This represents the credit limit, call term, and possibly other terms one party extends to the other.
    - It must be signed by the party offering/extending the terms
    - An new record (amendment) can be logged to the tally at any time
    - But if it represents a restriction, it will only take effect after the call term (in days) has expired
  - Contract
    - This record references a governing document which is the agreement between the parties
    - It must be signed (representing acceptance) by both parties to be in force
    - This will typically be an IPFS or similar content-based address/reference
    - The nodes that host the tally will be duty-bound to host/cache any such documents referenced by the
      tallies they handle
    - A new contract record can be logged at any time by either party.  It becomes operative when signed by
      the other party.
    - The format of the document must be understood by the system and/or the parties.  Presumably this could
      just be a PDF document.  But there are some advantages to the structured document format used in the
      original MyCHIPs as it is nearly all content (and no formatting) and so makes it easier to understand
      what is being hashed (to know that two different documents are distinct and not just a differently
      formatted/presented version of the same thing).
  - Trading Variables
    - This record contains four variables that instruct automated agents how to perform credit lifts
      on behalf of the party.
    - This record is signed by only one party to signify how to treat trades from his perspective of the tally.
    - The file mychips/schema/tallies.wmt contains definitions for these values.
      - bound: The upper limit of credit that may be produced by any lift
      - target: The ideal balance to be reached by lifting
      - margin: An amount to charge for lifts exceeding target
      - clutch: An amount to charge for lifts in the reverse direction (drops)
  - Chit
    - A chit is a pledge for a certain number of CHIPs
    - It is signed by the party making the pledge
    - The digest consists of the following serialized fields:
      - ID of the tally the chit belongs to
      - Which party is issuing the pledge (s or f)
      - Date of the pledge (format: YYYY-MM-DDTHH:mm:ss.SSSZ in UTC)
      - Memo (human readable comment)
      - Reference (machine readable json)
      - Units (integer number of milliCHIPs as a positive number)
    - A tally maintains a total balance which is the net sum of all valid chits.
  - Chit Request
    - This requests a certain number of CHIPs from the other party
    - It should be signed by the party requesting the payment
    - The other party should read it, process it, and then create a chit in response to it
  - Close Request
    - Either party can register a record requesting the tally to close
    - The record must be signed by the requesting party
    - The tally will remain open until its balance reaches zero, at which point it is closed
    - Zero balance can be achieved throught lifts or manual chits
    - A tally marked as closing should only accept chits that move it closer to zero
- Tally records can stand on their own in terms of their validity (cryptographic signatures).  However
  each record needs to be linked back to a universally unique identifier (tally ID) so they can be taken
  in context.
- In the event of a corrupt partner (who somehow tries to delete or hide records), it is up to the
  other partner to maintain posession of all records that protect his position (for example, signed pledges
  from the other party).  A complete tally is the collection of all duly signed records that reference
  the tally ID.  The parties might end up in court presenting 'their version' of the tally, but the legally
  binding tally is the set of all valid records produced by the parties.

Questions/observetions
- Original model
  - In the original MyCHIPs, each party was responsible for keeping a separate record of his half of the tally.
  - This required some kind of consensus algorithm to help the two parties keep their copies of the ledger consistent.
  - Parties to the tally were identified by the historical tags 'stock holder' and 'foil holder'
  - So one party's copy of the tally was 'the stock' and the other party held 'the foil'
  - Tally negotiation and Synchronization was accomplished by a protocol of messages sent back and forth between the parties.
- Shared database model
  - Taleus will pursure this model where:
    - Each party will propose a set of libp2p nodes to participate in management of the tally
    - The resulting set of nodes will establish a common network
    - A kademlia database will established on the network
    - Optimystic implements an optimistic database model atop kademlia
    - SQLiter implements a query parser on top of Optimystic
    - The parties will communicate with each other by writing records to the SQL database
  - Question: is this model preferable to the split tally (message-protocol) model?
- Tally balance sign
  - In the original MyCHIPs, parties would think of net positive pledges to themselves as an asset 
    (positive number) and net pledges to the other party as a liability (negative number)
  - But if the tally were ever represented externally, it would need a more objective measure
  - For that context, a positive tally balance represents money owed by the foil holder to the stock holder.
  - Going to the shared database model, can we keep the stock/foil references if, for no other reason,
    to keep track of what a positive or negative number means?
- Libp2p peerID's vs SSI identities
  - How do cycled keys work in SSI?
  - Can we create a libp2p peer id based on the original SSI seed, as opposed to the 'current public key'?
  - Are there alternatives to SSI that might work better?
- Schema
  - The original MyCHIPs implementation stored tallies as follows:
    - Tally header (contained party identification, contract, initial terms)
    - Chits (originally for payments only but settings, trading variables were wedged into the same model)
    - Chits were stored in a hash-chain so as to easily verify consenus (by comparing end of chain index and hash)
  - With a shared database model, we probably don't need to keep a hash chain at all
    - However consider the byzantine case where one party has more nodes than the other and
      purposely throws away certain records in order to gain advantage.
    - In this case, even though the parties operate on a shared database, individual parties will need a way
      to locally store valuable records the other party refuses to acknowledge/store so the true tally can
      be proven in court.
    - Can we employ a consensus rule where each party nominates certain nodes to be part of the network.
    - The nodes that represent party A get 50% of the vote and party B's nodes geet 50% of the vote.
    - In this way, either consensus is reached (both parties agree) or the parties disagree.  If they disagree, it is up to the humans to work out their differences in court or arbitration by producing cryptographic records and proving the accurate tally balance and terms.
  - What would an SQL schema look like to contain a full tally?
    - We will build an example schema to explore this
- Standard
  - The objective of this library is to establish the standard by which all MyCHIPs-compliant PCN nodes operate.
  - In the case of a message-based protocol (like the original MyCHIPs), the standard was in the message 
    packets themselves.  It was up to the implementation to store state as it will.
  - In the case of shared-database model (Taleus), it seems the libary itself becomes more of the standard  (or at least the SQL schema).
  
      
