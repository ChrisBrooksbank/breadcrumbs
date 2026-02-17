# AGENTS.md - Operational Guide

Keep this file under 60 lines. It's loaded every iteration.

## Build Commands

```bash
npm run build          # Production build (tsc + vite)
npm run dev            # Development server
```

## Test Commands

```bash
npm test               # Run tests (watch mode)
npm run test:run       # Run tests once
npm run test:coverage  # Coverage report
```

## Lint & Format

```bash
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
npm run format         # Prettier format all files
npm run typecheck      # TypeScript type check
npm run knip           # Find unused code
```

## Validation (run before committing)

```bash
npm run check && npm run test:run   # Run ALL checks + tests
```

## Tech Stack

- TypeScript (strict) + Vite + PWA (vite-plugin-pwa)
- Vitest + jsdom for testing
- ESLint + Prettier for code quality
- Path alias: `@/*` -> `src/*`

## Project Notes

- This is a map-free GPS breadcrumb PWA
- Offline-first, no map tiles, GPS coordinates only
- Multi-modal feedback: visual, audio, haptic
- Target users: elderly, visually impaired, distracted tourists
- See PRODUCT.md for full product vision
- See RESEARCH.md for competitive analysis
