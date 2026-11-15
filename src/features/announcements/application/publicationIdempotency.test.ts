import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AnnouncementMockError, createAnnouncementMock } from '../../../mocks'
import { createAnnouncementService } from '../services/announcementService'
import { publicationReducer, type PublicationAction } from '../state/publicationReducer'
import { selectPublicationDisplayStatus, selectPublicationRequestFailure } from '../state/publicationSelectors'
import { initialPublicationState } from '../state/publicationTypes'
import { createPublicationCoordinator } from './publicationCoordinator'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('replays the same service attempt without restarting it or creating another operation', async () => {
  const mock = createAnnouncementMock()
  mock.setScenario('success')
  const announcementId = 'ann-101'
  const operationId = 'replayed-operation'
  const initial = mock.publish(announcementId, operationId)
  await vi.advanceTimersByTimeAsync(1000)
  const processing = await initial
  expect(processing).toMatchObject({ announcementId, operationId, status: 'processing', version: 1 })

  const repeats = Promise.all([
    mock.publish(announcementId, operationId),
    mock.publish(announcementId, operationId),
  ])
  await vi.advanceTimersByTimeAsync(1500)
  await expect(repeats).resolves.toEqual([processing, processing])

  // At the original completion time, a restarted attempt would still be processing.
  const status = mock.getStatus(operationId)
  await vi.advanceTimersByTimeAsync(100)
  const confirmation = await status
  expect(confirmation).toMatchObject({ announcementId, operationId, status: 'published', version: 2 })

  const terminalReplay = mock.publish(announcementId, operationId)
  const recorded = mock.listOperations()
  await vi.advanceTimersByTimeAsync(120)
  await expect(terminalReplay).resolves.toEqual(confirmation)
  await expect(recorded).resolves.toEqual([confirmation])
})

test('reports a service ID conflict without retrying or disturbing the original attempt', async () => {
  const mock = createAnnouncementMock()
  const adapter = createAnnouncementService(mock)
  const publish = vi.spyOn(adapter, 'publish')
  const owner = 'ann-101'
  const otherAnnouncement = 'ann-102'
  const operationId = crypto.randomUUID()
  let state = initialPublicationState
  const coordinator = createPublicationCoordinator(adapter, {
    getState: () => state,
    dispatch(action: PublicationAction) {
      state = publicationReducer(state, action)
      return state
    },
  })
  const recovery = coordinator.refreshPublicationStatuses()
  await vi.advanceTimersByTimeAsync(100)
  await recovery

  // The service learns about a publication after this workspace has recovered its list.
  const original = mock.publish(owner, operationId)
  await vi.advanceTimersByTimeAsync(120)
  const originalSnapshot = await original
  const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId)

  const attempt = coordinator.publish(otherAnnouncement)
  await expect(attempt).rejects.toBeInstanceOf(AnnouncementMockError)
  await expect(attempt).rejects.toMatchObject({
    code: 'OPERATION_ID_CONFLICT', operationId, announcementId: otherAnnouncement, requestId: expect.any(String),
  })
  expect(selectPublicationDisplayStatus(state, otherAnnouncement)).toBe('request-error')
  expect(selectPublicationRequestFailure(state, operationId)).toMatchObject({
    code: 'OPERATION_ID_CONFLICT', status: 'error',
    serviceRequest: { operationId, announcementId: otherAnnouncement, requestId: expect.any(String) },
  })
  await expect(coordinator.retryPublication(otherAnnouncement, operationId)).resolves.toBeUndefined()
  await expect(coordinator.publish(otherAnnouncement)).resolves.toBeUndefined()
  expect(randomUUID).toHaveBeenCalledTimes(1)
  expect(publish.mock.calls).toEqual([[otherAnnouncement, operationId]])

  const recorded = mock.listOperations()
  await vi.advanceTimersByTimeAsync(100)
  await expect(recorded).resolves.toEqual([originalSnapshot])

  await vi.advanceTimersByTimeAsync(2500)
  const refreshed = coordinator.refreshPublicationStatuses()
  await vi.advanceTimersByTimeAsync(100)
  await expect(refreshed).resolves.toMatchObject([{ announcementId: owner, operationId, status: 'published' }])
  expect(selectPublicationDisplayStatus(state, owner)).toBe('published')
  expect(selectPublicationDisplayStatus(state, otherAnnouncement)).toBe('not-published')
  await expect(coordinator.publish(owner)).resolves.toBeUndefined()
  expect(randomUUID).toHaveBeenCalledTimes(1)
  expect(publish.mock.calls).toEqual([[otherAnnouncement, operationId]])
})
