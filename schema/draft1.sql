create table Stock (
    Sid text not null,
    InvitationKey text not null,    --public key of sk sent to invited party
    Signature text null,    -- Signed using party key
    
    primary key (/* 1 row */),
    constraint SignatureValid check (SignatureValid(
        Digest(
            Sid, 
            InvitationKey
        ), 
        Signature, 
        (select PublicKey from PartyKey PK where PK.Sid = New.Sid order by Revision desc limit 1)
    )) on insert,
    constraint InsertOnly check (0) on delete, update
);

create table Foil (
    Sid text not null,
    Signature text not null,  -- signed using the out of band exchanged private key
    
    primary key (Sid),
    constraint InvitationSignatureValid check (SignatureValid(
        Digest(Sid), 
        Signature, 
        (select InvitationKey from Stock)
    )) on insert,
    constraint PartyExists check (select count(*) from PartyKey PK where PK.Sid = New.Sid) on insert,
    constraint InsertOnly check (0) on delete, update
);

create table PartyKey (
    Sid text not null,  -- Cid hash of first revision
    Revision integer not null,
    PublicKey text not null,
    Signature text null,    -- Signed using prior if this is revision > 1
    
    primary key (Sid, Revision),
    constraint RevisionMonotonicInt check (Revision = Coalesce((select max(Revision) from PartyKey PK where PK.Sid = New.Sid), 0) + 1) on insert,
    constraint SignatureValid check (SignatureValid(
        Digest(Sid, Revision, PublicKey),
        Signature,
        (select case when Revision = 1 then (select InvitationKey from Stock) else (select Signature from PartyKey PK where PK.Sid = Sid and PK.Revision = Revision - 1) end PriorSignature from PartyKey PK where PK.Sid = Sid and PK.Revision = Revision)
    )) on insert,
    constraint InsertOnly check (0) on delete, update,
    constraint TwoParities check ((select count(distinct Sid) from PartyKey) = 2)) on insert
);

create table PartyCertificate (
    PartySid text,
    Revision integer,
    Certificate text not null,
    Signature text not null,
    
    primary key (PartySid, Revision),
    constraint RevisionMonotonicInt check (Revision = Coalesce((select max(Revision) from PartyCertificate PC where PC.PartySid = New.PartySid), 0) + 1) on insert,
    constraint SignatureValid check (SignatureValid(
        Digest(PartySid, Revision, Certificate),
        Signature,
        (select PublicKey from PartyKey PK where PK.Sid = New.Sid order by Revision desc limit 1)
    )) on insert,
    constraint InsertOnly check (0) on delete, update
);

create table TallyContractProposal (
    SequenceNumber integer not null,
    ContractCid text not null,
    Proposer text not null check Proposer in ('S', 'F'),
    Signature text not null,

    primary key (/* 1 row */),
    constraint SignatureValid check (SignatureValid(
        Digest((select Cid from TallyCore), SequenceNumber, ContractCid, Proposer), 
        Signature, 
        (select case when Proposer = 'S' then StockSid else FoilSid end ProposerSid from TallyCore)
    )) on insert, update
);


create table TallyContract (
    Number integer not null,
    ContractCid text not null,
    -- TODO: Credit terms (limit, call) - arguments to contract
    StockSignature text not null,
    FoilSignature text not null,

    primary key (Number),
    constraint StockSignatureValid check (SignatureValid(
        Digest((select Cid from TallyCore), Number, ContractCid),
        StockSignature,
        (select PublicKey from PartyKey PK where PK.Sid = StockSid order by Revision desc limit 1)
    )) on insert, update,
    constraint FoilSignatureValid check (SignatureValid(
        Digest((select Cid from TallyCore), Number, ContractCid),
        FoilSignature,
        (select PublicKey from PartyKey PK where PK.Sid = FoilSid order by Revision desc limit 1)
    )) on insert, update,
    constraint InsertOnly check (0) on delete, update
);

-- TODO: Trading variables (bound, target, margin, clutch) - should "see" invoice and pending transactions

-- TODO: payment request (invoices)

create table Ledger (
    Number integer, -- Sequential, monotonically increasing
    ContractNumber integer,
    Id text default RandomUUID(),
    Issuer text check Issuer in ('S', 'F'), -- S = Stock, F = Foil
    Units integer check Units > 0,
    Date text check ValidDate(Date),
    Reference text, -- JSON object
    Memo text,
    Signature text,
    Balance integer,
    -- TODO: lift vs manual
    -- TODO: pending lift

    primary key (Number),
    constraint SignatureValid check (SignatureValid(
        Digest(
            Id, 
            Issuer, 
            (select case when Issuer = 'F' then FoilSid else StockSid end RecipientSid from TallyCore), 
            Units, 
            Date, 
            Reference, 
            Memo
        ), Signature, IssuerSid)
    ) on insert,
    constraint BalanceCorrect check (
        Coalesce((select Balance from Ledger where Number = Number - 1), 0) 
            + (Units * case when Issuer = 'F' then 1 else -1 end) = Balance
    ) on insert,
    constraint ValidIssuer check (IssuerSid in (select StockSid from TallyCore)) on insert,
    constraint InsertOnly check (0) on delete, update
);

