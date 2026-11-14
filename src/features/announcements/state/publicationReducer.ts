import type { AnnouncementErrorCode, PublicationOperation } from '../../../mocks'
import { selectHasPublished, selectPublicationRequestFailure } from './publicationSelectors'
import type {
  AnnouncementId,
  OperationId,
  PublicationRequestState,
  PublicationState,
} from './publicationTypes'

type OperationRequest = {
  operationId: OperationId
  requestId: string
  announcementId?: AnnouncementId
}

export type PublicationAction =
  | { type: 'operationStarted'; announcementId: AnnouncementId; operationId: OperationId }
  | ({ type: 'publishStarted' | 'statusCheckStarted' } & OperationRequest)
  | ({ type: 'publishSucceeded'; operation: PublicationOperation } & OperationRequest)
  | ({ type: 'statusCheckSucceeded'; operation: PublicationOperation | null } & OperationRequest)
  | ({
      type: 'publishFailed' | 'statusCheckFailed'
      message: string
      code?: AnnouncementErrorCode
      outcome: 'error' | 'unconfirmed'
    } & OperationRequest)
  | { type: 'snapshotReceived'; operation: PublicationOperation }
  | { type: 'recoveryStarted'; requestId: string }
  | { type: 'recoverySucceeded'; requestId: string; operations: readonly PublicationOperation[] }
  | { type: 'recoveryFailed'; requestId: string; message: string }

function findAnnouncementId(state: PublicationState, operationId: OperationId) {
  const operation = state.operationsById.get(operationId)
  if (operation) return operation.announcementId

  for (const [announcementId, activeId] of state.activeOperationIdByAnnouncementId) {
    if (activeId === operationId) return announcementId
  }
}

function setRequest(
  state: PublicationState,
  operationId: OperationId,
  request: PublicationRequestState,
): PublicationState {
  const requestsByOperationId = new Map(state.requestsByOperationId)
  requestsByOperationId.set(operationId, request)
  return { ...state, requestsByOperationId }
}

function matchesSnapshotIdentity(
  snapshot: PublicationOperation,
  operationId: OperationId,
  announcementId: AnnouncementId | undefined,
) {
  return snapshot.operationId === operationId &&
    (announcementId === undefined || snapshot.announcementId === announcementId)
}

function canAcceptSnapshot(
  snapshot: PublicationOperation,
  current: PublicationOperation | undefined,
  announcementId: AnnouncementId | undefined,
) {
  return matchesSnapshotIdentity(snapshot, current?.operationId ?? snapshot.operationId, announcementId) &&
    (current === undefined || snapshot.version > current.version)
}

function mergeSnapshots(
  state: PublicationState,
  snapshots: readonly PublicationOperation[],
): PublicationState {
  let operations: Map<OperationId, PublicationOperation> | undefined
  let requests: Map<OperationId, PublicationRequestState> | undefined

  for (const snapshot of snapshots) {
    const { operationId } = snapshot
    const current = (operations ?? state.operationsById).get(operationId)
    const owner = current?.announcementId ?? findAnnouncementId(state, operationId)
    if (!canAcceptSnapshot(snapshot, current, owner)) continue

    operations ??= new Map(state.operationsById)
    operations.set(operationId, snapshot)
    const request = state.requestsByOperationId.get(operationId)
    if (request && (snapshot.status !== 'processing' || request.status === 'unconfirmed')) {
      requests ??= new Map(state.requestsByOperationId)
      requests.delete(operationId)
    } else if (request?.status === 'checking' && request.previousFailure?.status === 'unconfirmed') {
      requests ??= new Map(state.requestsByOperationId)
      requests.set(operationId, { status: 'checking', requestId: request.requestId })
    }
  }

  if (!operations) return state
  return {
    ...state,
    operationsById: operations,
    requestsByOperationId: requests ?? state.requestsByOperationId,
  }
}

function restoreOperations(
  state: PublicationState,
  snapshots: readonly PublicationOperation[],
): PublicationState {
  const merged = mergeSnapshots(state, snapshots)
  const latest = new Map<AnnouncementId, PublicationOperation>()

  for (const snapshot of snapshots) {
    const operation = merged.operationsById.get(snapshot.operationId)
    if (!operation || operation.announcementId !== snapshot.announcementId) continue

    const candidate = latest.get(operation.announcementId)
    // Prefer confirmed publication, then use creation order for equal timestamps.
    if (
      !candidate ||
      (operation.status === 'published' && candidate.status !== 'published') ||
      (candidate.status !== 'published' && operation.createdAt >= candidate.createdAt)
    ) {
      latest.set(operation.announcementId, operation)
    }
  }

  let activeOperationIdByAnnouncementId: Map<AnnouncementId, OperationId> | undefined
  for (const [announcementId, operation] of latest) {
    const activeId = state.activeOperationIdByAnnouncementId.get(announcementId)
    const active = activeId === undefined ? undefined : merged.operationsById.get(activeId)
    // Preserve local attempts awaiting their first snapshot and confirmed successes.
    if (activeId === undefined || (active?.status === 'rejected' && operation.createdAt > active.createdAt)) {
      activeOperationIdByAnnouncementId ??= new Map(state.activeOperationIdByAnnouncementId)
      activeOperationIdByAnnouncementId.set(announcementId, operation.operationId)
    }
  }

  return {
    ...merged,
    activeOperationIdByAnnouncementId: activeOperationIdByAnnouncementId ?? state.activeOperationIdByAnnouncementId,
    recovery: { status: 'idle' },
  }
}

