/**
 * Batch Processor - Resilient batch checking with resume capability
 * 
 * All address-filtering queries use PostgreSQL LATERAL JOINs to push filtering
 * to the database level instead of loading rows into memory.
 */

import { prisma } from '@fsm/db';
import type { ServiceabilityResult } from './fiber-decoder';

export interface BatchProgress {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  /** Fiber provider this job checks against (e.g. omni-fiber) */
  provider: string;
  totalAddresses: number;
  checkedCount: number;
  serviceableCount: number;
  preorderCount: number;
  noServiceCount: number;
  currentIndex: number;
  startedAt?: Date;
  completedAt?: Date;
  lastCheckAt?: Date;
  selectionId?: string;
}

export interface AddressToCheck {
  id: string;
  addressString: string;
}

/**
 * Create a new batch job for a selection
 */
export async function createBatchJob(
  name: string,
  selectionId: string | null,
  addressIds: string[],
  recheckType?: string,
  provider: string = 'omni-fiber'
): Promise<BatchProgress> {
  const job = await prisma.batchJob.create({
    data: {
      name,
      selectionId,
      status: 'pending',
      recheckType: recheckType || 'unchecked',
      provider,
      totalAddresses: addressIds.length,
      checkedCount: 0,
      serviceableCount: 0,
      preorderCount: 0,
      noServiceCount: 0,
      currentIndex: 0,
    },
  });

  return {
    id: job.id,
    name: job.name,
    status: job.status as BatchProgress['status'],
    provider: job.provider,
    totalAddresses: job.totalAddresses,
    checkedCount: job.checkedCount,
    serviceableCount: job.serviceableCount,
    preorderCount: job.preorderCount,
    noServiceCount: job.noServiceCount,
    currentIndex: job.currentIndex,
    startedAt: job.startedAt ?? undefined,
    completedAt: job.completedAt ?? undefined,
    lastCheckAt: job.lastCheckAt ?? undefined,
  };
}

/**
 * Get batch job progress
 */
export async function getBatchJob(jobId: string): Promise<BatchProgress | null> {
  const job = await prisma.batchJob.findUnique({
    where: { id: jobId },
  });

  if (!job) return null;

  return {
    id: job.id,
    name: job.name,
    status: job.status as BatchProgress['status'],
    provider: job.provider,
    totalAddresses: job.totalAddresses,
    checkedCount: job.checkedCount,
    serviceableCount: job.serviceableCount,
    preorderCount: job.preorderCount,
    noServiceCount: job.noServiceCount,
    currentIndex: job.currentIndex,
    startedAt: job.startedAt ?? undefined,
    completedAt: job.completedAt ?? undefined,
    lastCheckAt: job.lastCheckAt ?? undefined,
    selectionId: job.selectionId ?? undefined,
  };
}

/**
 * Update batch job status
 */
export async function updateBatchJobStatus(
  jobId: string,
  status: BatchProgress['status'],
  updates?: Partial<Pick<BatchProgress, 'currentIndex' | 'checkedCount' | 'serviceableCount' | 'preorderCount' | 'noServiceCount'>>
): Promise<void> {
  await prisma.batchJob.update({
    where: { id: jobId },
    data: {
      status,
      ...(status === 'running' && { startedAt: new Date() }),
      ...(status === 'completed' && { completedAt: new Date() }),
      ...updates,
    },
  });
}

/**
 * Record a serviceability check result
 * 
 * All necessary data is extracted and stored in individual fields.
 * We don't store the full API response to avoid UTF-8 corruption issues and save space.
 */
