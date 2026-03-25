'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import {
  Map as MapIcon,
  Loader2,
  Layers,
  Download,
  Activity,
  Clock,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { usePolling } from '../lib/polling-context';
import { useSelection } from '../lib/selection-context';
import { PROVIDER_UI_METADATA } from '@fsm/lib/providers/ui';

// Dynamically imported to avoid SSR issues with Leaflet
const ServiceMap = dynamic(() => import('./service-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-muted">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  ),
});

// Minimal shape the map needs from a selection — compatible with any app's full type.
interface Selection {
  id: string;
  name: string;
}

// Shape returned by getAddressesForMap / getAddressesAtTime — must match each
// app's AddressAtTime interface structurally.
interface AddressAtTime {
  id: string;
  longitude: number;
  latitude: number;
  addressString: string;
  city: string | null;
  postcode: string | null;
  region: string | null;
  provider: string | null;
  serviceabilityType: string | null;
  serviceable: boolean | null;
  salesType: string | null;
  status: string | null;
  cstatus: string | null;
  isPreSale: number | null;
  salesStatus: string | null;
  matchType: string | null;
  checkedAt: Date | null;
  apiCreateDate: Date | null;
  apiUpdateDate: Date | null;
}

interface AddressWithCheck {
  id: string;
  longitude: number;
  latitude: number;
  addressString: string;
  city: string | null;
  postcode: string | null;
  region: string | null;
  checks: {
    provider: string;
    serviceable: boolean;
    serviceabilityType: string;
    salesType: string | null;
    status: string | null;
    cstatus: string | null;
    isPreSale: number | null;
    salesStatus: string | null;
    matchType: string | null;
    checkedAt: Date;
    apiCreateDate: Date | null;
    apiUpdateDate: Date | null;
  }[];
}

interface BatchJob {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  selectionId: string;
}

export interface MapPageProps {
  getSelections: () => Promise<Selection[]>;
  getAddressesForMap: (selectionId: string) => Promise<AddressAtTime[]>;
  getAddressesAtTime: (selectionId: string, date: Date) => Promise<AddressAtTime[]>;
  getCheckTimeline: (selectionId: string) => Promise<Date[]>;
  omniReferralUrl?: string;
}

function groupAddressRows(rows: AddressAtTime[]): AddressWithCheck[] {
  const addressMap = new Map<string, AddressWithCheck>();
  for (const addr of rows) {
    if (!addressMap.has(addr.id)) {
      addressMap.set(addr.id, {
        id: addr.id,
        longitude: addr.longitude,
        latitude: addr.latitude,
        addressString: addr.addressString,
        city: addr.city,
        postcode: addr.postcode ?? null,
        region: addr.region ?? null,
        checks: [],
      });
    }
    if (addr.checkedAt) {
      addressMap.get(addr.id)!.checks.push({
        provider: addr.provider ?? 'omni-fiber',
        serviceable: addr.serviceable ?? false,
        serviceabilityType: addr.serviceabilityType ?? 'none',
        salesType: addr.salesType,
        status: addr.status,
        cstatus: addr.cstatus,
        isPreSale: addr.isPreSale ?? null,
        salesStatus: addr.salesStatus ?? null,
        matchType: addr.matchType ?? null,
        checkedAt: addr.checkedAt,
        apiCreateDate: addr.apiCreateDate ?? null,
        apiUpdateDate: addr.apiUpdateDate ?? null,
      });
    }
  }
  return Array.from(addressMap.values());
}

// "Best status wins" across all providers: serviceable > preorder > none > unchecked
function getEffectiveStatus(checks: AddressWithCheck['checks']): string | null {
  if (checks.length === 0) return null;
  if (checks.some((c) => c.serviceabilityType === 'serviceable')) return 'serviceable';
  if (checks.some((c) => c.serviceabilityType === 'preorder')) return 'preorder';
  return 'none';
}

