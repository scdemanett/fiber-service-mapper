import type { ProviderConfig } from './types';
import type { ServiceabilityResult } from '../fiber-decoder';

/**
 * Spectrum (Charter Communications) provider adapter — STUB.
 *
 * Spectrum has no documented public residential serviceability API. Its
 * consumer address check (spectrum.com buyflow "localization") is a
 * JavaScript app that calls internal endpoints behind Akamai Bot Manager,
 * and the request/response contract still needs to be captured from a real
 * browser session before fetch() can be implemented.
 *
 * Classification rules (agreed, mirror the Kinetic adapter):
 *   fiber-to-the-home serviceable today  → serviceable
 *   fiber planned / pre-sale             → preorder   (if the API exposes it)
 *   cable (HFC/DOCSIS) only              → none       (same as Kinetic DSL/copper)
 *   not in footprint / address not found → none
 *
 * Most of Spectrum's residential footprint is hybrid fiber-coax cable; true
 * FTTH is concentrated in RDOF rural builds and new construction. The
 * decoder therefore must distinguish technology, not just "has service".
 * If the residential endpoint does not expose technology, the FCC National
 * Broadband Map (Charter provider data, technology code 50 = fiber,
 * 40 = cable) is the fallback source.
 */

/**
 * Raw shape of the fields expected from the Spectrum serviceability
 * response. Populated once the real contract is captured — the field names
 * below are placeholders and are NOT yet verified against a live response.
 */
export interface SpectrumServiceabilityResponse {
  /** Whether Spectrum can serve the address at all (any technology). */
  serviceable?: boolean;
  /** Access technology at the address, e.g. "FIBER" | "COAX" | "HFC". */
  technology?: string;
  /** Planned / pre-sale flag for fiber builds, if exposed. */
  preSale?: boolean;
  /** Address match quality returned by Spectrum's geocoder. */
  matchType?: string;
}

/**
 * Map a Spectrum serviceability response to the normalized result.
 *
 * Only fiber counts as serviceable. Cable-only addresses return `none` so
 * the map shows them as "No Service", exactly like Kinetic's DSL handling.
 */
function decodeSpectrumResponse(raw: unknown): ServiceabilityResult {
  const defaultResult: ServiceabilityResult = {
    serviceable: false,
    serviceabilityType: 'none',
  };

  try {
    const r = raw as SpectrumServiceabilityResponse;
    if (!r || typeof r !== 'object') return defaultResult;

    const technology = (r.technology ?? '').toUpperCase();
    const isFiber = technology.includes('FIBER') || technology === 'FTTH';

    if (isFiber && r.preSale) {
      return {
        serviceable: false,
        serviceabilityType: 'preorder',
        isPreSale: 1,
        matchType: r.matchType,
        status: technology,
      };
    }

    if (isFiber && r.serviceable) {
      return {
        serviceable: true,
        serviceabilityType: 'serviceable',
        matchType: r.matchType,
        status: technology,
      };
    }

    // Cable-only, out of footprint, or unknown technology → no fiber service.
    return {
      serviceable: false,
      serviceabilityType: 'none',
      matchType: r.matchType,
      status: technology || undefined,
    };
  } catch (err) {
    console.error('[spectrum] decode error:', err);
    return defaultResult;
  }
}

const spectrum: ProviderConfig = {
  id: 'spectrum',
  name: 'Spectrum',
  referralUrl: undefined,
  isStub: true,

  fetch: async (_address: string) => {
    console.warn('[spectrum] Provider not yet implemented — returning null');
    return null;
  },

  decode: (raw: unknown) => decodeSpectrumResponse(raw),
};

export default spectrum;
