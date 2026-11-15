import type { AnnouncementErrorCode, PublicationOperation } from '../../../mocks'
import { isPublicationIdentityError, selectHasPublished, selectPublicationRequestFailure } from './publicationSelectors'
import type {
  AnnouncementId,
  OperationId,
  PublicationRequestFailure,
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
      serviceRequest?: PublicationRequestFailure['serviceRequest']
      outcome: 'error' | 'unconfirmed'
    } & OperationRequest)
  | { type: 'snapshotReceived'; operation: PublicationOperation }
  | { type: 'recoveryStarted'; requestId: string }
  | { type: 'recoverySucceeded'; requestId: string; operations: readonly PublicationOperation[] }
  | { type: 'recoveryFailed'; requestId: string; message: string; code?: AnnouncementErrorCode }

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

function mergeSnapshots(
  state: PublicationState,
  snapshots: readonly PublicationOperation[],
  canSettleRequest: (operationId: OperationId) => boolean = () => true,
): PublicationState {
  let operations: Map<OperationId, PublicationOperation> | undefined
  let requests: Map<OperationId, PublicationRequestState> | undefined

  for (const snapshot of snapshots) {
    const { operationId } = snapshot
    const current = (operations ?? state.operationsById).get(operationId)
    const owner = current?.announcementId ?? findAnnouncementId(state, operationId)
    if (!matchesSnapshotIdentity(snapshot, current?.operationId ?? operationId, owner)) continue

    const request = (requests ?? state.requestsByOperationId).get(operationId)
    const canSettle = canSettleRequest(operationId)
    if (current && snapshot.version <= current.version) {
      // A current-version status read can resolve a communication error without replacing the snapshot.
      if (
        canSettle && snapshot.version === current.version &&
        (request?.status === 'error' || request?.status === 'unconfirmed') &&
        request.code === 'STATUS_UNAVAILABLE'
      ) {
        requests ??= new Map(state.requestsByOperationId)
        requests.delete(operationId)
      }
      continue
    }

    operations ??= new Map(state.operationsById)
    operations.set(operationId, snapshot)
    // A delayed processing response can add a snapshot without settling a newer request.
    if (!canSettle && snapshot.status === 'processing') continue
    if (request && (
      snapshot.status !== 'processing' || request.status === 'unconfirmed' ||
      (request.status === 'error' && request.code === 'STATUS_UNAVAILABLE')
    )) {
      requests ??= new Map(state.requestsByOperationId)
      requests.delete(operationId)
    } else if (request?.status === 'checking' && request.previousFailure?.status === 'unconfirmed') {
      requests ??= new Map(state.requestsByOperationId)
      requests.set(operationId, { status: 'checking', requestId: request.requestId })
    }
  }

  if (!operations && !requests) return state
  return {
    ...state,
    operationsById: operations ?? state.operationsById,
    requestsByOperationId: requests ?? state.requestsByOperationId,
  }
}

function releaseConflictedAttempts(
  state: PublicationState,
  snapshots: readonly PublicationOperation[],
): PublicationState {
  let activeIds: Map<AnnouncementId, OperationId> | undefined
  let requests: Map<OperationId, PublicationRequestState> | undefined

  for (const { operationId, announcementId } of snapshots) {
    const request = state.requestsByOperationId.get(operationId)
    if (request?.status !== 'error' || request.code !== 'OPERATION_ID_CONFLICT' ||
      state.operationsById.has(operationId)) continue

    const provisionalOwner = findAnnouncementId(state, operationId)
    if (provisionalOwner === undefined || provisionalOwner === announcementId) continue

    // The list confirms the service owner, so discard the failed local reservation.
    activeIds ??= new Map(state.activeOperationIdByAnnouncementId)
    requests ??= new Map(state.requestsByOperationId)
    activeIds.delete(provisionalOwner)
    requests.delete(operationId)
  }

  return activeIds && requests
    ? { ...state, activeOperationIdByAnnouncementId: activeIds, requestsByOperationId: requests }
    : state
}

