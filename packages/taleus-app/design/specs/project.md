# Project Spec

This document captures key decisions for the project. Complete this during the discovery phase before adding app scaffolds.

## Purpose

**What problem does this project solve?**
Taleus reimplements the MyCHIPs (mychips.org) project using Sereus Fabric (sereus.org) as a framework.  MyCHIPs is a network of private credit relationships over which financial transactions can occur in a highly distributed manner.  Where MyCHIPs was devoted solely to the CHIP as a Unit of Account, Taleus will support multiple UoA's.

**Who are the target users?**
Any accountable person who has a phone or connected device should be able to establish strands with other trusted users and engage in pledges of credit (chits).

**Delivery posture:**

Production / Industrial-strength — optimize for correctness, scalability, accessibility, maintainability

## Platforms

**What platforms will this project target?**

- [x] Mobile (iOS/Android); Immediate
- [?] Web (desktop browsers); Eventually
- [?] Desktop; Various libraries may be developed for integration into desktop or other dedicated/server applications (possibly elsewhere).

**Are experiences different per platform?**
Mobile and web are intended to be different experiences and have their own stories.

## Identity (publisher + app id)

These values are used to form stable application identifiers (especially for mobile).

- **Publisher id (reverse-DNS domain)**: `org.sereus`
- **Preferred app name**: `taleus`
- **Default mobile app id (reverse-DNS)**: `org.sereus.taleus`
- **Custom scheme**: `taleus`
- **Universal link host / claimed path**: `sereus.org`, `/taleus/invite/*` (landing page
  `sereus.org/taleus` is not claimed). Apex `.well-known` is shared with the other Sereus apps —
  merge, never overwrite.

## Apps

List the apps to be built:

| App Name | Platform | Framework | Status |
|----------|----------|-----------|--------|
| mobile | iOS/Android | react-native | planned |
| mobns | iOS/Android | svelt/nativescript | possibly later on |
| web | browser | sveltekit | eventual |

## Toolchain

### Mobile (if applicable)

- Framework: react-native
- Runtime: bare
- Language: typescript
- Package manager: npm

### Web (when applicable)

- Framework: sveltekit
- Language: typescript
- Package manager: npm

### Both

- Each `apps/<target>/` is a standalone npm project, not a member of the taleus root yarn
  workspaces. The `taleus` engine is consumed as a package.

## Data Strategy

**How will data be managed?**

- [x] Local-first, distributed (no central server)
- [x] Offline support required
- [x] Real-time updates (peers, cadre)

All tally/chit state comes from the `taleus` engine. Three run modes, switchable at one point in the
data layer: **mock** (fixtures + variants), **engine + local store** (single device), **engine +
cadre** (real strands, peers, lifts). Screens see only mock-vs-engine; the storage distinction stays
inside the data layer. See `design/specs/domain/interfaces.md`.

**Backend:**
Sereus fabric — sereus (cadre, strands), quereus (schema), optimystic (storage), fret (transport).

## Shared Resources

**What will be shared across targets?**

- [x] Domain contract — `design/specs/domain/`
- [x] Engine — the `taleus` package (`packages/taleus/`); behavior that is not app-specific belongs
      there, not in a target
- [x] Mock data — `mock/data/`

## Notes

**Quality / performance posture (brief):**
- Expected scale: large
- Critical interactions that must stay fast: to be identified during story authoring.
