import { selectActiveOperationId, selectOperation } from '../state/publicationSelectors'
import type { AnnouncementId, OperationId, PublicationState } from '../state/publicationTypes'
import type { createPublicationCoordinator } from './publicationCoordinator'

type CheckStatus = ReturnType<typeof createPublicationCoordinator>['checkStatus']

type Poll = {
  announcementId: AnnouncementId
  delay: number
  timer?: ReturnType<typeof setTimeout>
}

export function createPublicationPolling(
  getState: () => PublicationState,
  requestStatus: CheckStatus,
  intervalMs: number,
  maxIntervalMs: number,
) {
  const polls = new Map<OperationId, Poll>()
  const inFlight = new Set<OperationId>()
  let stopped = false

  function shouldPoll(state: PublicationState, announcementId: AnnouncementId, operationId: OperationId) {
    return selectActiveOperationId(state, announcementId) === operationId &&
      selectOperation(state, operationId)?.status === 'processing'
  }

  function clearTimer(poll: Poll) {
    clearTimeout(poll.timer)
    poll.timer = undefined
  }

  function schedule(operationId: OperationId, poll: Poll) {
    if (poll.timer !== undefined || inFlight.has(operationId)) return

    poll.timer = setTimeout(() => {
      poll.timer = undefined
      if (!shouldPoll(getState(), poll.announcementId, operationId)) {
        polls.delete(operationId)
        return
      }

      void checkStatus(poll.announcementId, operationId).catch(() => {
        // The coordinator records the failure. The next poll uses the longer delay.
      })
    }, poll.delay)
  }

  async function checkStatus(announcementId: AnnouncementId, operationId: OperationId) {
    if (stopped || selectActiveOperationId(getState(), announcementId) !== operationId || inFlight.has(operationId)) return

    const poll = polls.get(operationId)
    if (poll) clearTimer(poll)
    inFlight.add(operationId)
    try {
      const operation = await requestStatus(announcementId, operationId)
      if (poll && operation !== undefined) poll.delay = intervalMs
      return operation
    } catch (error) {
      if (poll) poll.delay = Math.min(poll.delay * 2, maxIntervalMs)
      throw error
    } finally {
      inFlight.delete(operationId)
      sync()
    }
  }

  function sync() {
    if (stopped) return
    const state = getState()
    for (const [operationId, poll] of polls) {
      if (!shouldPoll(state, poll.announcementId, operationId)) {
        clearTimer(poll)
        polls.delete(operationId)
      }
    }

    for (const [announcementId, operationId] of state.activeOperationIdByAnnouncementId) {
      if (!shouldPoll(state, announcementId, operationId)) continue
      let poll = polls.get(operationId)
      if (!poll) {
        poll = { announcementId, delay: intervalMs }
        polls.set(operationId, poll)
      }
      schedule(operationId, poll)
    }
  }

  return {
    sync,
    checkStatus,
    stop() {
      stopped = true
      for (const poll of polls.values()) clearTimer(poll)
      polls.clear()
    },
  }
}
