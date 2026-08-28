# Fiber Service Mapper

A monorepo for tracking and visualizing fiber internet service availability across addresses. Features batch serviceability checking, interactive mapping with timeline playback, and a public-facing read-only dashboard deployable to Vercel.

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)

## ⚡ Quick Start

```bash
# Clone and install all workspaces
git clone <your-repo-url>
cd fiber-service-mapper
npm install

# Setup environment files
cp packages/db/.env.example packages/db/.env
cp apps/admin/.env.example apps/admin/.env
# Edit both .env files with your database credentials

# Push schema to the database (also applies expression indexes automatically)
npm run db:push --workspace=packages/db

# Start the admin app (full functionality)
npm run dev:admin

# Or start the public app (read-only dashboard + map)
npm run dev:public
```

- Admin app: [http://localhost:3000](http://localhost:3000)
- Public app: [http://localhost:3001](http://localhost:3001)

## Screenshots

### Admin Dashboard
![Dashboard view showing overview statistics and quick access to all features](/screenshots/admin-dashboard.jpg?v=2)

### Admin GeoJSON Upload
![Upload interface for importing address data from GeoJSON files](/screenshots/admin-upload.jpg?v=2)

### Admin Address Selections
![Selection management interface for creating and managing address campaigns](/screenshots/admin-selections.jpg?v=2)

### Admin Batch Serviceability Checker
![Batch checker interface with progress tracking and pause/resume controls](/screenshots/admin-checker.jpg?v=2)

### Admin Interactive Map with Timeline
![Interactive map with color-coded service availability markers and filtering options](/screenshots/admin-map.jpg?v=2)

### Public Dashboard
![Dashboard view showing overview statistics and quick access to all features](/screenshots/public-dashboard.jpg?v=2)

### Public Interactive Map with Timeline
![Interactive map with color-coded service availability markers and filtering options](/screenshots/public-map.jpg?v=2)

## Repository Structure

```
fiber-service-mapper/
├── apps/
│   ├── admin/          # Full-featured local app (upload, checker, map, dashboard)
│   └── public/         # Read-only public site (dashboard + map) — deploys to Vercel
└── packages/
    ├── db/             # Prisma schema, client, and CLI config
    ├── lib/            # Shared utilities (API decoder, batch processor, parsers)
    └── ui/             # Shared React components and context providers
```

### apps/admin
The full application for local use. Handles GeoJSON uploads, address selections, batch serviceability checking, and data management. Not intended for public deployment.

### apps/public
A read-only public-facing site showing the dashboard and interactive map. Reads from the same Supabase database. Designed for deployment to Vercel.

### packages/db
Single source of truth for the Prisma schema and client. Both apps import the Prisma client from here. Also contains `prisma.config.ts` for CLI migrations.

### packages/lib
Pure TypeScript utilities shared across both apps: provider plugin system (registry, types, and UI metadata), fiber service API decoder, batch processing logic, GeoJSON parser, and general utilities.

### packages/ui
Shared React components: `PollingProvider`, `SelectionProvider` context, and the Leaflet `ServiceMap` component.

## Features

### 🗺️ Interactive Map View with Timeline
- Color-coded markers for service status (Available, Preorder, No Service)
- Real-time updates during batch checking
- **Timeline mode** to visualize service expansion over time
  - Based on API dates (when service was established)
  - Animated playback of service rollout progression
  - Scrub through historical snapshots
  - See exactly when addresses became serviceable
- Filter by service type
- Export to GeoJSON — includes provider attribution, all standard check fields, and per-provider status columns (e.g. `omni_fiber_serviceabilityType`, `kinetic_serviceabilityType`) for multi-provider campaigns

### ✅ Batch Serviceability Checking *(admin only)*
- Check thousands of addresses automatically
- Five check modes:
  - **Unchecked**: Only new addresses
  - **Preorder**: Re-check addresses marked as preorder
  - **No Service**: Re-check addresses with no service
  - **Errors**: Re-check addresses that had API errors
  - **All**: Re-validate all addresses
- Pause/resume capability
- Live progress tracking
- Smart error handling (errors don't pollute data)
- Rate-limited API calls

### 📍 Geocoding Enrichment *(admin only)*
Some address datasets (e.g. OpenAddresses rural exports) omit `city` and `postcode` fields. The enrichment pipeline fills these gaps automatically using reverse geocoding:
- Resolves missing `city` and `postcode` from coordinates via the **Nominatim (OpenStreetMap)** API — free, no API key required
- **Coordinate cache** snapped to ~11 m grid so thousands of addresses in the same ZIP area require only one API call
- Rate-limited to 1 req/sec per OpenStreetMap policy; cache hits are near-instant
- **Run at upload time** via an optional toggle on the Upload page
- **Run on demand** for any existing source via the amber MapPin button — sources with gaps are clearly flagged
- Also rebuilds the formatted address string so subsequent serviceability API calls include the resolved city and postcode

### 🎯 Address Selection & Management *(admin only)*
- Upload GeoJSON files with address data
- Create filtered selections by city, region, or postcode
- Track multiple campaigns simultaneously
- Export results as GeoJSON

### 📈 Three-Tier Classification
- **Available Now** (Green): Service can be ordered immediately
- **Preorder/Planned** (Yellow): Future service availability
- **No Service** (Red): Outside service area or not planned

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL (Supabase) with Prisma ORM
- **UI**: React, Tailwind CSS, shadcn/ui
- **Maps**: Leaflet.js
- **API Integration**: Fiber service getCatalog API with custom decoder
- **Monorepo**: npm workspaces

## Getting Started

### Prerequisites

- Node.js 18+
- npm 7+ (workspaces support)
- A PostgreSQL database — [Supabase](https://supabase.com/) recommended

### Installation

#### 1️⃣ Clone and Install

```bash
git clone <your-repo-url>
cd fiber-service-mapper
npm install
```

This installs dependencies for all workspaces in one step.

#### 2️⃣ Configure Environment

```bash
# Database credentials for Prisma CLI
cp packages/db/.env.example packages/db/.env

# Admin app environment
cp apps/admin/.env.example apps/admin/.env
```

Edit both `.env` files with your Supabase connection strings:

| Variable | Used in | Purpose |
|---|---|---|
| `DATABASE_URL` | `packages/db`, `apps/admin`, `apps/public` | Runtime connection (use transaction pooler port 6543 for Supabase) |
| `DIRECT_URL` | `packages/db` | Prisma CLI migrations (direct connection port 5432) |
| `NEXT_PUBLIC_BASE_URL` | `apps/admin`, `apps/public` | App base URL |
| `NEXT_PUBLIC_OMNI_REFERRAL_URL` | `apps/admin`, `apps/public` | Omni Fiber referral link shown in map popups |
| `NEXT_PUBLIC_CARTO_API_KEY` | `apps/admin`, `apps/public` | Carto raster basemap API key (free at [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey/)) |

#### 3️⃣ Setup Database

```bash
# Push schema to the database and apply all indexes (also generates the Prisma client)
npm run db:push --workspace=packages/db
```

#### 4️⃣ Start Development

```bash
# Admin app (full features) — http://localhost:3000
npm run dev:admin

# Public app (read-only) — http://localhost:3001
npm run dev:public
```

### Workspace Scripts

| Command | Description |
|---|---|
| `npm run dev:admin` | Start admin app dev server |
| `npm run dev:public` | Start public app dev server |
| `npm run build:admin` | Production build of admin app |
| `npm run build:public` | Production build of public app |
| `npm run generate --workspace=packages/db` | Regenerate Prisma client after schema changes |
| `npm run db:push --workspace=packages/db` | Push schema changes to the database and apply expression indexes |
| `npm run db:migrate --workspace=packages/db` | Run database migrations |

### Troubleshooting

**Prisma client errors**
```bash
npm run generate --workspace=packages/db
```

**Database out of sync**
```bash
npm run db:push --workspace=packages/db
```

**Port already in use**
```bash
# Edit apps/admin/.env or apps/public/.env and add:
PORT=3001
```

## Usage Workflow

### 1. Upload Address Data *(admin app)*
- Go to **Upload** page
- Select a GeoJSON file with address features
- Properties should include: `number`, `street`, `city`, `region`, `postcode`
- **Recommended Source**: [OpenAddresses.io](https://openaddresses.io/) provides free, open address data in compatible formats
- Toggle **Resolve missing city & postcode** to automatically enrich addresses after upload (useful for rural datasets where these fields are often blank)
- Upload and wait for processing
- Sources with remaining gaps are flagged with an amber MapPin indicator — click it to run enrichment at any time

### 2. Create Selection *(admin app)*
- Go to **Selections** page
- Choose your uploaded source
- Filter by city or other properties
- Create a named selection/campaign

### 3. Run Serviceability Checks *(admin app)*
- Go to **Checker** page
- Select your campaign
- Choose a **Provider** (e.g. Omni Fiber)
- Choose check mode (Unchecked / Preorder / All)
- Start checking and monitor progress in real-time

### 4. View Results *(admin or public app)*
- Go to **Map** page
- Select your campaign
- Toggle filters to show/hide service types
- Enable **Timeline Mode** to see service rollout history
  - Scrub through time using the slider
  - Play animation of service expansion
  - Track exactly when addresses became serviceable
- Export filtered results as GeoJSON

## Deploying the Public App to Vercel

See [`apps/public/SETUP.md`](apps/public/SETUP.md) for full Vercel deployment instructions.

Key points:
- Set **Root Directory** to `apps/public` in Vercel project settings
- Use the Supabase **transaction pooler** URL (port 6543) for `DATABASE_URL`
- The `vercel.json` in `apps/public` handles ignored build steps for monorepo-aware deploys

## Provider Architecture

The application uses a plugin-based provider system so multiple ISP APIs can be supported without changing core logic. Each provider implements a common `ProviderConfig` interface with two methods: `fetch` (calls the ISP API) and `decode` (normalizes the response into a standard `ServiceabilityResult`).

Providers are registered in `packages/lib/src/providers/registry.ts`. The checker UI and batch API route resolve the active provider by its slug (e.g. `omni-fiber`) at runtime.

### Adding a New Provider

1. Create `packages/lib/src/providers/<slug>.ts` implementing `ProviderConfig`
2. Register it in `registry.ts`
3. Add its display metadata to `ui-metadata.ts` — `name` is required; optionally set `color` (CSS color string) and `textColor` for brand-colored badges throughout the UI (dashboard, checker run history, map popups, and the map stats overlay)
4. Run a batch job — the dashboard "Tracking:" indicator will appear automatically once data exists

### Omni Fiber API

The Omni Fiber adapter decodes responses through multiple layers:
1. Brotli decompression
2. ROT13 cipher
3. Custom UUdecode
4. Optional gzip decompression
5. JSON parsing

Serviceability is determined by analyzing multiple fields:
- `cstatus`: `schedulable`, `presales`, `future-service`
- `status`: `SERVICEABLE`, `PLANNED`
- `salesStatus`: `Y`, `P`
- `matchType`: `EXACT`, `NONE`
- `isPreSale`: `0`, `1`

## Database Schema

### Main Tables
- **GeoJSONSource**: Uploaded address files
- **Address**: Individual addresses with coordinates
- **AddressSelection**: Named campaigns/selections
- **ServiceabilityCheck**: Check results (preserves history). Includes a `provider` field (e.g. `omni-fiber`) and a compound index on `(addressId, provider, checkedAt DESC)` for efficient per-provider queries.
- **BatchJob**: Batch checking jobs with progress. Includes a `provider` field so each run is attributed to the ISP that was checked.

Schema lives in `packages/db/prisma/schema.prisma`.

## Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and test thoroughly
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

Please ensure:
- Code follows existing style conventions
- All TypeScript types are properly defined
- Both apps build cleanly (`npm run build:admin && npm run build:public`)
- Features are tested in both light and dark modes

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Maps powered by [Leaflet](https://leafletjs.com/)
- Database with [Prisma](https://www.prisma.io/)
- Address data support for [OpenAddresses](https://openaddresses.io/) - free, open global address data

## Support

For issues, questions, or feature requests:
- Open a [GitHub Issue](../../issues)
- Check existing issues before creating new ones
- Provide detailed information for bug reports

## Author

**Steven Demanett**

---

**Note**: This is an unofficial tool for analyzing fiber internet service availability. Not affiliated with or endorsed by any ISP.
