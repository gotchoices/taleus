# Toolchain Spec

language: ts
runtime: bare
packageManager: npm
navigation: react-navigation
state: zustand

notes:
- No HTTP client: all state comes from the taleus engine (`design/specs/domain/interfaces.md`).
