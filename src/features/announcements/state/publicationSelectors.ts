import type { AnnouncementErrorCode, PublicationOperation } from '../../../mocks'
import type {
  AnnouncementId,
  OperationId,
  PublicationRequestState,
  PublicationState,
} from './publicationTypes'

export type PublicationDisplayStatus = PublicationOperation['status'] | 'not-published' | 'unconfirmed' | 'request-error'

export function isPublicationIdentityError(code: AnnouncementErrorCode | undefined) {
  return code === 'OPERATION_ID_CONFLICT' || code === 'UNKNOWN_ANNOUNCEMENT'
}

export function selectActiveOperationId(state: PublicationState, announcementId: AnnouncementId) {
  return state.activeOperationIdByAnnouncementId.get(announcementId)
}

export function selectOperation(state: PublicationState, operationId: OperationId) {
  return state.operationsById.get(operationId)
}

export function selectActiveOperation(state: PublicationState, announcementId: AnnouncementId) {
  const operationId = selectActiveOperationId(state, announcementId)
  return operationId === undefined ? undefined : selectOperation(state, operationId)
}

export function selectPublicationStatus(state: PublicationState, announcementId: AnnouncementId) {
  return selectActiveOperation(state, announcementId)?.status
}

export function selectPublicationRequest(
  state: PublicationState,
  operationId: OperationId,
): PublicationRequestState | undefined {
  return state.requestsByOperationId.get(operationId)
}

export function selectPublicationRequestFailure(state: PublicationState, operationId: OperationId) {
  const request = selectPublicationRequest(state, operationId)
  if (request?.status === 'checking' || request?.status === 'publishing') return request.previousFailure
  if (request?.status === 'error' || request?.status === 'unconfirmed') return request
}

export function selectPublicationRequestError(state: PublicationState, operationId: OperationId) {
  return selectPublicationRequestFailure(state, operationId)?.message
}

export function selectPublicationDisplayStatus(
  state: PublicationState,
  announcementId: AnnouncementId,
): PublicationDisplayStatus {
  const operationId = selectActiveOperationId(state, announcementId)
  if (operationId === undefined) return 'not-published'

  const status = selectOperation(state, operationId)?.status
  if (status === 'published' || status === 'rejected') return status

  const failure = selectPublicationRequestFailure(state, operationId)
  if (isPublicationIdentityError(failure?.code)) return status ?? 'request-error'
  if (failure && failure.code !== 'STATUS_UNAVAILABLE') return 'unconfirmed'

  return status ?? 'unconfirmed'
}

export function selectHasPublished(state: PublicationState, announcementId: AnnouncementId) {
  for (const operation of state.operationsById.values()) {
    if (operation.announcementId === announcementId && operation.status === 'published') return true
  }
  return false
}

export function selectCanPublish(state: PublicationState, announcementId: AnnouncementId) {
  return state.recovery.status === 'success' &&
    selectActiveOperationId(state, announcementId) === undefined &&
    !selectHasPublished(state, announcementId)
}

export function selectCanCheckStatus(state: PublicationState, announcementId: AnnouncementId) {
  const operationId = selectActiveOperationId(state, announcementId)
  if (operationId === undefined) return false

  const status = selectOperation(state, operationId)?.status
  if (status === 'published' || status === 'rejected') return false
  if (isPublicationIdentityError(selectPublicationRequestFailure(state, operationId)?.code)) return false

  // An operation can finish while its original publish response is still in flight.
  return selectPublicationRequest(state, operationId)?.status !== 'checking'
}

export type PublicationActionButton = {
  action: 'publish' | 'retry' | 'check-status' | 'new-attempt'
  label: string
  disabled: boolean
  busy: boolean
  primary: boolean
}

export function selectPublicationActions(state: PublicationState, announcementId: AnnouncementId): PublicationActionButton[] {
  const operationId = selectActiveOperationId(state, announcementId)
  if (operationId === undefined) {
    return [{ action: 'publish', label: 'Publish', disabled: !selectCanPublish(state, announcementId), busy: false, primary: true }]
  }

  const status = selectPublicationStatus(state, announcementId)
  if (status === 'published') return []
  if (status === 'rejected') {
    return [{ action: 'new-attempt', label: 'New attempt', disabled: !selectCanRetry(state, announcementId), busy: false, primary: true }]
  }

  const request = selectPublicationRequest(state, operationId)
  const failure = selectPublicationRequestFailure(state, operationId)
  if (isPublicationIdentityError(failure?.code)) return []

  const publishing = request?.status === 'publishing'
  const checking = request?.status === 'checking'
  const buttons: PublicationActionButton[] = []
  const retry = failure !== undefined
  if (publishing || retry) {
    buttons.push({
      action: retry ? 'retry' : 'publish',
      label: publishing ? (retry ? 'Retrying…' : 'Publishing…') : 'Retry request',
      disabled: publishing || !selectCanRetryPublication(state, announcementId),
      busy: publishing,
      primary: true,
    })
  }
  buttons.push({
    action: 'check-status',
    label: checking ? 'Checking…' : 'Check status',
    disabled: publishing || !selectCanCheckStatus(state, announcementId),
    busy: checking,
    primary: buttons.length === 0,
  })
  return buttons
}

export function selectCanRetry(state: PublicationState, announcementId: AnnouncementId) {
  return state.recovery.status === 'success' &&
    selectPublicationStatus(state, announcementId) === 'rejected' &&
    !selectHasPublished(state, announcementId)
}

export function selectCanRetryPublication(state: PublicationState, announcementId: AnnouncementId) {
  const operationId = selectActiveOperationId(state, announcementId)
  if (operationId === undefined || selectHasPublished(state, announcementId)) return false

  const request = selectPublicationRequest(state, operationId)
  if (request?.status === 'publishing' || request?.status === 'checking') return false
  const code = selectPublicationRequestFailure(state, operationId)?.code
  if (isPublicationIdentityError(code)) return false

  const operation = selectOperation(state, operationId)
  return operation ? operation.status === 'processing' : request?.status === 'unconfirmed'
}
