import { useMemo, useReducer } from 'react'
import { publicationReducer } from '../state/publicationReducer'
import {
  selectActiveOperationId,
  selectCanCheckStatus,
  selectCanPublish,
  selectCanRetry,
  selectOperation,
  selectPublicationDisplayStatus,
  selectPublicationRequest,
  selectPublicationRequestError,
} from '../state/publicationSelectors'
import { initialPublicationState, type AnnouncementId, type OperationId } from '../state/publicationTypes'

export function usePublicationWorkspace() {
  const [state, dispatch] = useReducer(publicationReducer, initialPublicationState)
  const application = useMemo(() => ({ dispatch }), [dispatch])

  return useMemo(() => ({
    getAnnouncementPublication(announcementId: AnnouncementId) {
      const operationId = selectActiveOperationId(state, announcementId)

      return {
        operationId,
        operation: operationId === undefined ? undefined : selectOperation(state, operationId),
        displayStatus: selectPublicationDisplayStatus(state, announcementId),
        request: operationId === undefined ? undefined : selectPublicationRequest(state, operationId),
        requestError: operationId === undefined ? undefined : selectPublicationRequestError(state, operationId),
        canPublish: selectCanPublish(state, announcementId),
        canCheckStatus: selectCanCheckStatus(state, announcementId),
        canRetry: selectCanRetry(state, announcementId),
      }
    },
    getOperation: (operationId: OperationId) => selectOperation(state, operationId),
    recovery: state.recovery,
    // The workspace passes this interface to application logic.
    application,
  }), [state, application])
}
