/**
 * Client-safe provider metadata — no Node.js imports.
 *
 * This file intentionally has NO imports from server-side modules so it can
 * be used safely in Next.js client components (map pages, etc.).
 *
 * Keep in sync with registry.ts when adding new providers.
 */
export interface ProviderUIMeta {
  id: string;
  name: string;
  /** URL to register interest for future service. Omit if the provider has no such form. */
  futureServiceUrl?: string;
  /** True when the provider is a placeholder stub (not yet implemented). */
  isStub?: boolean;
  /** Brand accent color used for badges. Overrides the default secondary badge style when set. */
  color?: string;
  /** Text color for badges when a brand color is set. Defaults to white when omitted. */
  textColor?: string;
}

export const PROVIDER_UI_METADATA: ProviderUIMeta[] = [
  {
    id: 'omni-fiber',
    name: 'Omni Fiber',
    futureServiceUrl: 'https://www.omnifiber.com/future-service/',
    isStub: false,
    color: '#6b00e4',
  },
  {
    id: 'att-fiber',
    name: 'AT&T Fiber',
    futureServiceUrl: 'https://www.att.com/internet/fiber/',
    isStub: true,
  },
  {
    id: 'kinetic',
    name: 'Kinetic',
    isStub: false,
    color: 'rgb(36 167 106)',
    textColor: 'rgb(0 0 45)',
  },
  {
    id: 'spectrum',
    name: 'Spectrum',
    isStub: true,
    color: '#005eff',
  },
];

/** Only providers that are fully implemented (not stubs). */
export const ACTIVE_PROVIDER_UI_METADATA = PROVIDER_UI_METADATA.filter((p) => !p.isStub);

/** Look up client-safe metadata by provider id. Returns undefined if not found. */
export function getProviderUIMeta(id: string): ProviderUIMeta | undefined {
  return PROVIDER_UI_METADATA.find((p) => p.id === id);
}

/**
 * Returns an inline style object for a provider badge when the provider has a
 * brand color defined, so the badge renders with that color as background.
 * Returns an empty object when no color is set (letting Tailwind variants apply).
 */
export function getProviderBadgeStyle(meta: ProviderUIMeta | undefined): { backgroundColor?: string; color?: string; borderColor?: string } {
  if (!meta?.color) return {};
  return { backgroundColor: meta.color, color: meta.textColor ?? '#fff', borderColor: meta.color };
}