function restoreOperations(
  previous: PublicationState,
  snapshots: readonly PublicationOperation[],
  requestsAtStart: PublicationState['requestsByOperationId'],
): PublicationState {
  const state = releaseConflictedAttempts(previous, snapshots)
  const merged = mergeSnapshots(state, snapshots, (id) =>
    requestsAtStart.get(id) === state.requestsByOperationId.get(id),
  )
  const latest = new Map<AnnouncementId, PublicationOperation>()
  const positionByOperationId = new Map<OperationId, number>()

  for (const [position, snapshot] of snapshots.entries()) {
    const operation = merged.operationsById.get(snapshot.operationId)
    if (!operation || operation.announcementId !== snapshot.announcementId) continue
    positionByOperationId.set(operation.operationId, position)

    const candidate = latest.get(operation.announcementId)
    // Prefer confirmed publication. The service lists attempts in creation order for timestamp ties.
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
    const followsRejectedAttempt = active?.status === 'rejected' && (
      operation.createdAt > active.createdAt ||
      (operation.createdAt === active.createdAt &&
        (positionByOperationId.get(operation.operationId) ?? -1) > (positionByOperationId.get(active.operationId) ?? Infinity))
    )
    if (activeId === undefined || followsRejectedAttempt) {
      activeOperationIdByAnnouncementId ??= new Map(state.activeOperationIdByAnnouncementId)
      activeOperationIdByAnnouncementId.set(announcementId, operation.operationId)
    }
  }

  return {
    ...merged,
    activeOperationIdByAnnouncementId: activeOperationIdByAnnouncementId ?? state.activeOperationIdByAnnouncementId,
    recovery: { status: 'success' },
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
      const matchingRequest = matchesRequest(state, action, status)
      // A matching response can settle its request even if its snapshot adds no information.
      let next = state
      if (matchingRequest) {
        const previousFailure = selectPublicationRequestFailure(state, operationId)
        const missingSnapshot = !operation && (
          !state.operationsById.has(operationId) ||
          previousFailure?.status === 'unconfirmed' ||
          previousFailure?.code === 'STATUS_UNAVAILABLE'
        )
        next = setRequest(state, operationId, missingSnapshot
          ? previousFailure ??
            { status: 'unconfirmed', message: 'The service has no record of this publication attempt.' }
          : { status: 'idle' })
      }
      return operation ? mergeSnapshots(next, [operation], () => matchingRequest) : next
    }
    case 'publishFailed':
    case 'statusCheckFailed': {
      const status = action.type === 'publishFailed' ? 'publishing' : 'checking'
      const { operationId, announcementId, code, message, serviceRequest } = action
      const operation = state.operationsById.get(operationId)
      const permanentFailure = isPublicationIdentityError(code)
      const failure: PublicationRequestFailure = {
        status: permanentFailure ? 'error' : action.outcome,
        message,
        code,
        serviceRequest,
      }
      if (!matchesRequest(state, action, status)) {
        // A manual check can take over the request slot while publish is in flight.
        if (permanentFailure && action.type === 'publishFailed' && announcementId !== undefined &&
          state.activeOperationIdByAnnouncementId.get(announcementId) === operationId &&
          state.requestsByOperationId.get(operationId)?.status !== 'publishing') {
          return setRequest(state, operationId, failure)
        }
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

      if (permanentFailure) return setRequest(state, operationId, failure)

      const previousFailure = selectPublicationRequestFailure(state, operationId)
      const failureStatus = code === 'STATUS_UNAVAILABLE' && operation?.status === 'processing'
        ? 'error'
        : previousFailure?.status === 'unconfirmed' ? 'unconfirmed' : failure.status
      return setRequest(state, operationId, operation && operation.status !== 'processing'
        ? { status: 'idle' }
        : { ...failure, status: failureStatus })
    }
    case 'snapshotReceived':
      return mergeSnapshots(state, [action.operation])
    case 'recoveryStarted':
      if (state.recovery.status === 'loading') return state
      return {
        ...state,
        recovery: { status: 'loading', requestId: action.requestId, requestsAtStart: state.requestsByOperationId },
      }
    case 'recoverySucceeded':
    case 'recoveryFailed':
      if (state.recovery.status !== 'loading' || state.recovery.requestId !== action.requestId) return state
      return action.type === 'recoverySucceeded'
        ? restoreOperations(state, action.operations, state.recovery.requestsAtStart)
        : { ...state, recovery: { status: 'error', message: action.message, code: action.code } }
  }
}
