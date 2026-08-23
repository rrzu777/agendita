'use server'

import type { BusinessRole, TourStatus, UserTourProgress } from '@prisma/client'
import { action, type ActionResult, UserError } from '@/lib/actions/result'
import { requireBusinessRole } from '@/lib/auth/server'
import { prisma } from '@/lib/db'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import {
  TOUR_CATALOG,
  TOUR_STEP_BOUNDS,
  type TourKey,
  type TourProgressEvent,
} from '@/lib/tours/catalog'
import { nextTourState } from '@/lib/tours/progress'

const POSTGRES_INTEGER_MAX = 2_147_483_647

export type TourProgressSnapshot = {
  key: TourKey
  version: number
  status: TourStatus
  lastStep: number
}

type RecordTourProgressInput = {
  key: TourKey
  version: number
  event: TourProgressEvent
}

type TourCatalogEntry = (typeof TOUR_CATALOG)[TourKey]

function catalogKeys(): TourKey[] {
  return Object.keys(TOUR_CATALOG) as TourKey[]
}

function roleCanUseTour(role: BusinessRole, tour: TourCatalogEntry): boolean {
  return tour.roles.some((allowedRole) => allowedRole === role)
}

function parseInput(input: RecordTourProgressInput): {
  key: TourKey
  version: number
  event: TourProgressEvent
  tour: TourCatalogEntry
} {
  if (!input || typeof input !== 'object') {
    throw new UserError('Datos del recorrido inválidos')
  }

  const candidate = input as Record<string, unknown>
  if (typeof candidate.key !== 'string' || !Object.hasOwn(TOUR_CATALOG, candidate.key)) {
    throw new UserError('Recorrido inválido')
  }

  const key = candidate.key as TourKey
  const tour = TOUR_CATALOG[key]
  if (!Number.isInteger(candidate.version) || candidate.version !== tour.version) {
    throw new UserError('Versión del recorrido inválida')
  }

  const rawEvent = candidate.event
  if (!rawEvent || typeof rawEvent !== 'object') {
    throw new UserError('Evento del recorrido inválido')
  }

  const eventCandidate = rawEvent as Record<string, unknown>
  switch (eventCandidate.type) {
    case 'offer':
    case 'start':
    case 'complete':
    case 'dismiss':
      return {
        key,
        version: tour.version,
        event: { type: eventCandidate.type },
        tour,
      }
    case 'step': {
      const step = eventCandidate.step
      if (
        !Number.isInteger(step)
        || (step as number) < 0
        || (step as number) >= TOUR_STEP_BOUNDS[key]
        || (step as number) > POSTGRES_INTEGER_MAX
      ) {
        throw new UserError('Paso del recorrido inválido')
      }
      return {
        key,
        version: tour.version,
        event: { type: 'step', step: step as number },
        tour,
      }
    }
    default:
      throw new UserError('Evento del recorrido inválido')
  }
}

function timestampState(
  current: UserTourProgress | null,
  event: TourProgressEvent,
  now: Date,
) {
  const timestamps = {
    offeredAt: current?.offeredAt ?? null,
    startedAt: current?.startedAt ?? null,
    completedAt: current?.completedAt ?? null,
    dismissedAt: current?.dismissedAt ?? null,
  }

  if (current?.status === 'completed' || current?.status === 'dismissed') {
    return timestamps
  }

  switch (event.type) {
    case 'offer':
      timestamps.offeredAt ??= now
      break
    case 'start':
    case 'step':
      timestamps.startedAt ??= now
      break
    case 'complete':
      timestamps.completedAt ??= now
      break
    case 'dismiss':
      timestamps.dismissedAt ??= now
      break
  }

  return timestamps
}

async function _getTourProgress(): Promise<TourProgressSnapshot[]> {
  const { businessId, role, user } = await requireBusinessRole(['owner', 'admin'])
  const eligibleKeys = catalogKeys().filter((key) => roleCanUseTour(role, TOUR_CATALOG[key]))

  const rows = await prisma.userTourProgress.findMany({
    where: {
      userId: user.id,
      businessId,
      OR: eligibleKeys.map((key) => ({
        tourKey: key,
        tourVersion: TOUR_CATALOG[key].version,
      })),
    },
    select: {
      tourKey: true,
      tourVersion: true,
      status: true,
      lastStep: true,
    },
  })
  const rowsByCatalogIdentity = new Map(
    rows.map((row) => [`${row.tourKey}:${row.tourVersion}`, row]),
  )

  return eligibleKeys.flatMap((key) => {
    const version = TOUR_CATALOG[key].version
    const row = rowsByCatalogIdentity.get(`${key}:${version}`)
    return row
      ? [{ key, version, status: row.status, lastStep: row.lastStep }]
      : []
  })
}

export const getTourProgress: () => Promise<ActionResult<TourProgressSnapshot[]>> =
  action(_getTourProgress)

async function _recordTourProgress(
  input: RecordTourProgressInput,
): Promise<TourProgressSnapshot> {
  const { businessId, role, user } = await requireBusinessRole(['owner', 'admin'])
  const { key, version, event, tour } = parseInput(input)
  if (!roleCanUseTour(role, tour)) {
    throw new UserError('No tienes permisos para este recorrido')
  }

  const identity = {
    userId: user.id,
    businessId,
    tourKey: key,
    tourVersion: version,
  }

  const row = await prisma.$transaction(async (tx) => {
    await acquireAdvisoryXactLock(
      tx,
      `tour:${user.id}:${businessId}:${key}:${version}`,
    )
    const current = await tx.userTourProgress.findUnique({
      where: { userId_businessId_tourKey_tourVersion: identity },
    })
    if (current?.status === 'completed' || current?.status === 'dismissed') {
      return { status: current.status, lastStep: current.lastStep }
    }
    const next = nextTourState(
      current
        ? { status: current.status, lastStep: current.lastStep }
        : null,
      event,
    )
    const timestamps = timestampState(current, event, new Date())

    return tx.userTourProgress.upsert({
      where: { userId_businessId_tourKey_tourVersion: identity },
      create: {
        ...identity,
        status: next.status,
        lastStep: next.lastStep,
        ...timestamps,
      },
      update: {
        status: next.status,
        lastStep: next.lastStep,
        ...timestamps,
      },
      select: { status: true, lastStep: true },
    })
  })

  return { key, version, status: row.status, lastStep: row.lastStep }
}

export const recordTourProgress: (
  input: RecordTourProgressInput,
) => Promise<ActionResult<TourProgressSnapshot>> = action(_recordTourProgress)
