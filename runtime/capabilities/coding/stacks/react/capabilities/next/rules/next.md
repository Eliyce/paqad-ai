# Next.js

- Do not mix the App Router (`app/`) and Pages Router (`pages/`) for the same feature; pick one per route tree and only mix during an explicit, documented migration.
- App Router files are Server Components by default — add `'use client'` only to the leaf components that need hooks, state, effects, or browser APIs; keep it as low in the tree as possible.
- Fetch data in Server Components or route handlers and keep secrets there; never put an API key or server-only env var in a `'use client'` file or a `NEXT_PUBLIC_`-prefixed variable.
- Use Server Actions (`'use server'`) for mutations and revalidate with `revalidatePath`/`revalidateTag` instead of manual client refetching; validate Server Action inputs server-side — they are public endpoints.
- Set caching intent explicitly per fetch/route (`fetch` `cache`/`next.revalidate` options, `export const dynamic`/`revalidate`); do not rely on defaults for data that must be fresh.
- Define page metadata via the `metadata` export or `generateMetadata`, not a hand-written `<head>`.
- Use `next/link` for internal navigation, `next/image` for images, and `next/font` for fonts rather than raw `<a>`/`<img>`/manual font tags.
- Co-locate `loading.tsx` and `error.tsx` (error files must be `'use client'`) with the route segment they cover so each segment has its own Suspense and error boundary.
