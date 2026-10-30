# Vendored fonts

Self-hosted copies of the Google Fonts used by this app, loaded through
`next/font/local` in `../layout.tsx` so production builds never fetch from
Google Fonts at build time (see vercel/next.js#99114).

| File | Family | Axes | Source |
|---|---|---|---|
| `dm-sans-latin-wght-normal.woff2` | DM Sans | wght 100–1000, latin subset | `@fontsource-variable/dm-sans@5.3.0` |
| `jetbrains-mono-latin-wght-normal.woff2` | JetBrains Mono | wght 100–800, latin subset | `@fontsource-variable/jetbrains-mono@5.3.0` |

Both are licensed under the SIL Open Font License 1.1; the licence texts sit
beside them. Fontsource republishes Google Fonts' own files unmodified.
