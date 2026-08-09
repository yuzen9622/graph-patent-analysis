export type FrozenPosition = {
  x: number
  y: number
}

export type FrozenPositions = Record<string, FrozenPosition>

export type PositionSnapshotProvider = {
  key: string
  getPositions: () => FrozenPositions | null
}

export const MAX_FROZEN_POSITION_ENTRIES = 50_000
export const MAX_EXPORT_BODY_BYTES = 8 * 1024 * 1024

export class ExportPositionsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportPositionsError'
  }
}

export class ExportBodyTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportBodyTooLargeError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * Reads an export request body without allowing unbounded JSON allocation.
 */
export async function readExportJsonBody(
  request: Request,
  maxBytes = MAX_EXPORT_BODY_BYTES,
): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength)
    if (!Number.isFinite(declaredBytes) || declaredBytes > maxBytes) {
      throw new ExportBodyTooLargeError('Export body too large')
    }
  }

  const body = request.body
  if (!body) return JSON.parse('')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let bytesRead = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // Cancellation is best-effort after rejecting an oversized body.
        }
        throw new ExportBodyTooLargeError('Export body too large')
      }

      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
  } finally {
    reader.releaseLock()
  }

  return JSON.parse(chunks.join(''))
}

/**
 * Validates the POST body used to freeze an Offline HTML export against the
 * server-generated node IDs for its selected view.
 */
export function parseExportPositions(
  body: unknown,
  expectedNodeIds: Iterable<string>,
): FrozenPositions {
  if (
    !isPlainObject(body) ||
    Object.keys(body).length !== 1 ||
    !hasOwn(body, 'positions')
  ) {
    throw new ExportPositionsError('Invalid export body')
  }

  const rawPositions = body.positions
  if (!isPlainObject(rawPositions)) {
    throw new ExportPositionsError('Invalid positions')
  }

  const positionIds = Object.keys(rawPositions)
  if (positionIds.length > MAX_FROZEN_POSITION_ENTRIES) {
    throw new ExportPositionsError('Too many positions')
  }

  const expectedIds = new Set(expectedNodeIds)
  if (
    positionIds.length !== expectedIds.size ||
    positionIds.some((id) => !expectedIds.has(id))
  ) {
    throw new ExportPositionsError('Position IDs do not match graph')
  }

  const positions = Object.create(null) as FrozenPositions
  for (const id of positionIds) {
    const position = rawPositions[id]
    if (
      !isPlainObject(position) ||
      Object.keys(position).length !== 2 ||
      !hasOwn(position, 'x') ||
      !hasOwn(position, 'y') ||
      typeof position.x !== 'number' ||
      typeof position.y !== 'number' ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      throw new ExportPositionsError('Invalid position')
    }

    positions[id] = { x: position.x, y: position.y }
  }

  return positions
}
