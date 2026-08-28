'use client';

import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatDistanceToNow, format } from 'date-fns';

/**
 * Slim UI-facing provider descriptor.
 * Contains only what the map component needs — no fetch/decode methods
 * so this stays safe to import in client components.
 */
export interface ServiceMapProvider {
  id: string;
  name: string;
  futureServiceUrl?: string;
  referralUrl?: string;
  color?: string;
  textColor?: string;
}

interface AddressWithCheck {
  id: string;
  longitude: number;
  latitude: number;
  addressString: string;
  city: string | null;
  checks: {
    /** Provider id that produced this check, e.g. "omni-fiber". */
    provider: string;
    serviceable: boolean;
    serviceabilityType: string;
    salesType: string | null;
    status: string | null;
    cstatus: string | null;
    checkedAt: Date;
    apiCreateDate: Date | null;
    apiUpdateDate: Date | null;
  }[];
}

interface ServiceMapProps {
  addresses: AddressWithCheck[];
  /**
   * Ordered list of providers to display in popups.
   * Phase 1: single-element array (Omni Fiber).
   * Phase 2: one entry per provider once multi-provider checks are stored.
   */
  providers: ServiceMapProvider[];
  /** Carto raster basemap API key. Appended as `?key=` on the tile URL. */
  cartoApiKey?: string;
  clusteringOptions?: {
    maxClusterRadius?: number;
    disableClusteringAtZoom?: number;
    showCoverageOnHover?: boolean;
    spiderfyOnMaxZoom?: boolean;
  };
}

// Component to fit map bounds to markers (only on initial load)
function FitBounds({ addresses }: { addresses: AddressWithCheck[] }) {
  const map = useMap();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (addresses.length > 0 && !hasInitialized.current) {
      const bounds = addresses.map((a) => [a.latitude, a.longitude] as [number, number]);
      map.fitBounds(bounds, { padding: [50, 50] });
      hasInitialized.current = true;
    }
  }, [addresses, map]);

  return null;
}

/** Best-status-wins: serviceable > preorder > none > unchecked */
function getEffectiveStatus(checks: AddressWithCheck['checks']): string | null {
  if (checks.length === 0) return null;
  if (checks.some((c) => c.serviceabilityType === 'serviceable')) return 'serviceable';
  if (checks.some((c) => c.serviceabilityType === 'preorder')) return 'preorder';
  return 'none';
}

