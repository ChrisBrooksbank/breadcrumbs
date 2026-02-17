# CLAUDE.md

This file provides guidance to Claude Code when working with this codebase.

## Project Overview

A map-free GPS breadcrumb PWA for recording walking routes and retracing your steps.

## Development Commands

```bash
npm run dev            # Start Vite dev server
npm run build          # Production build
npm run preview        # Preview production build
npm test               # Vitest watch mode
npm run test:run       # Run tests once
npm run test:coverage  # Coverage report
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
npm run format         # Prettier format all files
npm run typecheck      # TypeScript type check
npm run knip           # Find unused code
npm run check          # Run all checks
```

## Architecture

### TypeScript with ES Modules

Path aliases configured:

- `@/*` -> `src/*`
