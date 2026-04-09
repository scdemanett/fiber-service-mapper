'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Play,
  Pause,
  RotateCcw,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Activity,
  List,
  XCircle,
  StopCircle,
  History,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getSelections } from '@/app/actions/selections';
import { getRunsForSelection, deleteRun, type RunSummary } from '@/app/actions/runs';
import { ACTIVE_PROVIDER_UI_METADATA, getProviderUIMeta, getProviderBadgeStyle } from '@fsm/lib/providers/ui';
import { format } from 'date-fns';
import { Suspense } from 'react';
import { usePolling } from '@/lib/polling-context';
import { useSelection } from '@/lib/selection-context';

interface Selection {
  id: string;
  name: string;
  _count: { addresses: number };
  checkedCount: number;
  serviceableCount: number;
  preorderCount: number;
  noServiceCount: number;
  errorCount: number;
  uncheckedCount: number;
}

interface BatchJob {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  provider: string;
  totalAddresses: number;
  checkedCount: number;
  serviceableCount: number;
  preorderCount: number;
  noServiceCount: number;
  currentIndex: number;
  startedAt?: string;
  completedAt?: string;
  lastCheckAt?: string;
  selectionId?: string;
}

interface LogEntry {
  id: string;
  time: Date;
  address: string;
  serviceable: boolean;
  serviceabilityType?: string;
  status?: string;
  error?: string;
}

function CheckerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const preselectedId = searchParams.get('selection');
  const { pollingEnabled } = usePolling();
  const { selectedCampaignId, setSelectedCampaignId } = useSelection();

  const [selections, setSelections] = useState<Selection[]>([]);
  // Prioritize URL param, then context, then empty string
  const [selectedSelectionId, setSelectedSelectionId] = useState<string>(
    preselectedId || selectedCampaignId || ''
  );
  const [currentJob, setCurrentJob] = useState<BatchJob | null>(null);
  const [allJobs, setAllJobs] = useState<BatchJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // True while stats are being re-fetched after a provider change — blocks Start
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [recheckType, setRecheckType] = useState<'unchecked' | 'preorder' | 'noservice' | 'errors' | 'all'>('unchecked');
  const [selectedProvider, setSelectedProvider] = useState<string>(ACTIVE_PROVIDER_UI_METADATA[0]?.id ?? 'omni-fiber');
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  // Ref so the polling closure always reads the latest provider without restarting
  const selectedProviderRef = useRef(selectedProvider);

  // Manage runs dialog state
  const [runsDialogOpen, setRunsDialogOpen] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // If a job is active, keep the provider synced to the job's provider
  useEffect(() => {
    if (currentJob?.provider && currentJob.provider !== selectedProvider) {
      setSelectedProvider(currentJob.provider);
    }
  }, [currentJob?.provider, selectedProvider]);

  // Keep the ref in sync so the polling closure always has the latest provider
  useEffect(() => {
    selectedProviderRef.current = selectedProvider;
  }, [selectedProvider]);

  // Takes an explicit provider so callers are never stale
  const loadSelections = useCallback(async (provider: string) => {
    try {
      const data = await getSelections(provider);
      setSelections(data as Selection[]);
    } catch (error) {
      console.error('Error loading selections:', error);
      toast.error('Failed to load selections');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/batch-check');
      const data = await response.json();
      if (data.jobs) {
        setAllJobs(data.jobs);
        // currentJob will be set by the useEffect that watches selectedSelectionId and allJobs
      }
    } catch (error) {
      console.error('Error loading jobs:', error);
    }
  }, []); // No dependencies - only load jobs on mount and when explicitly called

  // Load jobs once on mount
  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Reload selections (with provider-scoped stats) on mount and whenever provider changes.
  // isLoadingStats blocks the Start button while the fresh counts are in flight.
  useEffect(() => {
    setIsLoadingStats(true);
    loadSelections(selectedProvider).finally(() => setIsLoadingStats(false));
  }, [loadSelections, selectedProvider]);

  useEffect(() => {
    if (preselectedId) {
      setSelectedSelectionId(preselectedId);
      setSelectedCampaignId(preselectedId); // Sync with context
    } else if (selectedCampaignId && !selectedSelectionId) {
      // If no URL param but we have a context value, use it
      setSelectedSelectionId(selectedCampaignId);
    }
  }, [preselectedId, selectedCampaignId, setSelectedCampaignId, selectedSelectionId]);

  // Update currentJob when selectedSelectionId or allJobs changes
  useEffect(() => {
    if (selectedSelectionId && allJobs.length > 0) {
      const activeJob = allJobs.find(
        (j) => (j.status === 'running' || j.status === 'pending' || j.status === 'paused') && j.selectionId === selectedSelectionId
      );
      setCurrentJob(activeJob || null);
      // Clear switching state if URL matches and selections are loaded
      // When switching campaigns, we don't need to wait for API since data is already in allJobs
      if ((preselectedId === selectedSelectionId || !preselectedId) && !isLoading && selections.length > 0) {
        setTimeout(() => setIsSwitching(false), 100);
      }
    }
  }, [selectedSelectionId, allJobs, preselectedId, isLoading, selections.length]);

  // Poll for job status when running or pending and polling is enabled
  useEffect(() => {
    if ((currentJob?.status === 'running' || currentJob?.status === 'pending') && pollingEnabled) {
      let cancelled = false;
      const abortController = new AbortController();

      const poll = async () => {
        try {
          const response = await fetch('/api/batch-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'status', jobId: currentJob.id }),
            signal: abortController.signal,
          });
          const data = await response.json();
          if (cancelled) return;
          if (data.job) {
            setCurrentJob(data.job);
            // Update activity logs
            if (data.logs) {
              setLogs(
                data.logs.map(
                  (log: {
                    id: string;
                    address: string;
                    serviceable: boolean;
                    serviceabilityType?: string;
                    status?: string;
                    error?: string | null;
                    time: string;
                  }) => ({
                    ...log,
                    error: log.error ?? undefined,
                    time: new Date(log.time),
                  })
                )
              );
            }
            // Refresh selections during polling to update overall stats
            await loadSelections(selectedProviderRef.current);
            if (cancelled) return;
            
            // Stop polling when job is completed, cancelled, or failed
            if (data.job.status !== 'running' && data.job.status !== 'pending') {
              if (pollingRef.current) {
                clearTimeout(pollingRef.current);
                pollingRef.current = null;
              }
              // Immediately sync the terminal status into allJobs so activeJobForSelection
              // is no longer truthy before the full refresh completes — otherwise canStartNew
              // stays false and the Start button never re-renders.
              setAllJobs(prev => prev.map(j => j.id === data.job.id ? data.job : j));
              // Show refreshing state while updating data
              setIsRefreshing(true);
              // Refresh both in parallel and wait for both to complete
              await Promise.all([loadSelections(selectedProviderRef.current), loadJobs()]);
              setIsRefreshing(false);
            } else {
              // Schedule next poll only if job is still running/pending
              if (!cancelled) {
                pollingRef.current = setTimeout(poll, 2000);
              }
            }
          }
        } catch (error) {
          if (cancelled) return;
          console.error('Error polling job status:', error);
          // Continue polling even on error
          if (!cancelled) {
            pollingRef.current = setTimeout(poll, 2000);
          }
        }
      };

      // Start polling
      poll();

      return () => {
        cancelled = true;
        abortController.abort();
        if (pollingRef.current) {
          clearTimeout(pollingRef.current);
          pollingRef.current = null;
        }
      };
    } else if (pollingRef.current) {
      // Clear polling if it's disabled
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, [currentJob?.id, currentJob?.status, pollingEnabled, loadSelections, loadJobs]);

  const handleStart = async () => {
    if (!selectedSelectionId) {
      toast.error('Please select a selection first');
      return;
    }

    const selection = selections.find((s) => s.id === selectedSelectionId);
    if (!selection) return;

    // Check if there's already a running or pending job
    const activeJob = allJobs.find(
      (j) => (j.status === 'running' || j.status === 'pending') && j.selectionId === selectedSelectionId
    );
    if (activeJob) {
      toast.error('A job is already in progress for this selection');
      setCurrentJob(activeJob);
      return;
    }

    setIsStarting(true);
    setLogs([]);

    try {
      const response = await fetch('/api/batch-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          selectionId: selectedSelectionId,
          name: `${selection.name} - ${new Date().toLocaleString()}`,
          recheckType,
          provider: selectedProvider,
        }),
      });

      const data = await response.json();
      if (data.success && data.job) {
        setCurrentJob(data.job);
        toast.success('Batch checking started');
      } else {
        toast.error(data.error || 'Failed to start batch check');
      }
    } catch (error) {
      console.error('Error starting batch check:', error);
      toast.error('Failed to start batch check');
    } finally {
      setIsStarting(false);
    }
  };

  const handlePause = async () => {
    if (!currentJob) return;

    try {
      const response = await fetch('/api/batch-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause', jobId: currentJob.id }),
      });

      const data = await response.json();
      if (data.success) {
        setCurrentJob(data.job);
        toast.success('Batch checking paused');
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
      } else {
        toast.error(data.error || 'Failed to pause');
      }
    } catch (error) {
      console.error('Error pausing batch check:', error);
      toast.error('Failed to pause');
    }
  };

  const handleCancel = async () => {
    if (!currentJob) return;

    try {
      const response = await fetch('/api/batch-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', jobId: currentJob.id }),
      });

      const data = await response.json();
      if (data.success) {
        setCurrentJob(data.job);
        toast.success('Batch checking cancelled');
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
        loadSelections(selectedProviderRef.current);
        loadJobs();
      } else {
        toast.error(data.error || 'Failed to cancel');
      }
    } catch (error) {
      console.error('Error cancelling batch check:', error);
      toast.error('Failed to cancel');
    }
  };

  const handleResume = async () => {
    if (!currentJob) return;

    try {
      const response = await fetch('/api/batch-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume', jobId: currentJob.id }),
      });

      const data = await response.json();
      if (data.success) {
        setCurrentJob(data.job);
        toast.success('Batch checking resumed');
      } else {
        toast.error(data.error || 'Failed to resume');
      }
    } catch (error) {
      console.error('Error resuming batch check:', error);
      toast.error('Failed to resume');
    }
  };

  const handleOpenRunsDialog = async () => {
    if (!selectedSelectionId) return;
    setRunsDialogOpen(true);
    setIsLoadingRuns(true);
    try {
      const data = await getRunsForSelection(selectedSelectionId);
      setRuns(data);
    } catch (error) {
      console.error('Error loading runs:', error);
      toast.error('Failed to load runs');
    } finally {
      setIsLoadingRuns(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    setDeletingRunId(runId);
    try {
      await deleteRun(runId);
      setRuns((prev) => prev.filter((r) => r.id !== runId));
      toast.success('Run deleted');
      await loadSelections(selectedProviderRef.current);
    } catch (error) {
      console.error('Error deleting run:', error);
      toast.error('Failed to delete run');
    } finally {
      setDeletingRunId(null);
      setConfirmDeleteId(null);
    }
  };

  const selectedSelection = selections.find((s) => s.id === selectedSelectionId);
  const progress = currentJob
    ? (currentJob.checkedCount / currentJob.totalAddresses) * 100
    : 0;

  // Check if there's an active (running, pending, or paused) job for the selected selection
  const activeJobForSelection = allJobs.find(
    (j) => (j.status === 'running' || j.status === 'pending' || j.status === 'paused') && j.selectionId === selectedSelectionId
  );
  const isJobActive = currentJob && (currentJob.status === 'running' || currentJob.status === 'paused' || currentJob.status === 'pending');
  const canStartNew = !isJobActive && !activeJobForSelection;
  
  // Check if there's ANY active job running (for any campaign)
  const anyActiveJob = allJobs.find(
    (j) => (j.status === 'running' || j.status === 'pending' || j.status === 'paused')
  );
  // Also check currentJob in case it was just started and not yet in allJobs
  const hasActiveJob = !!anyActiveJob || !!(currentJob && (currentJob.status === 'running' || currentJob.status === 'pending' || currentJob.status === 'paused'));
  // Check if we arrived via deep link and another campaign is running
  const isDeepLinked = !!preselectedId;
  const isDifferentCampaignRunning = anyActiveJob && anyActiveJob.selectionId !== selectedSelectionId;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight">Serviceability Checker</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Run batch serviceability checks against the fiber service API
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Controls */}
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Batch Controls
              </CardTitle>
              <CardDescription>Select a campaign and start checking</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading || isSwitching || isRefreshing ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    {isRefreshing ? 'Updating campaign stats...' : isSwitching ? 'Switching campaigns...' : 'Loading campaigns...'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Selection</label>
                    <Select
                      value={selectedSelectionId}
                      onValueChange={(value) => {
                        setSelectedSelectionId(value);
                        setSelectedCampaignId(value); // Save to context
                        // Update URL to keep it in sync with selection
                        router.push(`/checker?selection=${value}`);
                        // Check if there's an active job for this selection
                        const activeJob = allJobs.find(
                          (j) => (j.status === 'running' || j.status === 'paused' || j.status === 'pending') && j.selectionId === value
                        );
                        if (activeJob) {
                          setCurrentJob(activeJob);
                        } else {
                          setCurrentJob(null);
                        }
                      }}
                      disabled={hasActiveJob}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a campaign" />
                      </SelectTrigger>
                      <SelectContent>
                        {selections.map((selection) => (
                          <SelectItem key={selection.id} value={selection.id}>
                            {selection.name} ({selection.uncheckedCount.toLocaleString()} pending)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Provider</label>
                    <Select value={selectedProvider} onValueChange={setSelectedProvider} disabled={!!isJobActive}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVE_PROVIDER_UI_METADATA.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

              {selectedSelection && (
                <div className="space-y-4">
                  <div className="relative rounded-lg bg-muted p-4 space-y-2">
                    {isLoadingStats && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-muted/80 backdrop-blur-[1px] z-10">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex justify-between text-xs text-muted-foreground pb-1 border-b border-border/50">
                      <span>Stats for</span>
                      <span className="font-medium">
                        {ACTIVE_PROVIDER_UI_METADATA.find((p) => p.id === selectedProvider)?.name ?? selectedProvider}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total addresses</span>
                      <span className="font-medium">
                        {selectedSelection._count.addresses.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Unchecked</span>
                      <span className="font-medium text-unchecked">
                        {selectedSelection.uncheckedCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Available Now</span>
                      <span className="font-medium text-serviceable">
                        {selectedSelection.serviceableCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Preorder</span>
                      <span className="font-medium text-preorder">
                        {selectedSelection.preorderCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">No Fiber Service</span>
                      <span className="font-medium text-no-service">
                        {selectedSelection.noServiceCount.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Check Mode</label>
                    <Select value={recheckType} onValueChange={(value: 'unchecked' | 'preorder' | 'noservice' | 'errors' | 'all') => setRecheckType(value)} disabled={!!isJobActive || isLoadingStats}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unchecked">
                          Only Unchecked ({selectedSelection.uncheckedCount})
                        </SelectItem>
                        <SelectItem value="preorder">
                          Re-check Preorder ({selectedSelection.preorderCount})
                        </SelectItem>
                        <SelectItem value="noservice">
                          Re-check No Fiber Service ({selectedSelection.noServiceCount})
                        </SelectItem>
                        <SelectItem value="errors">
                          Re-check Errors ({selectedSelection.errorCount})
                        </SelectItem>
                        <SelectItem value="all">
                          Re-check All ({selectedSelection._count.addresses})
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {recheckType === 'preorder' && (
                      <p className="text-xs text-muted-foreground">
                        Re-checks addresses that were marked as preorder to see if they're now available
                      </p>
                    )}
                    {recheckType === 'noservice' && (
                      <p className="text-xs text-muted-foreground">
                        Re-checks addresses that had no service to see if they're now serviceable
                      </p>
                    )}
                    {recheckType === 'errors' && (
                      <p className="text-xs text-muted-foreground">
                        Re-checks addresses that had API/network errors during previous checks
                      </p>
                    )}
                    {recheckType === 'all' && (
                      <p className="text-xs text-muted-foreground">
                        Warning: This will re-check all addresses, including those already checked
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {canStartNew ? (
                  // Show message if deep-linked to a campaign while another is running
                  isDeepLinked && isDifferentCampaignRunning ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 space-y-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                              Another campaign is currently running
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-400">
                              {anyActiveJob && (() => {
                                const runningSelection = selections.find((s) => s.id === anyActiveJob.selectionId);
                                return runningSelection 
                                  ? `"${runningSelection.name}" is being checked. Click below to switch to that campaign to pause or cancel it.`
                                  : 'Please wait for the current job to complete before starting a new one.';
                              })()}
                            </p>
                          </div>
                          {anyActiveJob && (() => {
                            const runningSelection = selections.find((s) => s.id === anyActiveJob.selectionId);
                            return runningSelection ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setIsSwitching(true);
                                  const newSelectionId = anyActiveJob.selectionId!;
                                  // Defer navigation to allow React to render loading state first
                                  setTimeout(() => {
                                    setSelectedSelectionId(newSelectionId);
                                    setSelectedCampaignId(newSelectionId);
                                    setCurrentJob(anyActiveJob);
                                    router.push(`/checker?selection=${newSelectionId}`);
                                  }, 0);
                                }}
                                className="w-full bg-white dark:bg-gray-950 hover:bg-amber-100 dark:hover:bg-amber-950 border-amber-300 dark:border-amber-800"
                              >
                                Switch to "{runningSelection.name}"
                              </Button>
                            ) : null;
                          })()}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={handleStart}
                      disabled={!selectedSelectionId || isStarting || isLoading || isLoadingStats ||
                        (recheckType === 'unchecked' && selectedSelection?.uncheckedCount === 0) ||
                        (recheckType === 'preorder' && selectedSelection?.preorderCount === 0) ||
                        (recheckType === 'noservice' && selectedSelection?.noServiceCount === 0) ||
                        (recheckType === 'errors' && selectedSelection?.errorCount === 0) ||
                        (recheckType === 'all' && selectedSelection?._count.addresses === 0)}
                      className="w-full"
                    >
                      {isStarting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          Start Checking
                        </>
                      )}
                    </Button>
                  )
                ) : currentJob?.status === 'running' || currentJob?.status === 'pending' ? (
                  <div className="flex gap-2">
                    <Button onClick={handlePause} variant="outline" className="flex-1">
                      <Pause className="mr-2 h-4 w-4" />
                      Pause
                    </Button>
                    <Button onClick={handleCancel} variant="destructive" className="flex-1">
                      <StopCircle className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                ) : currentJob?.status === 'paused' ? (
                  <div className="flex gap-2">
                    <Button onClick={handleResume} className="flex-1">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Resume
                    </Button>
                    <Button onClick={handleCancel} variant="destructive" className="flex-1">
                      <StopCircle className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Manage Runs */}
          {selectedSelectionId && (
            <Dialog open={runsDialogOpen} onOpenChange={(open) => {
              setRunsDialogOpen(open);
              if (!open) setConfirmDeleteId(null);
            }}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleOpenRunsDialog}
                >
                  <History className="mr-2 h-4 w-4" />
                  Manage Runs
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Historical Runs</DialogTitle>
                </DialogHeader>
                {isLoadingRuns ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : runs.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No runs found for this campaign.</p>
                ) : (
                  <div className="mt-2 space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        className="flex items-start justify-between rounded-lg border border-border/60 bg-card p-3 gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">{run.name}</span>
                            <Badge
                              variant={run.status === 'completed' ? 'default' : run.status === 'failed' || run.status === 'cancelled' ? 'destructive' : 'secondary'}
                              className="text-xs capitalize"
                            >
                              {run.status}
                            </Badge>
                            {run.provider && (
                              <Badge variant="outline" className="text-xs" style={getProviderBadgeStyle(getProviderUIMeta(run.provider))}>
                                {getProviderUIMeta(run.provider)?.name ?? run.provider}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {run.startedAt ? format(new Date(run.startedAt), 'MMM d, yyyy h:mm a') : 'Unknown date'}
                            {run.completedAt && ` – ${format(new Date(run.completedAt), 'h:mm a')}`}
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 text-xs">
                            <span className="text-serviceable font-medium">{run.serviceableCount} available</span>
                            <span className="text-preorder font-medium">{run.preorderCount} preorder</span>
                            <span className="text-no-service font-medium">{run.noServiceCount} no service</span>
                            <span className="text-muted-foreground">{run.checkedCount}/{run.totalAddresses} checked</span>
                          </div>
                        </div>
                        <div className="shrink-0">
                          {confirmDeleteId === run.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Delete this run?</span>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteRun(run.id)}
                                disabled={deletingRunId === run.id}
                              >
                                {deletingRunId === run.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes, delete'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={deletingRunId === run.id}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setConfirmDeleteId(run.id)}
                              disabled={deletingRunId !== null}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}

          {/* Recent Jobs */}
          {allJobs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Recent Jobs</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {allJobs.slice(0, 10).map((job) => {
                      // Extract the timestamp from the original job name
                      const nameParts = job.name.split(' - ');
                      const timestamp = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                      // Find the current selection name
                      const jobSelection = selections.find((s) => s.id === job.selectionId);
                      const currentSelectionName = jobSelection?.name || nameParts[0];
                      // Combine current selection name with original timestamp
                      const displayName = timestamp ? `${currentSelectionName} - ${timestamp}` : currentSelectionName;
                      
                      return (
                        <div
                          key={job.id}
                          className={`flex items-center justify-between rounded-lg border p-2 text-xs ${
                            currentJob?.id === job.id ? 'border-primary bg-primary/5' : ''
                          }`}
                        >
                        <div className="flex items-start gap-2">
                            {job.status === 'running' ? (
                              <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            ) : job.status === 'completed' ? (
                              <CheckCircle className="h-3 w-3 text-serviceable" />
                            ) : job.status === 'paused' ? (
                              <Pause className="h-3 w-3 text-preorder" />
                            ) : job.status === 'cancelled' ? (
                              <XCircle className="h-3 w-3 text-muted-foreground" />
                            ) : job.status === 'pending' ? (
                              <Clock className="h-3 w-3 text-muted-foreground" />
                            ) : job.status === 'failed' ? (
                              <AlertCircle className="h-3 w-3 text-not-serviceable" />
                            ) : (
                              <Clock className="h-3 w-3 text-muted-foreground" />
                            )}
                            <span className="whitespace-normal break-words">{displayName}</span>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {job.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Status & Logs */}
        <div className="space-y-6 lg:col-span-2">
          {currentJob && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {currentJob.status === 'running' ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : currentJob.status === 'completed' ? (
                      <CheckCircle className="h-5 w-5 text-serviceable" />
                    ) : currentJob.status === 'paused' ? (
                      <Pause className="h-5 w-5 text-preorder" />
                    ) : currentJob.status === 'cancelled' ? (
                      <XCircle className="h-5 w-5 text-muted-foreground" />
                    ) : currentJob.status === 'pending' ? (
                      <Clock className="h-5 w-5 text-primary" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    )}
                    <span className="truncate">
                      {(() => {
                        // Extract the timestamp from the original job name (everything after the last " - ")
                        const nameParts = currentJob.name.split(' - ');
                        const timestamp = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                        // Find the current selection name
                        const jobSelection = selections.find((s) => s.id === currentJob.selectionId);
                        const currentSelectionName = jobSelection?.name || nameParts[0];
                        // Combine current selection name with original timestamp
                        return timestamp ? `${currentSelectionName} - ${timestamp}` : currentSelectionName;
                      })()}
                    </span>
                  </CardTitle>
                  <Badge
                    variant={
                      currentJob.status === 'running'
                        ? 'default'
                        : currentJob.status === 'completed'
                        ? 'outline'
                        : currentJob.status === 'cancelled'
                        ? 'secondary'
                        : 'secondary'
                    }
                  >
                    {currentJob.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium">
                      {currentJob.checkedCount.toLocaleString()} /{' '}
                      {currentJob.totalAddresses.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={progress} className="h-3" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-2xl font-bold text-serviceable">
                      {currentJob.serviceableCount.toLocaleString()}
                    </div>
                    <div className="text-xs uppercase text-muted-foreground">Available Now</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-2xl font-bold text-preorder">
                      {currentJob.preorderCount.toLocaleString()}
                    </div>
                    <div className="text-xs uppercase text-muted-foreground">Preorder</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-2xl font-bold text-no-service">
                      {currentJob.noServiceCount.toLocaleString()}
                    </div>
                    <div className="text-xs uppercase text-muted-foreground">No Fiber Service</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-2xl font-bold text-unchecked">
                      {(currentJob.totalAddresses - currentJob.checkedCount).toLocaleString()}
                    </div>
                    <div className="text-xs uppercase text-muted-foreground">Remaining</div>
                  </div>
                </div>

                {currentJob.status === 'paused' && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Pause className="h-4 w-4" />
                    <span>Job paused. Click Resume to continue.</span>
                  </div>
                )}

                {currentJob.status === 'cancelled' && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <XCircle className="h-4 w-4" />
                    <span>Job cancelled. Start a new job to continue checking.</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Activity Log */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5" />
                Activity Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Clock className="h-8 w-8 opacity-50" />
                  <p className="mt-2">No activity yet</p>
                  <p className="text-sm">Start a batch check to see results here</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center gap-3 rounded-lg border p-3 text-sm"
                      >
                        {log.error ? (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        ) : log.serviceabilityType === 'serviceable' ? (
                          <CheckCircle className="h-4 w-4 text-serviceable" />
                        ) : log.serviceabilityType === 'preorder' ? (
                          <Clock className="h-4 w-4 text-preorder" />
                        ) : log.serviceabilityType === 'none' ? (
                          <XCircle className="h-4 w-4 text-no-service" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div className="flex-1 truncate font-mono text-xs">
                          {log.address}
                          {log.error ? (
                            <span className="ml-2 text-destructive">
                              {`— ${log.error}`}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {log.time.toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function CheckerPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    }>
      <CheckerContent />
    </Suspense>
  );
}
