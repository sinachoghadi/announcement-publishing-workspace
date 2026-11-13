import type { PublicationOperation } from '../../../mocks'
import type {
  AnnouncementId,
  OperationId,
  PublicationRequestState,
  PublicationState,
} from './publicationTypes'

type OperationRequest = { operationId: OperationId; requestId: string }

export type PublicationAction =
  | { type: 'operationStarted'; announcementId: AnnouncementId; operationId: OperationId }
  | ({ type: 'publishStarted' | 'statusCheckStarted' } & OperationRequest)
  | ({ type: 'publishSucceeded'; operation: PublicationOperation } & OperationRequest)
  | ({ type: 'statusCheckSucceeded'; operation: PublicationOperation | null } & OperationRequest)
  | ({
      type: 'publishFailed' | 'statusCheckFailed'
      message: string
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

function hasPublished(state: PublicationState, announcementId: AnnouncementId) {
  for (const operation of state.operationsById.values()) {
    if (operation.announcementId === announcementId && operation.status === 'published') return true
  }
  return false
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

function mergeSnapshots(
  state: PublicationState,
  snapshots: readonly PublicationOperation[],
): PublicationState {
  let operations: Map<OperationId, PublicationOperation> | undefined
  let requests: Map<OperationId, PublicationRequestState> | undefined

  for (const snapshot of snapshots) {
    const { operationId, announcementId, version } = snapshot
    const current = (operations ?? state.operationsById).get(operationId)
    const owner = current?.announcementId ?? findAnnouncementId(state, operationId)
    if (owner !== undefined && owner !== announcementId) continue
    if (current && current.version >= version) continue

    operations ??= new Map(state.operationsById)
    operations.set(operationId, snapshot)
    if (snapshot.status !== 'processing' && state.requestsByOperationId.has(operationId)) {
      requests ??= new Map(state.requestsByOperationId)
      requests.delete(operationId)
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

  const activeOperationIdByAnnouncementId = new Map(state.activeOperationIdByAnnouncementId)
  for (const [announcementId, operation] of latest) {
    const activeId = activeOperationIdByAnnouncementId.get(announcementId)
    const active = activeId === undefined ? undefined : merged.operationsById.get(activeId)
    // Preserve local attempts awaiting their first snapshot and confirmed successes.
    if (activeId === undefined || (active?.status === 'rejected' && operation.createdAt > active.createdAt)) {
      activeOperationIdByAnnouncementId.set(announcementId, operation.operationId)
    }
  }

  return { ...merged, activeOperationIdByAnnouncementId, recovery: { status: 'idle' } }
}

function matchesRequest(
  state: PublicationState,
  action: OperationRequest,
  status: 'publishing' | 'checking',
) {
  const request = state.requestsByOperationId.get(action.operationId)
  return request?.status === status && request.requestId === action.requestId
}

export function publicationReducer(state: PublicationState, action: PublicationAction): PublicationState {
  switch (action.type) {
    case 'operationStarted': {
      const { announcementId, operationId } = action
      if (findAnnouncementId(state, operationId) !== undefined || hasPublished(state, announcementId)) {
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
      if (announcementId === undefined) return state
      if (action.type === 'statusCheckStarted') {
        return setRequest(state, operationId, { status: 'checking', requestId })
      }

      const operation = state.operationsById.get(operationId)
      const request = state.requestsByOperationId.get(operationId)
      if (
        state.activeOperationIdByAnnouncementId.get(announcementId) !== operationId ||
        (operation && operation.status !== 'processing') ||
        request?.status === 'publishing' ||
        request?.status === 'checking' ||
        hasPublished(state, announcementId)
      ) return state

      return setRequest(state, operationId, { status: 'publishing', requestId })
    }
    case 'publishSucceeded':
    case 'statusCheckSucceeded': {
      const { operationId, operation } = action
      const announcementId = findAnnouncementId(state, operationId)
      if (announcementId === undefined) return state
      if (operation && (operation.operationId !== operationId || operation.announcementId !== announcementId)) {
        return state
      }

      const status = action.type === 'publishSucceeded' ? 'publishing' : 'checking'
      let next = state
      if (matchesRequest(state, action, status)) {
        next = setRequest(state, operationId, !operation && !state.operationsById.has(operationId)
          ? { status: 'unconfirmed', message: 'The service has no record of this publication attempt.' }
          : { status: 'idle' })
      }
      return operation ? mergeSnapshots(next, [operation]) : next
    }
    case 'publishFailed':
    case 'statusCheckFailed': {
      const status = action.type === 'publishFailed' ? 'publishing' : 'checking'
      if (!matchesRequest(state, action, status)) return state

      const operation = state.operationsById.get(action.operationId)
      return setRequest(state, action.operationId, operation && operation.status !== 'processing'
        ? { status: 'idle' }
        : { status: action.outcome, message: action.message })
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
