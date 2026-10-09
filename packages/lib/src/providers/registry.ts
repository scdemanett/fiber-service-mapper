import omniFiber from './omni-fiber';
import attFiber from './att-fiber';
import kinetic from './kinetic';
import spectrum from './spectrum';
import type { ProviderConfig } from './types';

/**
 * All registered ISP providers.
 *
 * Add new providers here. The order determines display order in the UI.
 * Stub providers (isStub: true) are excluded from user-facing selectors.
 */
export const PROVIDERS: ProviderConfig[] = [omniFiber, attFiber, kinetic, spectrum];

/**
 * Look up a provider by its id slug.
 *
 * Throws if the id is not registered — this keeps unknown providers from
 * silently falling back to wrong behavior.
 */
export function getProvider(id: string): ProviderConfig {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) {
    throw new Error(
      `Unknown provider id "${id}". Registered ids: ${PROVIDERS.map((p) => p.id).join(', ')}`
    );
  }
  return provider;
}

/** Active (non-stub) providers that are fully implemented. */
export function getActiveProviders(): ProviderConfig[] {
  return PROVIDERS.filter((p) => !p.isStub);
}
