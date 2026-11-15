import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAnnouncementMock } from '../../../mocks'
import * as service from '../services/announcementService'
import { usePublicationWorkspace } from './usePublicationWorkspace'

const announcementId = 'ann-101'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function advance(ms: number) {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

test('cleans up both polling timers on effect replacement and unmount in Strict Mode', async () => {
  const mock = createAnnouncementMock()
  const recorded = Promise.all([
    mock.publish(announcementId, 'first'),
    mock.publish('ann-102', 'second'),
  ])
  await advance(120)
  await recorded
  const getStatus = vi.spyOn(service, 'getStatus')
  const list = vi.spyOn(service, 'listOperations')
  const workspace = renderHook(
    ({ interval }) => usePublicationWorkspace({ pollIntervalMs: interval }),
    { initialProps: { interval: 2000 }, reactStrictMode: true },
  )
  await advance(100)
  expect(list).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(2)

  workspace.rerender({ interval: 4000 })
  expect(vi.getTimerCount()).toBe(2)
  await advance(2000)
  expect(getStatus).not.toHaveBeenCalled()

  workspace.unmount()
  expect(vi.getTimerCount()).toBe(0)
  await advance(10_000)
  expect(getStatus).not.toHaveBeenCalled()
})

test.each(['publish', 'retry'] as const)('ignores a late %s result after unmount while the new workspace recovers it', async (kind) => {
  const mock = createAnnouncementMock()
  mock.setScenario(kind === 'publish' ? 'slow-response' : 'lost-response')
  const publish = vi.spyOn(service, 'publish')
  const previous = renderHook(() => usePublicationWorkspace())
  await advance(100)

  if (kind === 'retry') {
    await act(async () => {
      const lost = expect(previous.result.current.publishAnnouncement(announcementId)).rejects.toMatchObject({
        code: 'RESPONSE_LOST',
      })
      await vi.advanceTimersByTimeAsync(120)
      await lost
    })
  }

  let pending!: ReturnType<typeof previous.result.current.publishAnnouncement>
  act(() => {
    pending = kind === 'publish'
      ? previous.result.current.publishAnnouncement(announcementId)
      : previous.result.current.retryPublication(announcementId, publish.mock.calls[0][1])
  })
  const [, operationId] = publish.mock.calls[0]
  expect(publish).toHaveBeenLastCalledWith(announcementId, operationId)
  const oldStore = previous.result.current.application
  const stateAtUnmount = oldStore.getState()
  expect(previous.result.current.getAnnouncementPublication(announcementId).request?.status).toBe('publishing')
  previous.unmount()

  const refreshed = renderHook(() => usePublicationWorkspace())
  await advance(100)
  expect(refreshed.result.current.getOperation(operationId)).toMatchObject({
    announcementId, operationId, status: 'processing',
  })
  await advance(5000)
  await expect(pending).resolves.toMatchObject({ operationId, status: 'processing', version: 1 })
  expect(oldStore.getState()).toBe(stateAtUnmount)
  expect(refreshed.result.current.getOperation(operationId)).toMatchObject({ operationId, status: 'published', version: 2 })
  expect(publish).toHaveBeenCalledTimes(kind === 'publish' ? 1 : 2)
})

test('handles an automatic status rejection after unmount without dispatching or rescheduling', async () => {
  createAnnouncementMock().setScenario('status-check-failure')
  const getStatus = vi.spyOn(service, 'getStatus')
  const workspace = renderHook(() => usePublicationWorkspace())
  await advance(100)
  await act(async () => {
    const lost = expect(workspace.result.current.publishAnnouncement(announcementId)).rejects.toMatchObject({
      code: 'RESPONSE_LOST',
    })
    await vi.advanceTimersByTimeAsync(120)
    await lost
  })

  await advance(2000)
  expect(getStatus).toHaveBeenCalledTimes(1)
  const store = workspace.result.current.application
  const stateAtUnmount = store.getState()
  expect(workspace.result.current.getAnnouncementPublication(announcementId).request?.status).toBe('checking')
  workspace.unmount()

  // The Mock still delivers its response. The automatic poll is responsible for catching the error.
  await advance(100)
  await expect(getStatus.mock.results[0].value).rejects.toMatchObject({ code: 'STATUS_UNAVAILABLE' })
  expect(store.getState()).toBe(stateAtUnmount)
  expect(vi.getTimerCount()).toBe(0)
  await advance(10_000)
  expect(getStatus).toHaveBeenCalledTimes(1)
})
