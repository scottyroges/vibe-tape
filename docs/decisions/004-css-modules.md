# ADR 004: CSS Modules for Styling

**Status:** Accepted
**Date:** 2026-03

## Context

Choosing a styling strategy for the Vibe Tape UI. The project is a Next.js 15 App Router application.

## Decision

Use CSS Modules for styling. CSS Modules are built into Next.js, have zero runtime cost, and keep JSX clean by separating styles into co-located `.module.css` files.

## Alternatives Considered

### Tailwind CSS + shadcn/ui
- **Pros:** Fast prototyping, polished component primitives, large ecosystem
- **Cons:** JSX becomes cluttered with long class strings, requires learning Tailwind naming conventions, fights against custom design

### Styled Components (CSS-in-JS)
- **Pros:** Full CSS power with JavaScript expressions, co-located styles
- **Cons:** Runtime cost, React Server Components incompatibility, declining ecosystem momentum

## Why CSS Modules

- Built into Next.js — zero configuration, zero dependencies
- Write real CSS — full power of the language, no abstraction layer
- Automatic local scoping prevents style collisions
- Clean JSX — styles live in a separate file, markup stays readable
- No runtime cost — compiled at build time
- Works naturally with CSS custom properties for theming (light/dark mode)
- Smallest bundle impact of all options

## Consequences

- No pre-built component library — build components from scratch or adopt Radix UI for accessible primitives
- Switching between `.tsx` and `.module.css` files during development
- Dynamic/conditional styling is more verbose (ternaries over class names)
- No built-in design-token system — manage CSS custom properties manually
