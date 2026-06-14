'use client';

import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Filter, Plus, Trash2, Loader2, CheckCircle, AlertCircle, Clock, Play, XCircle, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getGeoJSONSources, getUniquePropertyValues, getAddressCountByFilter } from '@/app/actions/geojson';
import { createSelection, getSelections, deleteSelection, updateSelection, addAddressesToSelection } from '@/app/actions/selections';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

interface GeoJSONSource {
  id: string;
  name: string;
  fileName: string;
  uploadedAt: Date;
  addressCount: number;
  _count: { addresses: number };
}

interface Selection {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  filterCriteria: string;
  _count: { addresses: number };
  checkedCount: number;
  serviceableCount: number;
  preorderCount: number;
  noServiceCount: number;
  uncheckedCount: number;
}

function SelectionsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const preselectedSourceId = searchParams.get('source');
  const hasHandledPreselection = useRef(false);

  const [sources, setSources] = useState<GeoJSONSource[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSelection, setEditingSelection] = useState<Selection | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSelection, setDeletingSelection] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create selection form state
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [selectionName, setSelectionName] = useState('');
  const [selectionDescription, setSelectionDescription] = useState('');
  const [availableCities, setAvailableCities] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Edit selection form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSourceId, setEditSourceId] = useState<string>('');
  const [editAvailableCities, setEditAvailableCities] = useState<string[]>([]);
  const [editSelectedCities, setEditSelectedCities] = useState<string[]>([]);
  const [editPreviewCount, setEditPreviewCount] = useState<number | null>(null);
  const [isLoadingEditPreview, setIsLoadingEditPreview] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [sourcesData, selectionsData] = await Promise.all([
        getGeoJSONSources(),
        getSelections(),
      ]);
      setSources(sourcesData as GeoJSONSource[]);
      setSelections(selectionsData as Selection[]);

      // If we have a preselected source and it exists, open the dialog (only once)
      if (preselectedSourceId && !hasHandledPreselection.current && sourcesData.some((s: GeoJSONSource) => s.id === preselectedSourceId)) {
        hasHandledPreselection.current = true;
        setSelectedSourceId(preselectedSourceId);
        setDialogOpen(true);
        // Clear the URL parameter to prevent reopening on refresh
        router.replace('/selections', { scroll: false });
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [preselectedSourceId, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load cities when source is selected
  useEffect(() => {
    if (!selectedSourceId) {
      setAvailableCities([]);
      setSelectedCities([]);
      return;
    }

    const loadCities = async () => {
      try {
        const cities = await getUniquePropertyValues(selectedSourceId, 'city');
        setAvailableCities(cities);
      } catch (error) {
        console.error('Error loading cities:', error);
      }
    };

    loadCities();
  }, [selectedSourceId]);

  // Update preview count when filters change
  useEffect(() => {
    if (!selectedSourceId) {
      setPreviewCount(null);
      return;
    }

    const updatePreview = async () => {
      setIsLoadingPreview(true);
      try {
        const count = await getAddressCountByFilter(selectedSourceId, {
          city: selectedCities.length > 0 ? selectedCities : undefined,
        });
        setPreviewCount(count);
      } catch (error) {
        console.error('Error getting preview count:', error);
        setPreviewCount(null);
      } finally {
        setIsLoadingPreview(false);
      }
    };

    const debounce = setTimeout(updatePreview, 300);
    return () => clearTimeout(debounce);
  }, [selectedSourceId, selectedCities]);

  // Load cities when edit source is selected
  useEffect(() => {
    if (!editSourceId) {
      setEditAvailableCities([]);
      setEditSelectedCities([]);
      return;
    }

    const loadCities = async () => {
      try {
        const cities = await getUniquePropertyValues(editSourceId, 'city');
        setEditAvailableCities(cities);
      } catch (error) {
        console.error('Error loading cities for edit:', error);
      }
    };

    loadCities();
  }, [editSourceId]);

  // Update edit preview count when filters change
  useEffect(() => {
    if (!editSourceId || editSelectedCities.length === 0) {
      setEditPreviewCount(null);
      return;
    }

    const updatePreview = async () => {
      setIsLoadingEditPreview(true);
      try {
        const count = await getAddressCountByFilter(editSourceId, {
          city: editSelectedCities,
        });
        setEditPreviewCount(count);
      } catch (error) {
        console.error('Error getting edit preview count:', error);
        setEditPreviewCount(null);
      } finally {
        setIsLoadingEditPreview(false);
      }
    };

    const debounce = setTimeout(updatePreview, 300);
    return () => clearTimeout(debounce);
  }, [editSourceId, editSelectedCities]);

  const handleCreateSelection = async () => {
    if (!selectedSourceId) {
      toast.error('Please select a source');
      return;
    }
    if (!selectionName.trim()) {
      toast.error('Please enter a selection name');
      return;
    }

    setIsCreating(true);
    try {
      const result = await createSelection(
        selectionName.trim(),
        selectionDescription.trim() || null,
        selectedSourceId,
        {
          city: selectedCities.length > 0 ? selectedCities : undefined,
        }
      );

      if (result.success) {
        toast.success(`Created selection with ${result.addressCount?.toLocaleString()} addresses`);
        setDialogOpen(false);
        resetForm();
        loadData();
      } else {
        toast.error(result.error || 'Failed to create selection');
      }
    } catch (error) {
      console.error('Error creating selection:', error);
      toast.error('Failed to create selection');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteSelection = (selectionId: string, name: string) => {
    setDeletingSelection({ id: selectionId, name });
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingSelection) return;

    setIsDeleting(true);
    try {
      const result = await deleteSelection(deletingSelection.id);
      if (result.success) {
        toast.success('Selection deleted');
        setDeleteDialogOpen(false);
        setDeletingSelection(null);
        loadData();
      } else {
        toast.error(result.error || 'Delete failed');
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Delete failed');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEditSelection = (selection: Selection) => {
    setEditingSelection(selection);
    setEditName(selection.name);
    setEditDescription(selection.description || '');
    setEditSourceId('');
    setEditSelectedCities([]);
    setEditPreviewCount(null);
    setEditDialogOpen(true);
  };

  const handleUpdateSelection = async () => {
    if (!editingSelection) return;

    if (!editName.trim()) {
      toast.error('Please enter a selection name');
      return;
    }

    setIsUpdating(true);
    try {
      // Update name and description
      const updateResult = await updateSelection(
        editingSelection.id,
        editName.trim(),
        editDescription.trim() || null
      );

      if (!updateResult.success) {
        toast.error(updateResult.error || 'Failed to update selection');
        setIsUpdating(false);
        return;
      }

      // Add addresses if source and cities are selected
      if (editSourceId && editSelectedCities.length > 0) {
        const addResult = await addAddressesToSelection(
          editingSelection.id,
          editSourceId,
          { city: editSelectedCities }
        );

        if (addResult.success) {
          toast.success(
            `Updated selection and added ${addResult.addressCount?.toLocaleString()} new addresses`
          );
        } else {
          // Still show success for the name update
          toast.warning(
            `Updated selection name, but: ${addResult.error || 'Failed to add addresses'}`
          );
        }
      } else {
        toast.success('Selection updated');
      }

      setEditDialogOpen(false);
      setEditingSelection(null);
      resetEditForm();
      loadData();
    } catch (error) {
      console.error('Error updating selection:', error);
      toast.error('Failed to update selection');
    } finally {
      setIsUpdating(false);
    }
  };

  const resetForm = () => {
    setSelectedSourceId('');
    setSelectionName('');
    setSelectionDescription('');
    setSelectedCities([]);
    setPreviewCount(null);
  };

  const resetEditForm = () => {
    setEditName('');
    setEditDescription('');
    setEditSourceId('');
    setEditSelectedCities([]);
    setEditPreviewCount(null);
  };

  const toggleCity = (city: string) => {
    setSelectedCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
  };

  const toggleEditCity = (city: string) => {
    setEditSelectedCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Address Selections</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Create and manage address selections for serviceability checking
          </p>
        </div>

        <Button onClick={() => setDialogOpen(true)} disabled={isLoading}>
          <Plus className="mr-2 h-4 w-4" />
          New Selection
        </Button>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Selection</DialogTitle>
              <DialogDescription>
                Filter addresses from a source to create a selection for serviceability checking
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="source">Source</Label>
                <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a source" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.name} ({source._count.addresses.toLocaleString()} addresses)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Selection Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Painesville City December 2025"
                  value={selectionName}
                  onChange={(e) => setSelectionName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Input
                  id="description"
                  placeholder="Notes about this selection"
                  value={selectionDescription}
                  onChange={(e) => setSelectionDescription(e.target.value)}
                />
              </div>

              {availableCities.length > 0 && (
                <div className="space-y-2">
                  <Label>Filter by City</Label>
                  <ScrollArea className="h-48 rounded-md border p-4">
                    <div className="space-y-2">
                      {availableCities.map((city) => (
                        <div key={city} className="flex items-center space-x-2">
                          <Checkbox
                            id={`city-${city}`}
                            checked={selectedCities.includes(city)}
                            onCheckedChange={() => toggleCity(city)}
                          />
                          <label
                            htmlFor={`city-${city}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                          >
                            {city}
                          </label>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  {selectedCities.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {selectedCities.map((city) => (
                        <Badge key={city} variant="secondary" className="text-xs">
                          {city}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {previewCount !== null && (
                <div className="rounded-lg bg-muted p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Addresses matching filters:</span>
                    {isLoadingPreview ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="text-lg font-bold text-primary">
                        {previewCount.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateSelection} disabled={isCreating || !selectedSourceId}>
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Selection'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Selection</DialogTitle>
              <DialogDescription>
                Update the selection name, description, and optionally add more addresses
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Selection Name</Label>
                <Input
                  id="edit-name"
                  placeholder="e.g., Painesville City December 2025"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">Description (optional)</Label>
                <Input
                  id="edit-description"
                  placeholder="Notes about this selection"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="mb-2 text-sm font-semibold">Add More Addresses (optional)</h4>
                <p className="mb-4 text-sm text-muted-foreground">
                  Select a source and cities to add additional addresses to this selection
                </p>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-source">Source</Label>
                    <Select value={editSourceId} onValueChange={setEditSourceId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a source (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {sources.map((source) => (
                          <SelectItem key={source.id} value={source.id}>
                            {source.name} ({source._count.addresses.toLocaleString()} addresses)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {editAvailableCities.length > 0 && (
                    <div className="space-y-2">
                      <Label>Filter by City</Label>
                      <ScrollArea className="h-48 rounded-md border p-4">
                        <div className="space-y-2">
                          {editAvailableCities.map((city) => (
                            <div key={city} className="flex items-center space-x-2">
                              <Checkbox
                                id={`edit-city-${city}`}
                                checked={editSelectedCities.includes(city)}
                                onCheckedChange={() => toggleEditCity(city)}
                              />
                              <label
                                htmlFor={`edit-city-${city}`}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                              >
                                {city}
                              </label>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      {editSelectedCities.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {editSelectedCities.map((city) => (
                            <Badge key={city} variant="secondary" className="text-xs">
                              {city}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {editPreviewCount !== null && (
                    <div className="rounded-lg bg-muted p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">New addresses to add:</span>
                        {isLoadingEditPreview ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <span className="text-lg font-bold text-primary">
                            {editPreviewCount.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        (Duplicates will be automatically excluded)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateSelection} disabled={isUpdating}>
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Selection'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Selection</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete &quot;{deletingSelection?.name}&quot;? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : selections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Filter className="h-12 w-12 text-muted-foreground opacity-50" />
            <p className="mt-4 text-lg font-medium">No selections yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a selection to start checking serviceability
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {selections.map((selection) => {
            const totalChecked = selection.checkedCount;
            const total = selection._count.addresses;
            const progress = total > 0 ? (totalChecked / total) * 100 : 0;

            return (
              <Card key={selection.id} className="relative overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{selection.name}</CardTitle>
                      {selection.description && (
                        <CardDescription>{selection.description}</CardDescription>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditSelection(selection)}
                        className="text-muted-foreground hover:text-primary"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteSelection(selection.id, selection.name)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">
                        {totalChecked.toLocaleString()} / {total.toLocaleString()}
                      </span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-serviceable/10 p-2">
                      <div className="flex items-center justify-center gap-1">
                        <CheckCircle className="h-3 w-3 text-serviceable" />
                        <span className="text-sm font-bold text-serviceable">
                          {selection.serviceableCount.toLocaleString()}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        Available
                      </span>
                    </div>
                    <div className="rounded-lg bg-preorder/10 p-2">
                      <div className="flex items-center justify-center gap-1">
                        <Clock className="h-3 w-3 text-preorder" />
                        <span className="text-sm font-bold text-preorder">
                          {selection.preorderCount.toLocaleString()}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        Preorder
                      </span>
                    </div>
                    <div className="rounded-lg bg-no-service/10 p-2">
                      <div className="flex items-center justify-center gap-1">
                        <XCircle className="h-3 w-3 text-no-service" />
                        <span className="text-sm font-bold text-no-service">
                          {selection.noServiceCount.toLocaleString()}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        No Fiber Service
                      </span>
                    </div>
                    <div className="rounded-lg bg-unchecked/10 p-2">
                      <div className="flex items-center justify-center gap-1">
                        <AlertCircle className="h-3 w-3 text-unchecked" />
                        <span className="text-sm font-bold text-unchecked">
                          {selection.uncheckedCount.toLocaleString()}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        Pending
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1" asChild>
                      <Link href={`/checker?selection=${selection.id}`}>
                        <Play className="mr-2 h-4 w-4" />
                        Check
                      </Link>
                    </Button>
                    <Button variant="outline" className="flex-1" asChild>
                      <Link href={`/map?selection=${selection.id}`}>
                        View Map
                      </Link>
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Created{' '}
                    {formatDistanceToNow(new Date(selection.createdAt), { addSuffix: true })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SelectionsPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    }>
      <SelectionsContent />
    </Suspense>
  );
}

