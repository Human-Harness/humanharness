# Human Harness

## UI work

Every change that touches UI follows the Radix + Impeccable spec (`docs/superpowers/specs/2026-11-04-radix-impeccable-design.md`):

- Read `PRODUCT.md` and `DESIGN.md` first; use the `impeccable` skill (`.claude/skills/impeccable/`).
- Build only with pieces from `packages/ui/src/guide` (Radix pieces as `Rx`); never import `@radix-ui/themes` elsewhere.
- Loop: shape (a short plan in the PR) → build → screenshots light and dark through an e2e spec → critique and fix, three rounds at most.
- Decide no visual value the spec or DESIGN.md does not state: ask, with a "Dejar para después" option.