export async function recordServiceabilityCheck(
  addressId: string,
  jobId: string,
  selectionId: string | null,
  result: ServiceabilityResult | null,
  error?: string,
  provider: string = 'omni-fiber'
): Promise<void> {
  const hasError = (error ?? '').trim().length > 0;
  const safeResult: ServiceabilityResult = result ?? {
    serviceable: false,
    serviceabilityType: 'none',
  };

  // Only increment the serviceability buckets for successful (non-error) attempts.
  const incrementServiceable = !hasError && safeResult.serviceabilityType === 'serviceable' ? 1 : 0;
  const incrementPreorder = !hasError && safeResult.serviceabilityType === 'preorder' ? 1 : 0;
  const incrementNoService = !hasError && safeResult.serviceabilityType === 'none' ? 1 : 0;

  // One transaction: write the check + atomically increment batch counters.
  await prisma.$transaction([
    prisma.serviceabilityCheck.create({
      data: {
        addressId,
        selectionId: selectionId ?? undefined,
        batchJobId: jobId,
        provider,
        serviceable: safeResult.serviceable,
        serviceabilityType: safeResult.serviceabilityType,
        salesType: safeResult.salesType,
        status: safeResult.status,
        cstatus: safeResult.cstatus,
        isPreSale: safeResult.isPreSale,
        salesStatus: safeResult.salesStatus,
        matchType: safeResult.matchType,
        apiCreateDate: safeResult.apiCreateDate ? new Date(safeResult.apiCreateDate) : null,
        apiUpdateDate: safeResult.apiUpdateDate ? new Date(safeResult.apiUpdateDate) : null,
        error: hasError ? error!.substring(0, 1000) : null,
      },
    }),
    prisma.batchJob.update({
      where: { id: jobId },
      data: {
        checkedCount: { increment: 1 },
        serviceableCount: { increment: incrementServiceable },
        preorderCount: { increment: incrementPreorder },
        noServiceCount: { increment: incrementNoService },
        currentIndex: { increment: 1 },
        lastCheckAt: new Date(),
      },
    }),
  ]);
}

/**
 * Get addresses for a selection that haven't been checked yet by the given provider.
 * Uses Prisma's relational filter (no in-memory filtering).
 */
export async function getUncheckedAddresses(
  selectionId: string,
  provider: string = 'omni-fiber',
  limit?: number
): Promise<AddressToCheck[]> {
  const addresses = await prisma.address.findMany({
    where: {
      selections: {
        some: { id: selectionId },
      },
      checks: {
        none: { provider },
      },
    },
    select: {
      id: true,
      addressString: true,
    },
    take: limit,
  });

  return addresses;
}

/**
 * Get addresses from a selection that were not serviceable in their latest check.
 * Uses a PostgreSQL LATERAL JOIN to filter at the database level.
 */
export async function getNonServiceableAddresses(
  selectionId: string,
  limit?: number
): Promise<AddressToCheck[]> {
  if (limit != null) {
    return prisma.$queryRaw<AddressToCheck[]>`
      SELECT a.id, a."addressString"
      FROM addresses a
      INNER JOIN "_AddressToAddressSelection" atas ON a.id = atas."A" AND atas."B" = ${selectionId}
      INNER JOIN LATERAL (
        SELECT serviceable
        FROM serviceability_checks sc
        WHERE sc."addressId" = a.id
        ORDER BY sc."checkedAt" DESC
        LIMIT 1
      ) lc ON true
      WHERE lc.serviceable = false
      LIMIT ${limit}
    `;
  }

  return prisma.$queryRaw<AddressToCheck[]>`
    SELECT a.id, a."addressString"
    FROM addresses a
    INNER JOIN "_AddressToAddressSelection" atas ON a.id = atas."A" AND atas."B" = ${selectionId}
    INNER JOIN LATERAL (
      SELECT serviceable
      FROM serviceability_checks sc
      WHERE sc."addressId" = a.id
      ORDER BY sc."checkedAt" DESC
      LIMIT 1
    ) lc ON true
    WHERE lc.serviceable = false
  `;
}

/**
 * Get addresses from a selection by their serviceability type in the latest check
 * for the given provider. Uses a PostgreSQL LATERAL JOIN to filter at the database level.
 */
