import { AnnouncementMockError, type PublicationOperation } from '../../../mocks'
import type { createAnnouncementService } from '../services/announcementService'
import type { PublicationAction } from '../state/publicationReducer'
import type { AnnouncementId, OperationId } from '../state/publicationTypes'

type PublicationService = Pick<ReturnType<typeof createAnnouncementService>, 'publish' | 'getStatus'>
type Dispatch = (action: PublicationAction) => void

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
    return { outcome, message: error.message } as const
  }

  return { outcome: 'error', message: 'An unexpected error occurred while contacting the publication service.' } as const
}

export function createPublicationCoordinator(service: PublicationService, dispatch: Dispatch) {
  return {
    // The caller supplies an operation ID after checking whether publication is allowed.
    async publish(announcementId: AnnouncementId, operationId: OperationId) {
      const request = { announcementId, operationId, requestId: `publication-${++nextRequestId}` }
      dispatch({ type: 'operationStarted', announcementId, operationId })
      dispatch({ type: 'publishStarted', ...request })

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
    },

    async checkStatus(announcementId: AnnouncementId, operationId: OperationId) {
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
    },
  }
}