export default function ServiceMap({
  addresses,
  providers,
  cartoApiKey,
  clusteringOptions,
}: ServiceMapProps) {
  const mapRef = useRef(null);

  const clusterConfig = {
    maxClusterRadius: clusteringOptions?.maxClusterRadius ?? 80,
    disableClusteringAtZoom: clusteringOptions?.disableClusteringAtZoom ?? 18,
    showCoverageOnHover: clusteringOptions?.showCoverageOnHover ?? false,
    spiderfyOnMaxZoom: clusteringOptions?.spiderfyOnMaxZoom ?? true,
    spiderfyDistanceMultiplier: 1,
    chunkedLoading: true,
  };

  const { serviceable, preorder, noService, unchecked } = useMemo(() => {
    const serviceable: AddressWithCheck[] = [];
    const preorder: AddressWithCheck[] = [];
    const noService: AddressWithCheck[] = [];
    const unchecked: AddressWithCheck[] = [];

    for (const addr of addresses) {
      const status = getEffectiveStatus(addr.checks);
      if (status === null) unchecked.push(addr);
      else if (status === 'serviceable') serviceable.push(addr);
      else if (status === 'preorder') preorder.push(addr);
      else noService.push(addr);
    }

    return { serviceable, preorder, noService, unchecked };
  }, [addresses]);

  /**
   * Set of provider IDs that have been run for this campaign — derived from
   * which providers appear in any check across all loaded addresses.
   * Providers with zero checks (never started for this campaign) are hidden
   * from popups entirely rather than showing as permanently "Pending".
   */
  const runProviderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const addr of addresses) {
      for (const check of addr.checks) {
        ids.add(check.provider);
      }
    }
    return ids;
  }, [addresses]);

  const defaultCenter: [number, number] = [41.5, -81.5];
  const defaultZoom = 10;

  /**
   * Compact provider-grid popup — one row per provider that has been run for
   * this campaign. Providers with no checks at all (never started) are hidden.
   * Addresses within a started run that haven't been reached yet show "Pending".
   */
  const renderPopup = (addr: AddressWithCheck) => (
    <Popup>
      <div className="popup-content">
        <div className="popup-title">{addr.addressString}</div>
        <div className="popup-provider-grid">
          {providers.filter((p) => runProviderIds.has(p.id)).map((p) => {
            const check = addr.checks.find((c) => c.provider === p.id);
            const isServiceable = check?.serviceabilityType === 'serviceable';
            const isPreorder = check?.serviceabilityType === 'preorder';
            const isNoService = !!check && !isServiceable && !isPreorder;

            return (
              <div key={p.id} className="popup-provider-row">
                {/* Name + colon in JSX — avoids relying on flex gap alone for
                    separation inside the Leaflet popup shadow DOM. */}
                <div className="popup-provider-row-header">
                  <span
                    className="popup-provider-badge"
                    style={p.color ? { backgroundColor: p.color, color: p.textColor ?? '#fff', borderColor: p.color } : undefined}
                  >
                    {p.name}
                  </span>
                  {!check && (
                    <span className="popup-status-chip popup-status-chip-gray">Pending</span>
                  )}
                  {isServiceable && (
                    <span className="popup-status-chip popup-status-chip-green">Available</span>
                  )}
                  {isPreorder && (
                    <span className="popup-status-chip popup-status-chip-yellow">Preorder</span>
                  )}
                  {isNoService && (
                    <span className="popup-status-chip popup-status-chip-red">No Service</span>
                  )}
                </div>

                {check && (
                  <div className="popup-provider-row-detail">
                    {(isServiceable || isPreorder) && p.referralUrl && (
                      <>
                        <a href={p.referralUrl} target="_blank" rel="noopener noreferrer" className="popup-action-link">
                          Order Service ↗
                        </a>
                        <div className="popup-referral-note">Referral link — we both get $50 gift cards!</div>
                      </>
                    )}
                    {isNoService && p.futureServiceUrl && (
                      <a href={p.futureServiceUrl} target="_blank" rel="noopener noreferrer" className="popup-action-link">
                        Request Future Service ↗
                      </a>
                    )}
                    <div className="popup-check-time">
                      {check.apiCreateDate && (
                        <>Created {format(new Date(check.apiCreateDate), 'M/d/yy')} · </>
                      )}
                      {check.apiUpdateDate && (
                        <>Updated {format(new Date(check.apiUpdateDate), 'M/d/yy')} · </>
                      )}
                      Checked {formatDistanceToNow(new Date(check.checkedAt), { addSuffix: true })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Popup>
  );

  return (
    <MapContainer
      ref={mapRef}
      center={defaultCenter}
      zoom={defaultZoom}
      className="h-full w-full"
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url={`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png${cartoApiKey ? `?key=${cartoApiKey}` : ''}`}
        subdomains="abcd"
        maxZoom={20}
      />

      <FitBounds addresses={addresses} />

      {/* Unchecked addresses cluster - gray */}
      <MarkerClusterGroup
        {...clusterConfig}
        iconCreateFunction={(cluster: any) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            html: `<div class="cluster-icon cluster-unchecked"><span>${count}</span></div>`,
            className: 'custom-marker-cluster',
            iconSize: L.point(40, 40, true),
          });
        }}
      >
        {unchecked.map((addr) => (
          <CircleMarker
            key={addr.id}
            center={[addr.latitude, addr.longitude]}
            radius={6}
            pathOptions={{
              color: 'hsl(240 5% 55%)',
              fillColor: 'hsl(240 5% 55%)',
              fillOpacity: 0.6,
              weight: 1,
            }}
          >
            {renderPopup(addr)}
          </CircleMarker>
        ))}
      </MarkerClusterGroup>

      {/* No service addresses cluster - red */}
      <MarkerClusterGroup
        {...clusterConfig}
        iconCreateFunction={(cluster: any) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            html: `<div class="cluster-icon cluster-noservice"><span>${count}</span></div>`,
            className: 'custom-marker-cluster',
            iconSize: L.point(40, 40, true),
          });
        }}
      >
        {noService.map((addr) => (
          <CircleMarker
            key={addr.id}
            center={[addr.latitude, addr.longitude]}
            radius={6}
            pathOptions={{
              color: 'hsl(0 70% 50%)',
              fillColor: 'hsl(0 70% 50%)',
              fillOpacity: 0.7,
              weight: 1,
            }}
          >
            {renderPopup(addr)}
          </CircleMarker>
        ))}
      </MarkerClusterGroup>

      {/* Preorder addresses cluster - yellow */}
      <MarkerClusterGroup
        {...clusterConfig}
        iconCreateFunction={(cluster: any) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            html: `<div class="cluster-icon cluster-preorder"><span>${count}</span></div>`,
            className: 'custom-marker-cluster',
            iconSize: L.point(40, 40, true),
          });
        }}
      >
        {preorder.map((addr) => (
          <CircleMarker
            key={addr.id}
            center={[addr.latitude, addr.longitude]}
            radius={6}
            pathOptions={{
              color: 'hsl(45 90% 55%)',
              fillColor: 'hsl(45 90% 55%)',
              fillOpacity: 0.8,
              weight: 1,
            }}
          >
            {renderPopup(addr)}
          </CircleMarker>
        ))}
      </MarkerClusterGroup>

      {/* Serviceable addresses cluster - green */}
      <MarkerClusterGroup
        {...clusterConfig}
        iconCreateFunction={(cluster: any) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            html: `<div class="cluster-icon cluster-serviceable"><span>${count}</span></div>`,
            className: 'custom-marker-cluster',
            iconSize: L.point(40, 40, true),
          });
        }}
      >
        {serviceable.map((addr) => (
          <CircleMarker
            key={addr.id}
            center={[addr.latitude, addr.longitude]}
            radius={7}
            pathOptions={{
              color: 'hsl(145 60% 45%)',
              fillColor: 'hsl(145 60% 45%)',
              fillOpacity: 0.9,
              weight: 2,
            }}
          >
            {renderPopup(addr)}
          </CircleMarker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
