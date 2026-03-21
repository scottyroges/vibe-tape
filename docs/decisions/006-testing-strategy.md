# ADR 006: Testing Strategy

**Status:** Accepted
**Date:** 2026-03

## Context

Need a testing strategy so all new code ships with tests from the start. Want a testing pyramid: strong unit tests for business logic, integration tests for service/router composition, and a few E2E tests for critical user flows.

## Decision

Use **Vitest** for unit and integration tests, **React Testing Library** for component tests, and **Playwright** for E2E tests.

### Unit & Integration — Vitest

- Native ESM support — matches Next.js 15 / TypeScript ESM config
- Native TypeScript — no `ts-jest` config needed
- 3-5x faster than Jest in benchmarks
- Next.js App Router docs recommend Vitest over Jest for unit testing
- `vite-tsconfig-paths` resolves the `@/*` path alias from tsconfig

### Component Testing — React Testing Library

- Standard for behavior-driven component tests with React 19
- `@testing-library/react` ^16.x supports React 19
- Caveat: async Server Components aren't unit-testable yet — cover with E2E instead

### E2E — Playwright

- Cross-browser (Chromium, Firefox, WebKit/Safari) — Cypress lacks WebKit
- Native parallel execution — no paid tier needed
- `webServer` config auto-starts Next.js for tests
- MIT-licensed, no vendor lock-in

## Testing Pyramid

| Layer | Coverage Target | Scope | What to Test |
|-------|----------------|-------|-------------|
| Unit | 70-80% | `services/`, `domain/`, `lib/`, `hooks/`, `components/` | Business logic, type guards, utilities, hooks, presentational components |
| Integration | 15-20% | `server/routers/`, service+repo combos, feature components | tRPC procedures via `createCallerFactory`, service orchestration |
| E2E | 5-10% | Critical user flows | Spotify auth flow, seed picker → playlist generation |

## File Organization

| Code | Test Location | Rationale |
|------|--------------|-----------|
| `src/components/`, `src/hooks/`, `src/app/` | Co-located `*.test.tsx` next to source | React convention, tightly coupled, won't be extracted |
| `src/server/`, `src/services/`, `src/domain/`, `src/lib/` | `tests/` directory mirroring `src/` | Backend convention, clean extraction |
| Critical user flows | `e2e/` directory | Cross-cutting, browser-driven |

## Alternatives Considered

- **Jest** — experimental ESM support, slower, requires `ts-jest` config overhead
- **Cypress** — no WebKit support, parallel execution requires paid Cloud tier

## Consequences

- All new code should ship with tests — co-located for frontend, mirrored in `tests/` for backend
- Server Components tested via E2E rather than unit tests until the ecosystem catches up
- CI pipeline runs Vitest (fast, on every push) and Playwright (slower, on PRs to main)
