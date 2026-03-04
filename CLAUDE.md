# Smart Lists

Next.js shopping list app with real-time collaboration and internationalization.

## Commands

- `npm run dev` — dev server
- `npm run build` — migrate DB + build
- `npm run lint` — ESLint

## Tech Stack

- Next.js, React 19, TypeScript
- Tailwind CSS 4, Framer Motion
- NextAuth v5 (Google OAuth)
- Prisma + PostgreSQL
- next-intl (ru/vi locales)
- Zod (validation), React Hot Toast

## Structure

- `src/app/components/` — all components (PascalCase)
- `src/app/actions.ts` — Server Actions
- `src/lib/validations.ts` — Zod schemas
- `src/lib/db.ts` — Prisma singleton
- `src/i18n/` — i18n config
- `prisma/schema.prisma` — DB models

## Conventions

- Server Components by default, `"use client"` only when needed
- Optimistic updates with `useOptimistic`
- All validation via Zod `.safeParse()` (no exceptions)
- Locale in URL path: `/ru`, `/vi` (default: ru)
- Comments in Russian (project documentation)
- Black-white style for app

Please don't forget to add comments (project documentation) when needed