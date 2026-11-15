import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAnnouncementMock } from '../../../mocks'
import { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'
import * as service from '../services/announcementService'
import AnnouncementWorkspace from './AnnouncementWorkspace'

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

test('follows both recovered operations across selection changes and ignores the previous mount response', async () => {
  const mock = createAnnouncementMock()
  mock.setScenario('success')
  const attemptIds = ['recovered-first', 'recovered-second'] as const
  const attempts = Promise.all([
    mock.publish('ann-101', attemptIds[0]),
    mock.publish('ann-102', attemptIds[1]),
  ])
  await advance(120)
  const recorded = await attempts
  const readList = service.listOperations
  let releasePreviousResponse!: () => void
  const holdResponse = new Promise<void>((resolve) => {
    releasePreviousResponse = resolve
  })
  const list = vi.spyOn(service, 'listOperations').mockImplementationOnce(async () => {
    const snapshots = await readList()
    await holdResponse
    return snapshots
  })
  const getStatus = vi.spyOn(service, 'getStatus')
  const publish = vi.spyOn(service, 'publish')
  const randomUUID = vi.spyOn(crypto, 'randomUUID')
  const previous = render(<AnnouncementWorkspace />, { reactStrictMode: true })
  await advance(100)
  expect(list).toHaveBeenCalledTimes(1)
  previous.unmount()

  render(<AnnouncementWorkspace />, { reactStrictMode: true })
  await advance(100)
  expect(list).toHaveBeenCalledTimes(2)
  await expect(list.mock.results[1].value).resolves.toEqual(recorded)
  const [first, second] = screen.getAllByRole('radio')
  const details = () => within(screen.getByRole('region', { name: 'Publication' }))
  expect(first).toHaveAccessibleDescription('Processing')
  expect(second).toHaveAccessibleDescription('Processing')
  expect(details().getByText(attemptIds[0])).toBeInTheDocument()

  fireEvent.click(second)
  expect(details().getByText(attemptIds[1])).toBeInTheDocument()
  fireEvent.click(details().getByRole('button', { name: 'Check status' }))
  expect(getStatus.mock.calls).toEqual([[attemptIds[1]]])
  await advance(100)
  await advance(1900)
  expect(getStatus.mock.calls).toEqual([[attemptIds[1]], [attemptIds[0]]])
  expect(second).toBeChecked()

  await advance(2300)
  expect(first).toHaveAccessibleDescription('Published')
  expect(second).toHaveAccessibleDescription('Published')
  expect(details().getByText(attemptIds[1])).toBeInTheDocument()
  expect(getStatus.mock.calls.filter(([id]) => id === attemptIds[0])).toHaveLength(2)
  expect(getStatus.mock.calls.filter(([id]) => id === attemptIds[1])).toHaveLength(3)

  const oldResponse = list.mock.results[0].value
  await act(async () => {
    releasePreviousResponse()
    await oldResponse
  })
  await expect(oldResponse).resolves.toEqual(recorded)
  expect(first).toHaveAccessibleDescription('Published')
  expect(second).toHaveAccessibleDescription('Published')
  fireEvent.click(first)
  expect(details().getByText(attemptIds[0])).toBeInTheDocument()

  const checks = getStatus.mock.calls.length
  await advance(10_000)
  expect(getStatus).toHaveBeenCalledTimes(checks)
  expect(publish).not.toHaveBeenCalled()
  expect(randomUUID).not.toHaveBeenCalled()
})

test('restores the latest rejection and keeps both rejected attempts when a new attempt starts', async () => {
  const mock = createAnnouncementMock()
  mock.setScenario('explicit-rejection')
  const announcementId = 'ann-103'
  const older = mock.publish(announcementId, 'older-rejection')
  await advance(120)
  const latest = mock.publish(announcementId, 'latest-rejection')
  await advance(120)
  const previousRejection = await older
  const recentRejection = await latest
  expect(recentRejection).toMatchObject({ status: 'rejected', reason: expect.any(String) })

  const publish = vi.spyOn(service, 'publish')
  const getStatus = vi.spyOn(service, 'getStatus')
  const { result } = renderHook(() => usePublicationWorkspace())
  await advance(100)
  const publication = () => result.current.getAnnouncementPublication(announcementId)
  expect(publication()).toMatchObject({
    operationId: recentRejection.operationId, operation: recentRejection,
    displayStatus: 'rejected', canRetry: true, canCheckStatus: false,
  })
  expect(publication().actions).toMatchObject([{ action: 'new-attempt', disabled: false }])
  expect(result.current.getOperation(previousRejection.operationId)).toEqual(previousRejection)
  await advance(10_000)
  expect(getStatus).not.toHaveBeenCalled()
  expect(publish).not.toHaveBeenCalled()

  mock.setScenario('success')
  await act(async () => {
    const request = result.current.publishAnnouncement(announcementId)
    await vi.advanceTimersByTimeAsync(120)
    await request
  })
  const newId = publication().operationId
  expect(newId).toBeTruthy()
  expect([previousRejection.operationId, recentRejection.operationId]).not.toContain(newId)
  expect(publication().operation).toMatchObject({ announcementId, operationId: newId, status: 'processing' })
  expect(result.current.getOperation(previousRejection.operationId)).toEqual(previousRejection)
  expect(result.current.getOperation(recentRejection.operationId)).toEqual(recentRejection)
  expect(publish.mock.calls).toEqual([[announcementId, newId]])
})

test('keeps publication blocked through consecutive recovery failures and preserves known operations on a later failure', async () => {
  const mock = createAnnouncementMock()
  mock.setScenario('status-check-failure')
  const initial = Promise.all([
    expect(mock.publish('ann-101', 'lost-first')).rejects.toMatchObject({ code: 'RESPONSE_LOST' }),
    expect(mock.publish('ann-102', 'lost-second')).rejects.toMatchObject({ code: 'RESPONSE_LOST' }),
  ])
  await advance(120)
  await initial
  const list = vi.spyOn(service, 'listOperations')
  const publish = vi.spyOn(service, 'publish')
  const { result } = renderHook(() => usePublicationWorkspace())
  const publication = (id: string) => result.current.getAnnouncementPublication(id)

  expect(result.current.recovery.status).toBe('loading')
  expect(publication('ann-103').canPublish).toBe(false)
  await expect(result.current.publishAnnouncement('ann-103')).resolves.toBeUndefined()
  await advance(100)
  expect(result.current.recovery).toMatchObject({ status: 'error', code: 'STATUS_UNAVAILABLE' })
  expect(publication('ann-103').canPublish).toBe(false)
  await expect(result.current.publishAnnouncement('ann-103')).resolves.toBeUndefined()
  expect(publish).not.toHaveBeenCalled()

  await act(async () => {
    const retry = expect(result.current.refreshPublicationStatuses()).rejects.toMatchObject({
      code: 'STATUS_UNAVAILABLE', operationId: 'lost-second',
    })
    await expect(result.current.refreshPublicationStatuses()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(100)
    await retry
  })
  expect(list).toHaveBeenCalledTimes(2)
  expect(result.current.recovery.status).toBe('error')
  expect(publication('ann-103').canPublish).toBe(false)

  await act(async () => {
    const retry = result.current.refreshPublicationStatuses()
    await vi.advanceTimersByTimeAsync(100)
    await retry
  })
  expect(list).toHaveBeenCalledTimes(3)
  expect(result.current.recovery.status).toBe('success')
  expect(publication('ann-103').canPublish).toBe(true)
  const first = publication('ann-101').operation
  const second = publication('ann-102').operation
  expect(first).toMatchObject({ operationId: 'lost-first', announcementId: 'ann-101', status: 'processing' })
  expect(second).toMatchObject({ operationId: 'lost-second', announcementId: 'ann-102', status: 'processing' })

  const newLoss = expect(mock.publish('ann-103', 'lost-third')).rejects.toMatchObject({ code: 'RESPONSE_LOST' })
  await advance(120)
  await newLoss
  await act(async () => {
    const retry = expect(result.current.refreshPublicationStatuses()).rejects.toMatchObject({
      code: 'STATUS_UNAVAILABLE', operationId: 'lost-third',
    })
    await vi.advanceTimersByTimeAsync(100)
    await retry
  })
  expect(result.current.recovery).toMatchObject({ status: 'error', code: 'STATUS_UNAVAILABLE' })
  expect(publication('ann-101').operation).toEqual(first)
  expect(publication('ann-102').operation).toEqual(second)
  expect(publication('ann-103').canPublish).toBe(false)
  expect(publish).not.toHaveBeenCalled()
})
