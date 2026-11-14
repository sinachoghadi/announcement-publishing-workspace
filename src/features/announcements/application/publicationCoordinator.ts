import { AnnouncementMockError, type PublicationOperation } from '../../../mocks'
import type { createAnnouncementService } from '../services/announcementService'
import type { PublicationAction } from '../state/publicationReducer'
import {
  selectActiveOperationId,
  selectCanCheckStatus,
  selectCanPublish,
  selectCanRetry,
  selectCanRetryPublication,
  selectPublicationRequest,
} from '../state/publicationSelectors'
import type { AnnouncementId, OperationId, PublicationState } from '../state/publicationTypes'

type PublicationService = Pick<ReturnType<typeof createAnnouncementService>, 'publish' | 'getStatus' | 'listOperations'>
type PublicationStore = {
  getState(): PublicationState
  // Apply the action synchronously and return the resulting state.
  dispatch(action: PublicationAction): PublicationState
}

let nextRequestId = 0

function requireMatchingOperation(
  operation: PublicationOperation,
  announcementId: AnnouncementId,
  operationId: OperationId,
) {
  if (operation.announcementId !== announcementId || operation.operationId !== operationId) {
    throw new Error('The service returned a snapshot for a different publication attempt.', { cause: operation })
  }
}

function describeFailure(error: unknown) {
  if (error instanceof AnnouncementMockError) {
    const outcome = error.code === 'RESPONSE_LOST' || error.code === 'STATUS_UNAVAILABLE'
      ? 'unconfirmed'
      : 'error'
    const { requestId, operationId, announcementId } = error
    return {
      outcome,
      message: error.message,
      code: error.code,
      serviceRequest: { requestId, operationId, announcementId },
    } as const
  }

  return { outcome: 'error', message: 'An unexpected error occurred while contacting the publication service.' } as const
}

export function createPublicationCoordinator(service: PublicationService, { getState, dispatch }: PublicationStore) {
  const publishing = new Map<AnnouncementId, 'initial' | 'retry'>()
  const checking = new Set<OperationId>()

  async function publish(announcementId: AnnouncementId, existingOperationId?: OperationId) {
    if (publishing.has(announcementId)) return
    publishing.set(announcementId, existingOperationId === undefined ? 'initial' : 'retry')
    try {
      const state = getState()
      let operationId = existingOperationId
      if (operationId === undefined) {
        if (!selectCanPublish(state, announcementId) && !selectCanRetry(state, announcementId)) return
        operationId = crypto.randomUUID()
        const registered = dispatch({ type: 'operationStarted', announcementId, operationId })
        if (registered === state || selectActiveOperationId(registered, announcementId) !== operationId) return
      } else if (
        selectActiveOperationId(state, announcementId) !== operationId ||
        !selectCanRetryPublication(state, announcementId)
      ) {
        return
      }

      const request = { announcementId, operationId, requestId: `publication-${++nextRequestId}` }
      const started = dispatch({ type: 'publishStarted', ...request })
      const pending = selectPublicationRequest(started, operationId)
      if (pending?.status !== 'publishing' || pending.requestId !== request.requestId) return

      let operation: PublicationOperation
      try {
        operation = await service.publish(announcementId, operationId)
        requireMatchingOperation(operation, announcementId, operationId)
      } catch (error) {
        dispatch({ type: 'publishFailed', ...request, ...describeFailure(error) })
        throw error
      }

      dispatch({ type: 'publishSucceeded', ...request, operation })
      return operation
    } finally {
      publishing.delete(announcementId)
    }
  }

  return {
    publish,
    async refreshPublicationStatuses() {
      if (getState().recovery.status === 'loading') return

      const requestId = `publication-${++nextRequestId}`
      const { recovery } = dispatch({ type: 'recoveryStarted', requestId })
      if (recovery.status !== 'loading' || recovery.requestId !== requestId) return

      let operations: PublicationOperation[]
      try {
        operations = await service.listOperations()
      } catch (error) {
        const failure = describeFailure(error)
        dispatch({ type: 'recoveryFailed', requestId, message: failure.message, code: failure.code })
        throw error
      }

      dispatch({ type: 'recoverySucceeded', requestId, operations })
      return operations
    },
    retryPublication(announcementId: AnnouncementId, operationId: OperationId) {
      return publish(announcementId, operationId)
    },
    async checkStatus(announcementId: AnnouncementId, operationId: OperationId) {
      const state = getState()
      if (
        checking.has(operationId) ||
        publishing.get(announcementId) === 'retry' ||
        selectActiveOperationId(state, announcementId) !== operationId ||
        !selectCanCheckStatus(state, announcementId)
      ) return

      checking.add(operationId)
      try {
        const request = { announcementId, operationId, requestId: `publication-${++nextRequestId}` }
        dispatch({ type: 'statusCheckStarted', ...request })

        let operation: PublicationOperation | null
        try {
          operation = await service.getStatus(operationId)
          if (operation !== null) requireMatchingOperation(operation, announcementId, operationId)
        } catch (error) {
          dispatch({ type: 'statusCheckFailed', ...request, ...describeFailure(error) })
          throw error
        }

        dispatch({ type: 'statusCheckSucceeded', ...request, operation })
        return operation
      } finally {
        checking.delete(operationId)
      }
    },
  }
}
