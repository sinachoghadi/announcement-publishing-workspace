import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { createPublicationCoordinator } from '../application/publicationCoordinator'
import { createPublicationPolling } from '../application/publicationPolling'
import { getStatus, listOperations, publish } from '../services/announcementService'
import { publicationReducer, type PublicationAction } from '../state/publicationReducer'
import {
  selectActiveOperationId,
  selectCanCheckStatus,
  selectCanPublish,
  selectCanRetry,
  selectCanRetryPublication,
  selectOperation,
  selectPublicationDisplayStatus,
  selectPublicationRequest,
  selectPublicationRequestError,
  selectPublicationRequestFailure,
} from '../state/publicationSelectors'
import { initialPublicationState, type AnnouncementId, type OperationId } from '../state/publicationTypes'

export function usePublicationWorkspace({ pollIntervalMs = 2000, maxPollIntervalMs = 10000 } = {}) {
  const [state, dispatch] = useReducer(publicationReducer, initialPublicationState)
  const latestState = useRef(initialPublicationState)
  const mounted = useRef(false)
  const application = useMemo(() => ({
    getState: () => latestState.current,
    dispatch(action: PublicationAction) {
      if (!mounted.current) return latestState.current
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
  const polling = useRef<ReturnType<typeof createPublicationPolling> | null>(null)

  const getCoordinator = useCallback(() => {
    coordinator.current ??= createPublicationCoordinator({ publish, getStatus, listOperations }, application)
    return coordinator.current
  }, [application])

  useEffect(() => {
    mounted.current = true
    if (application.getState().recovery.status === 'idle') {
      // Strict Mode effect replay sees the existing request state.
      void getCoordinator().refreshPublicationStatuses().catch(() => {})
    }
    return () => {
      mounted.current = false
    }
  }, [application, getCoordinator])

  useEffect(() => {
    const interval = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 2000
    const maxInterval = Number.isFinite(maxPollIntervalMs) ? Math.max(interval, maxPollIntervalMs) : interval
    const current = createPublicationPolling(
      application.getState,
      getCoordinator().checkStatus,
      interval,
      maxInterval,
    )
    polling.current = current
    current.sync()
    return () => {
      current.stop()
      polling.current = null
    }
  }, [application, getCoordinator, pollIntervalMs, maxPollIntervalMs])

  useEffect(() => {
    polling.current?.sync()
  }, [state.activeOperationIdByAnnouncementId, state.operationsById, state.requestsByOperationId])

  const publishAnnouncement = useCallback(async (announcementId: AnnouncementId) => {
    if (!mounted.current) return
    return getCoordinator().publish(announcementId)
  }, [getCoordinator])

  const retryPublication = useCallback(async (announcementId: AnnouncementId, operationId: OperationId) => {
    if (!mounted.current) return
    return getCoordinator().retryPublication(announcementId, operationId)
  }, [getCoordinator])

  const refreshPublicationStatuses = useCallback(async () => {
    if (!mounted.current) return
    return getCoordinator().refreshPublicationStatuses()
  }, [getCoordinator])

  const checkStatus = useCallback(async (announcementId: AnnouncementId) => {
    const operationId = selectActiveOperationId(application.getState(), announcementId)
    if (operationId === undefined) return
    return polling.current?.checkStatus(announcementId, operationId)
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
        requestFailure: operationId === undefined ? undefined : selectPublicationRequestFailure(state, operationId),
        canPublish: selectCanPublish(state, announcementId),
        canCheckStatus: selectCanCheckStatus(state, announcementId),
        canRetry: selectCanRetry(state, announcementId),
        canRetryPublication: selectCanRetryPublication(state, announcementId),
      }
    },
    getOperation: (operationId: OperationId) => selectOperation(state, operationId),
    publishAnnouncement,
    retryPublication,
    checkStatus,
    refreshPublicationStatuses,
    recovery: state.recovery,
    // The workspace passes this interface to application logic.
    application,
  }), [state, application, publishAnnouncement, retryPublication, checkStatus, refreshPublicationStatuses])
}
