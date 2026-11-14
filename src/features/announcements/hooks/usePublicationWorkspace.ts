import { useCallback, useMemo, useReducer, useRef } from 'react'
import { createPublicationCoordinator } from '../application/publicationCoordinator'
import { getStatus, publish } from '../services/announcementService'
import { publicationReducer, type PublicationAction } from '../state/publicationReducer'
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
  const latestState = useRef(initialPublicationState)
  const application = useMemo(() => ({
    getState: () => latestState.current,
    dispatch(action: PublicationAction) {
      // Confirm application actions immediately, even when React batches rendering.
      const next = publicationReducer(latestState.current, action)
      if (next !== latestState.current) {
        latestState.current = next
        dispatch(action)
      }
      return next
    },
  }), [dispatch])

  const coordinator = useRef<ReturnType<typeof createPublicationCoordinator> | null>(null)
  const publishAnnouncement = useCallback((announcementId: AnnouncementId) => {
    coordinator.current ??= createPublicationCoordinator({ publish, getStatus }, application)
    return coordinator.current.publish(announcementId)
  }, [application])

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
    publishAnnouncement,
    recovery: state.recovery,
    // The workspace passes this interface to application logic.
    application,
  }), [state, application, publishAnnouncement])
}