function MapContent({
  getSelections,
  getAddressesForMap,
  getAddressesAtTime,
  getCheckTimeline,
  omniReferralUrl,
}: MapPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const preselectedId = searchParams.get('selection');
  const { pollingEnabled } = usePolling();
  const { selectedCampaignId, setSelectedCampaignId } = useSelection();

  const urlShowServiceable = searchParams.get('serviceable');
  const urlShowPreorder = searchParams.get('preorder');
  const urlShowNoService = searchParams.get('noService');
  const urlShowUnchecked = searchParams.get('unchecked');

  const [selections, setSelections] = useState<Selection[]>([]);
  const [selectedSelectionId, setSelectedSelectionId] = useState<string>(
    preselectedId || selectedCampaignId || ''
  );
  const [addresses, setAddresses] = useState<AddressWithCheck[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false);
  const [activeJob, setActiveJob] = useState<BatchJob | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const pollCountRef = useRef(0);
  const snapshotCacheRef = useRef<Map<string, AddressWithCheck[]>>(new Map());
  const timelineDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timelineDates, setTimelineDates] = useState<Date[]>([]);
  const [selectedTimeIndex, setSelectedTimeIndex] = useState<number>(0);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isLoadingTimelineData, setIsLoadingTimelineData] = useState(false);

  const [showServiceable, setShowServiceable] = useState(urlShowServiceable !== 'false');
  const [showPreorder, setShowPreorder] = useState(urlShowPreorder !== 'false');
  const [showNoService, setShowNoService] = useState(urlShowNoService !== 'false');
  const [showUnchecked, setShowUnchecked] = useState(urlShowUnchecked !== 'false');

  const updateUrl = useCallback((
    selectionId: string,
    serviceable: boolean,
    preorder: boolean,
    noService: boolean,
    unchecked: boolean,
  ) => {
    const params = new URLSearchParams();
    if (selectionId) params.set('selection', selectionId);
    if (!serviceable) params.set('serviceable', 'false');
    if (!preorder) params.set('preorder', 'false');
    if (!noService) params.set('noService', 'false');
    if (!unchecked) params.set('unchecked', 'false');
    const queryString = params.toString();
    router.replace(`/map${queryString ? `?${queryString}` : ''}`, { scroll: false });
  }, [router]);

  const userChangedSelectionRef = useRef(false);

  const handleSelectionChange = useCallback((value: string) => {
    userChangedSelectionRef.current = true;
    setSelectedSelectionId(value);
    setSelectedCampaignId(value);
  }, [setSelectedCampaignId]);

  const handleFilterChange = useCallback((
    filter: 'serviceable' | 'preorder' | 'noService' | 'unchecked',
    value: boolean,
  ) => {
    const newServiceable = filter === 'serviceable' ? value : showServiceable;
    const newPreorder = filter === 'preorder' ? value : showPreorder;
    const newNoService = filter === 'noService' ? value : showNoService;
    const newUnchecked = filter === 'unchecked' ? value : showUnchecked;
    if (filter === 'serviceable') setShowServiceable(value);
    if (filter === 'preorder') setShowPreorder(value);
    if (filter === 'noService') setShowNoService(value);
    if (filter === 'unchecked') setShowUnchecked(value);
    updateUrl(selectedSelectionId, newServiceable, newPreorder, newNoService, newUnchecked);
  }, [selectedSelectionId, showServiceable, showPreorder, showNoService, showUnchecked, updateUrl]);

  const loadSelections = useCallback(async () => {
    try {
      const data = await getSelections();
      setSelections(data);
    } catch (error) {
      console.error('Error loading selections:', error);
      toast.error('Failed to load selections');
    } finally {
      setIsLoading(false);
    }
  }, [getSelections]);

  const loadAddresses = useCallback(async (selectionId: string) => {
    try {
      const data = await getAddressesForMap(selectionId);
      setAddresses(groupAddressRows(data));
    } catch (error) {
      console.error('Error loading addresses:', error);
    }
  }, [getAddressesForMap]);

  const loadTimeline = useCallback(async (selectionId: string) => {
    setIsLoadingTimeline(true);
    try {
      const dates = await getCheckTimeline(selectionId);
      const datesWithCurrent = [...dates, new Date()];
      setTimelineDates(datesWithCurrent);
      if (datesWithCurrent.length > 0) {
        setSelectedTimeIndex(datesWithCurrent.length - 1);
      }
    } catch (error) {
      console.error('Error loading timeline:', error);
    } finally {
      setIsLoadingTimeline(false);
    }
  }, [getCheckTimeline]);

  const loadAddressesAtTime = useCallback(async (selectionId: string, date: Date) => {
    const cacheKey = `${selectionId}:${date.toISOString()}`;
    const cached = snapshotCacheRef.current.get(cacheKey);
    if (cached) {
      setAddresses(cached);
      return;
    }
    setIsLoadingTimelineData(true);
    try {
      const rows = await getAddressesAtTime(selectionId, date);
      const converted = groupAddressRows(rows);
      snapshotCacheRef.current.set(cacheKey, converted);
      setAddresses(converted);
    } catch (error) {
      console.error('Error loading addresses at time:', error);
    } finally {
      setIsLoadingTimelineData(false);
    }
  }, [getAddressesAtTime]);

  const checkForActiveJob = useCallback(async (selectionId: string) => {
    try {
      const response = await fetch('/api/batch-check');
      const data = await response.json();
      if (data.jobs) {
        const active = data.jobs.find(
          (j: BatchJob) =>
            (j.status === 'running' || j.status === 'pending') &&
            j.selectionId === selectionId
        );
        setActiveJob(active || null);
        return active || null;
      }
    } catch (error) {
      console.error('Error checking for active job:', error);
    }
    return null;
  }, []);

  useEffect(() => {
    loadSelections();
  }, [loadSelections]);

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      if (preselectedId) {
        setSelectedSelectionId(preselectedId);
        setSelectedCampaignId(preselectedId);
      } else if (selectedCampaignId && selectedCampaignId !== selectedSelectionId) {
        setSelectedSelectionId(selectedCampaignId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const urlUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!selectedSelectionId) return;
    if (urlUpdateTimeoutRef.current) clearTimeout(urlUpdateTimeoutRef.current);
    urlUpdateTimeoutRef.current = setTimeout(() => {
      updateUrl(selectedSelectionId, showServiceable, showPreorder, showNoService, showUnchecked);
    }, 500);
    return () => {
      if (urlUpdateTimeoutRef.current) clearTimeout(urlUpdateTimeoutRef.current);
    };
  }, [selectedSelectionId, showServiceable, showPreorder, showNoService, showUnchecked, updateUrl]);

  useEffect(() => {
    if (!selectedSelectionId) {
      setAddresses([]);
      setActiveJob(null);
      setTimelineEnabled(false);
      setTimelineDates([]);
      return;
    }
    snapshotCacheRef.current.clear();
    const init = async () => {
      setIsLoadingAddresses(true);
      try {
        await Promise.all([
          loadAddresses(selectedSelectionId),
          checkForActiveJob(selectedSelectionId),
          loadTimeline(selectedSelectionId),
        ]);
      } finally {
        setIsLoadingAddresses(false);
      }
    };
    init();
  }, [selectedSelectionId, loadAddresses, checkForActiveJob, loadTimeline]);

  useEffect(() => {
    if (timelineEnabled && selectedSelectionId && timelineDates.length > 0) {
      const selectedDate = timelineDates[selectedTimeIndex];
      if (!selectedDate) return;
      if (timelineDebounceRef.current) clearTimeout(timelineDebounceRef.current);
      timelineDebounceRef.current = setTimeout(() => {
        loadAddressesAtTime(selectedSelectionId, selectedDate);
      }, 300);
      return () => {
        if (timelineDebounceRef.current) clearTimeout(timelineDebounceRef.current);
      };
    } else if (!timelineEnabled && selectedSelectionId) {
      loadAddresses(selectedSelectionId);
    }
  }, [timelineEnabled, selectedTimeIndex, timelineDates, selectedSelectionId, loadAddressesAtTime, loadAddresses]);

  // Poll job status every 10 s; refresh address pins every 3rd tick (~30 s).
  // Use stable boolean so the effect doesn't restart on every job object re-reference.
  const hasActiveJob = !!activeJob;
  useEffect(() => {
    if (hasActiveJob && selectedSelectionId && pollingEnabled && !timelineEnabled) {
      let cancelled = false;
      pollCountRef.current = 0;
      const poll = async () => {
        try {
          pollCountRef.current += 1;
          const job = await checkForActiveJob(selectedSelectionId);
          if (cancelled) return;
          if (!job) {
            await loadAddresses(selectedSelectionId);
            loadSelections();
            loadTimeline(selectedSelectionId);
            return;
          }
          if (pollCountRef.current % 3 === 0) {
            await loadAddresses(selectedSelectionId);
          }
          pollingRef.current = setTimeout(poll, 10_000);
        } catch (error) {
          if (cancelled) return;
          console.error('Error polling map updates:', error);
          pollingRef.current = setTimeout(poll, 10_000);
        }
      };
      poll();
      return () => {
        cancelled = true;
        if (pollingRef.current) {
          clearTimeout(pollingRef.current);
          pollingRef.current = null;
        }
      };
    } else if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, [hasActiveJob, selectedSelectionId, pollingEnabled, timelineEnabled, loadAddresses, checkForActiveJob, loadSelections, loadTimeline]);

  const filteredAddresses = addresses.filter((addr) => {
    const status = getEffectiveStatus(addr.checks);
    if (status === null) return showUnchecked;
    if (status === 'serviceable') return showServiceable;
    if (status === 'preorder') return showPreorder;
    return showNoService;
  });

  const selectedSelection = selections.find((s) => s.id === selectedSelectionId);

  // Combined stats (best-status-wins) — used for filter bar counts
  const serviceableCount = addresses.filter((a) => getEffectiveStatus(a.checks) === 'serviceable').length;
  const preorderCount = addresses.filter((a) => getEffectiveStatus(a.checks) === 'preorder').length;
  const noServiceCount = addresses.filter((a) => getEffectiveStatus(a.checks) === 'none').length;
  const uncheckedCount = addresses.filter((a) => getEffectiveStatus(a.checks) === null).length;

  // Per-provider stats — only providers with at least one check, ordered by PROVIDER_UI_METADATA
  const providerStats = PROVIDER_UI_METADATA
    .filter((p) => !p.isStub && addresses.some((a) => a.checks.some((c) => c.provider === p.id)))
    .map((p) => {
      let serviceable = 0, preorder = 0, noService = 0, pending = 0;
      for (const addr of addresses) {
        const check = addr.checks.find((c) => c.provider === p.id);
        if (!check) pending++;
        else if (check.serviceabilityType === 'serviceable') serviceable++;
        else if (check.serviceabilityType === 'preorder') preorder++;
        else noService++;
      }
      return { id: p.id, name: p.name, color: p.color, textColor: p.textColor, serviceable, preorder, noService, pending };
    });

  const latestCheckDate = addresses.reduce<Date | null>((latest, addr) => {
    for (const check of addr.checks) {
      if (!check.checkedAt) continue;
      const d = new Date(check.checkedAt);
      if (!latest || d > latest) latest = d;
    }
    return latest;
  }, null);

  const handleExportGeoJSON = () => {
    if (filteredAddresses.length === 0) {
      toast.error('No addresses to export');
      return;
    }
    const features = filteredAddresses.map((addr) => {
      // Pick the most meaningful check using best-of-wins: serviceable > preorder > none
      const effectiveStatus = getEffectiveStatus(addr.checks);
      const effectiveCheck =
        effectiveStatus === 'serviceable'
          ? addr.checks.find((c) => c.serviceabilityType === 'serviceable')
          : effectiveStatus === 'preorder'
          ? addr.checks.find((c) => c.serviceabilityType === 'preorder')
          : (addr.checks[0] ?? null);

      // Per-provider summary properties prefixed with the provider id
      // (hyphens replaced with underscores for GeoJSON key compatibility)
      const providerProps: Record<string, string | null> = {};
      for (const check of addr.checks) {
        const prefix = check.provider.replace(/-/g, '_');
        providerProps[`${prefix}_serviceabilityType`] = check.serviceabilityType;
        providerProps[`${prefix}_checkedAt`] = check.checkedAt
          ? new Date(check.checkedAt).toISOString()
          : null;
      }

      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [addr.longitude, addr.latitude] },
        properties: {
          address: addr.addressString,
          city: addr.city,
          postcode: addr.postcode,
          region: addr.region,
          provider: effectiveCheck?.provider ?? null,
          serviceabilityType: effectiveCheck?.serviceabilityType ?? null,
          serviceable: effectiveCheck?.serviceable ?? null,
          salesType: effectiveCheck?.salesType ?? null,
          status: effectiveCheck?.status ?? null,
          cstatus: effectiveCheck?.cstatus ?? null,
          isPreSale: effectiveCheck?.isPreSale ?? null,
          salesStatus: effectiveCheck?.salesStatus ?? null,
          matchType: effectiveCheck?.matchType ?? null,
          checkedAt: effectiveCheck?.checkedAt ?? null,
          apiCreateDate: effectiveCheck?.apiCreateDate ?? null,
          apiUpdateDate: effectiveCheck?.apiUpdateDate ?? null,
          ...providerProps,
        },
      };
    });
    const geojson = { type: 'FeatureCollection', features };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSelection?.name || 'export'}-serviceability.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('GeoJSON exported');
  };

  // Suppress unused warning — isLoadingTimeline guards the timeline UI indirectly
  void isLoadingTimeline;

  return (
    <div className="flex h-page-content flex-col overflow-hidden">
      {/* Controls Bar */}
      <div className="border-b border-border/50 bg-card/80 backdrop-blur-lg">
        <div className="container mx-auto">
          <div className="flex h-16 items-center gap-4 px-4">
            <div className="flex items-center gap-2">
              <MapIcon className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold">Map View</h1>
            </div>

            <div className="flex-1" />

            <Select value={selectedSelectionId} onValueChange={handleSelectionChange}>
              <SelectTrigger className="w-[350px]">
                <SelectValue placeholder="Select a campaign" />
              </SelectTrigger>
              <SelectContent className="z-[2000]">
                {selections.map((selection) => (
                  <SelectItem key={selection.id} value={selection.id}>
                    {selection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {activeJob && pollingEnabled && (
              <Badge variant="outline" className="animate-pulse gap-1.5 border-primary text-primary">
                <Activity className="h-3 w-3" />
                Live updating
              </Badge>
            )}
            {activeJob && !pollingEnabled && (
              <Badge variant="outline" className="gap-1.5 border-muted-foreground/50 text-muted-foreground">
                <Activity className="h-3 w-3" />
                Updates paused
              </Badge>
            )}

            <div className="flex items-center gap-3 border-l pl-4">
              {providerStats.length > 1 && (
                <span className="text-xs text-muted-foreground">Combined:</span>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="serviceable"
                  checked={showServiceable}
                  onCheckedChange={(checked) => handleFilterChange('serviceable', !!checked)}
                />
                <Label htmlFor="serviceable" className="flex items-center gap-1 text-sm">
                  <span className="h-3 w-3 rounded-full bg-serviceable" />
                  Available ({serviceableCount})
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="preorder"
                  checked={showPreorder}
                  onCheckedChange={(checked) => handleFilterChange('preorder', !!checked)}
                />
                <Label htmlFor="preorder" className="flex items-center gap-1 text-sm">
                  <span className="h-3 w-3 rounded-full bg-preorder" />
                  Preorder ({preorderCount})
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="no-service"
                  checked={showNoService}
                  onCheckedChange={(checked) => handleFilterChange('noService', !!checked)}
                />
                <Label htmlFor="no-service" className="flex items-center gap-1 text-sm">
                  <span className="h-3 w-3 rounded-full bg-no-service" />
                  No Fiber Service ({noServiceCount})
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="unchecked"
                  checked={showUnchecked}
                  onCheckedChange={(checked) => handleFilterChange('unchecked', !!checked)}
                />
                <Label htmlFor="unchecked" className="flex items-center gap-1 text-sm">
                  <span className="h-3 w-3 rounded-full bg-unchecked" />
                  Pending ({uncheckedCount})
                </Label>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={handleExportGeoJSON}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Timeline Controls */}
      {timelineDates.length > 1 && (
        <div className="border-b border-border/50 bg-card/50 backdrop-blur-lg">
          <div className="container mx-auto px-4 h-[60px]">
            <div className="flex items-center gap-4 h-full">
              <div className="flex items-center gap-2">
                <Switch
                  id="timeline-mode"
                  checked={timelineEnabled}
                  onCheckedChange={() => setTimelineEnabled(!timelineEnabled)}
                />
                <Label htmlFor="timeline-mode" className="flex items-center gap-2 text-sm cursor-pointer">
                  <Clock className="h-4 w-4" />
                  Timeline Mode
                </Label>
              </div>

              {timelineEnabled && (
                <>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedTimeIndex(Math.max(0, selectedTimeIndex - 1))}
                      disabled={selectedTimeIndex === 0}
                    >
                      <SkipBack className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedTimeIndex(Math.min(timelineDates.length - 1, selectedTimeIndex + 1))}
                      disabled={selectedTimeIndex === timelineDates.length - 1}
                    >
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 flex items-center gap-4">
                    <Slider
                      value={[selectedTimeIndex]}
                      onValueChange={(value) => setSelectedTimeIndex(value[0])}
                      max={timelineDates.length - 1}
                      step={1}
                      className="flex-1"
                    />
                    <Badge variant="outline" className="min-w-[180px] justify-center">
                      {selectedTimeIndex === timelineDates.length - 1
                        ? 'Latest (Current)'
                        : format(timelineDates[selectedTimeIndex], 'MMM d, yyyy h:mm a')}
                    </Badge>
                    <div className="text-sm text-muted-foreground">
                      {selectedTimeIndex + 1} of {timelineDates.length}{' '}
                      {selectedTimeIndex === timelineDates.length - 1 ? '(current)' : 'checks'}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Map Area */}
      <div className="relative flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !selectedSelectionId ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Layers className="h-16 w-16 opacity-30" />
            <p className="mt-4 text-lg font-medium">Select a campaign to view addresses</p>
          </div>
        ) : isLoadingAddresses ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ServiceMap
            addresses={filteredAddresses}
            providers={PROVIDER_UI_METADATA.filter((p) => !p.isStub).map((p) => ({
              ...p,
              referralUrl: p.id === 'omni-fiber' ? omniReferralUrl : undefined,
            }))}
            clusteringOptions={{
              maxClusterRadius: 80,
              disableClusteringAtZoom: 17,
              showCoverageOnHover: true,
              spiderfyOnMaxZoom: true,
            }}
          />
        )}

        {/* Timeline Loading Overlay */}
        {isLoadingTimelineData && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center bg-background/50 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">Loading timeline data...</p>
            </div>
          </div>
        )}

        {/* Stats Overlay */}
        {selectedSelection && !isLoadingAddresses && (
          <Card className="absolute bottom-4 left-4 z-[1000] w-72 bg-card/95 backdrop-blur">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-sm font-medium">
                  {selectedSelection.name}
                </CardTitle>
                {timelineEnabled ? (
                  <Badge variant="secondary" className="w-fit text-xs">
                    <Clock className="mr-1 h-3 w-3" />
                    Historical
                  </Badge>
                ) : latestCheckDate ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Last checked {format(latestCheckDate, 'MMM d, yyyy')}
                  </span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0 text-xs">
              {providerStats.map((ps) => (
                <div key={ps.id}>
                  <div className="mb-1.5">
                    <Badge
                      variant="secondary"
                      className="text-xs"
                      style={ps.color ? { backgroundColor: ps.color, color: ps.textColor ?? '#fff', borderColor: ps.color } : undefined}
                    >
                      {ps.name}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-serviceable">{ps.serviceable}</span>
                      <span className="text-muted-foreground">Available</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-preorder">{ps.preorder}</span>
                      <span className="text-muted-foreground">Preorder</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-no-service">{ps.noService}</span>
                      <span className="text-muted-foreground">No Service</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-unchecked">{ps.pending}</span>
                      <span className="text-muted-foreground">Pending</span>
                    </div>
                  </div>
                </div>
              ))}

              {providerStats.length === 0 && (
                <div className="text-muted-foreground">No checks run yet</div>
              )}

              {providerStats.length > 1 && (
                <div className="border-t pt-2">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Combined (best of all)
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-serviceable">{serviceableCount}</span>
                      <span className="text-muted-foreground">Available</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-preorder">{preorderCount}</span>
                      <span className="text-muted-foreground">Preorder</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-no-service">{noServiceCount}</span>
                      <span className="text-muted-foreground">No Service</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-unchecked">{uncheckedCount}</span>
                      <span className="text-muted-foreground">Pending</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t pt-2">
                <div className="flex items-baseline gap-1">
                  <span className="font-semibold">{filteredAddresses.length}</span>
                  <span className="text-muted-foreground">showing on map</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export function MapPage(props: MapPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-page-content items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <MapContent {...props} />
    </Suspense>
  );
}