function matchesRequest(
  state: PublicationState,
  action: OperationRequest,
  status: 'publishing' | 'checking',
) {
  const request = state.requestsByOperationId.get(action.operationId)
  return request?.status === status && request.requestId === action.requestId &&
    (action.announcementId === undefined || action.announcementId === findAnnouncementId(state, action.operationId))
}

export function publicationReducer(state: PublicationState, action: PublicationAction): PublicationState {
  switch (action.type) {
    case 'operationStarted': {
      const { announcementId, operationId } = action
      if (findAnnouncementId(state, operationId) !== undefined || selectHasPublished(state, announcementId)) {
        return state
      }

      const activeId = state.activeOperationIdByAnnouncementId.get(announcementId)
      if (activeId !== undefined && state.operationsById.get(activeId)?.status !== 'rejected') return state

      const activeOperationIdByAnnouncementId = new Map(state.activeOperationIdByAnnouncementId)
      activeOperationIdByAnnouncementId.set(announcementId, operationId)
      return { ...state, activeOperationIdByAnnouncementId }
    }
    case 'publishStarted':
    case 'statusCheckStarted': {
      const { operationId, requestId } = action
      const announcementId = findAnnouncementId(state, operationId)
      if (announcementId === undefined || (action.announcementId !== undefined && action.announcementId !== announcementId)) {
        return state
      }
      if (action.type === 'statusCheckStarted') {
        const previousFailure = selectPublicationRequestFailure(state, operationId)
        return setRequest(state, operationId, { status: 'checking', requestId, previousFailure })
      }

      const operation = state.operationsById.get(operationId)
      const request = state.requestsByOperationId.get(operationId)
      if (
        state.activeOperationIdByAnnouncementId.get(announcementId) !== operationId ||
        (operation && operation.status !== 'processing') ||
        request?.status === 'publishing' ||
        request?.status === 'checking' ||
        selectHasPublished(state, announcementId)
      ) return state

      const previousFailure = selectPublicationRequestFailure(state, operationId)
      return setRequest(state, operationId, { status: 'publishing', requestId, previousFailure })
    }
    case 'publishSucceeded':
    case 'statusCheckSucceeded': {
      const { operationId, operation } = action
      const announcementId = findAnnouncementId(state, operationId)
      if (announcementId === undefined || (action.announcementId !== undefined && action.announcementId !== announcementId)) {
        return state
      }
      if (operation && !matchesSnapshotIdentity(operation, operationId, announcementId)) {
        return state
      }

      const status = action.type === 'publishSucceeded' ? 'publishing' : 'checking'
      // A matching response can settle its request even if its snapshot adds no information.
      let next = state
      if (matchesRequest(state, action, status)) {
        const missingSnapshot = !operation && (
          !state.operationsById.has(operationId) ||
          selectPublicationRequestFailure(state, operationId)?.status === 'unconfirmed'
        )
        next = setRequest(state, operationId, missingSnapshot
          ? selectPublicationRequestFailure(state, operationId) ??
            { status: 'unconfirmed', message: 'The service has no record of this publication attempt.' }
          : { status: 'idle' })
      }
      return operation ? mergeSnapshots(next, [operation]) : next
    }
    case 'publishFailed':
    case 'statusCheckFailed': {
      const status = action.type === 'publishFailed' ? 'publishing' : 'checking'
      const { operationId, announcementId, code, message } = action
      const operation = state.operationsById.get(operationId)
      const failure = { status: action.outcome, message, code }
      if (!matchesRequest(state, action, status)) {
        // A manual check can take over the request slot while publish is in flight.
        if (action.type !== 'publishFailed' || code !== 'RESPONSE_LOST' || operation ||
          announcementId === undefined || state.activeOperationIdByAnnouncementId.get(announcementId) !== operationId) {
          return state
        }
        const request = state.requestsByOperationId.get(operationId)
        if (request?.status === 'publishing' || selectPublicationRequestFailure(state, operationId)?.status === 'unconfirmed') {
          return state
        }
        return setRequest(state, operationId, request?.status === 'checking'
          ? { ...request, previousFailure: failure }
          : failure)
      }

      const previousFailure = selectPublicationRequestFailure(state, operationId)
      const permanentFailure = code === 'OPERATION_ID_CONFLICT' || code === 'UNKNOWN_ANNOUNCEMENT'
      return setRequest(state, operationId, operation && operation.status !== 'processing'
        ? { status: 'idle' }
        : { ...failure, status: !permanentFailure && previousFailure?.status === 'unconfirmed' ? 'unconfirmed' : failure.status })
    }
    case 'snapshotReceived':
      return mergeSnapshots(state, [action.operation])
    case 'recoveryStarted':
      return { ...state, recovery: { status: 'loading', requestId: action.requestId } }
    case 'recoverySucceeded':
    case 'recoveryFailed':
      if (state.recovery.status !== 'loading' || state.recovery.requestId !== action.requestId) return state
      return action.type === 'recoverySucceeded'
        ? restoreOperations(state, action.operations)
        : { ...state, recovery: { status: 'error', message: action.message } }
  }
}