export async function getAddressesByServiceabilityType(
  selectionId: string,
  serviceabilityType: 'serviceable' | 'preorder' | 'none',
  provider: string = 'omni-fiber',
  limit?: number
): Promise<AddressToCheck[]> {
  if (limit != null) {
    return prisma.$queryRaw<AddressToCheck[]>`
      SELECT a.id, a."addressString"
      FROM addresses a
      INNER JOIN "_AddressToAddressSelection" atas ON a.id = atas."A" AND atas."B" = ${selectionId}
      INNER JOIN LATERAL (
        SELECT "serviceabilityType"
        FROM serviceability_checks sc
        WHERE sc."addressId" = a.id
          AND sc.provider = ${provider}
        ORDER BY sc."checkedAt" DESC
        LIMIT 1
      ) lc ON true
      WHERE lc."serviceabilityType" = ${serviceabilityType}
      LIMIT ${limit}
    `;
  }

  return prisma.$queryRaw<AddressToCheck[]>`
    SELECT a.id, a."addressString"
    FROM addresses a
    INNER JOIN "_AddressToAddressSelection" atas ON a.id = atas."A" AND atas."B" = ${selectionId}
    INNER JOIN LATERAL (
      SELECT "serviceabilityType"
      FROM serviceability_checks sc
      WHERE sc."addressId" = a.id
        AND sc.provider = ${provider}
      ORDER BY sc."checkedAt" DESC
      LIMIT 1
    ) lc ON true
    WHERE lc."serviceabilityType" = ${serviceabilityType}
  `;
}

/**
 * Get addresses from a selection whose latest check for the given provider has an error.
 * Uses a PostgreSQL LATERAL JOIN to filter at the database level.
 */
export async function getAddressesWithErrors(
  selectionId: string,
  provider: string = 'omni-fiber',
  limit?: number
): Promise<AddressToCheck[]> {
  if (limit != null) {
    return prisma.$queryRaw<AddressToCheck[]>`
      SELECT a.id, a."addressString"
      FROM addresses a
      INNER JOIN "_AddressToAddressSelection" atas ON a.id = atas."A" AND atas."B" = ${selectionId}
      INNER JOIN LATERAL (
        SELECT error
        FROM serviceability_checks sc
        WHERE sc."addressId" = a.id
          AND sc.provider = ${provider}
        ORDER BY sc."checkedAt" DESC
        LIMIT 1
      ) lc ON true
      WHERE lc.error IS NOT NULL AND lc.error != ''
      LIMIT ${limit}
    `;
  }

  return prisma.$queryRaw<AddressToCheck[]>`
    SELECT a.id, a."addressString"
    FROM addresses a
    INNER JOIN "_AddressToAddressSelection" atas ON a.id = atas."A" AND atas."B" = ${selectionId}
    INNER JOIN LATERAL (
      SELECT error
      FROM serviceability_checks sc
      WHERE sc."addressId" = a.id
        AND sc.provider = ${provider}
      ORDER BY sc."checkedAt" DESC
      LIMIT 1
    ) lc ON true
    WHERE lc.error IS NOT NULL AND lc.error != ''
  `;
}

/**
 * Get all batch jobs
 */
export async function getAllBatchJobs(): Promise<BatchProgress[]> {
  const jobs = await prisma.batchJob.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status as BatchProgress['status'],
    provider: job.provider,
    totalAddresses: job.totalAddresses,
    checkedCount: job.checkedCount,
    serviceableCount: job.serviceableCount,
    preorderCount: job.preorderCount,
    noServiceCount: job.noServiceCount,
    currentIndex: job.currentIndex,
    startedAt: job.startedAt ?? undefined,
    completedAt: job.completedAt ?? undefined,
    lastCheckAt: job.lastCheckAt ?? undefined,
    selectionId: job.selectionId ?? undefined,
  }));
}

/**
 * Get addresses to check for a batch job (with resume capability)
 */
export async function getAddressesForBatchJob(
  jobId: string,
  selectionId: string | null
): Promise<AddressToCheck[]> {
  const job = await prisma.batchJob.findUnique({ where: { id: jobId } });
  if (!job) return [];

  // If resuming, get addresses from current index
  if (selectionId) {
    const addresses = await prisma.address.findMany({
      where: {
        selections: {
          some: { id: selectionId },
        },
      },
      select: {
        id: true,
        addressString: true,
      },
      orderBy: { id: 'asc' },
      skip: job.currentIndex,
    });

    return addresses;
  }

  return [];
}
