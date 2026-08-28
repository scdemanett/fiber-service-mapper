# Vercel Deployment — apps/public

## Prerequisites

- The admin app is running locally and connected to your Supabase database.
- Your Supabase project already has data (sources, selections, serviceability checks).

## One-time Vercel project setup

1. Push this repo to GitHub (if not already done).
2. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repo.
3. In the **Configure Project** screen, expand **Root Directory** and set it to:
   ```
   apps/public
   ```
4. Framework preset will auto-detect as **Next.js**. Leave build settings as defaults.
5. Under **Environment Variables**, add:

   | Name | Value |
   |------|-------|
   | `DATABASE_URL` | Your Supabase **transaction pooler** URL (port 6543) |
   | `NODE_ENV` | `production` |
   | `NEXT_PUBLIC_BASE_URL` | `https://your-project.vercel.app` (update after first deploy) |
   | `NEXT_PUBLIC_CARTO_API_KEY` | Carto raster basemap API key |

   Your Supabase pooler URL looks like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
   ```

6. Click **Deploy**.

## Automatic GitHub deploys

After the initial setup, every push to `main` triggers a new Vercel build automatically.

The `vercel.json` in this directory configures the ignored build step to skip unnecessary
rebuilds when only admin-side files changed:

```json
{
  "ignoreCommand": "git diff HEAD^ HEAD --quiet -- apps/public packages/"
}
```

This means only commits touching `apps/public/` or `packages/` will trigger a Vercel build.

## Local development

```bash
# From the repo root:
npm run dev:public     # starts apps/public on port 3001
npm run dev:admin      # starts apps/admin on port 3000
```

Both can run simultaneously since they use different ports.
