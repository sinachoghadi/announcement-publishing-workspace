// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { AnnouncementMockError, type IAnnouncementService, type PublicationOperation } from '../../../mocks'
import { createAnnouncementService } from './announcementService'

test('shares an in-flight status read per operation and releases it after success or failure', async () => {
  const snapshot = {
    operationId: 'first', announcementId: 'ann-101', createdAt: '2026-01-01T12:00:00Z',
    status: 'processing', version: 1,
  } as const satisfies PublicationOperation
  let finishFirst!: (operation: PublicationOperation) => void
  let rejectSecond!: (error: unknown) => void
  const firstRead = new Promise<PublicationOperation>((resolve) => { finishFirst = resolve })
  const secondRead = new Promise<PublicationOperation>((_, reject) => { rejectSecond = reject })
  const getStatus = vi.fn<IAnnouncementService['getStatus']>()
    .mockReturnValueOnce(firstRead)
    .mockReturnValueOnce(secondRead)
    .mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce(null)
  const adapter = createAnnouncementService({
    getStatus,
    getAnnouncements: async () => [],
    listOperations: async () => [],
    publish: async () => snapshot,
    getScenario: () => 'success',
    setScenario: () => {},
    reset: () => {},
  })

  const first = adapter.getStatus('first')
  const second = adapter.getStatus('second')
  // A remounted workspace can request the same status before the old read finishes.
  const remountedFirst = adapter.getStatus('first')
  const remountedSecond = adapter.getStatus('second')
  const unavailable = new AnnouncementMockError('STATUS_UNAVAILABLE', 'request-2', 'second', 'ann-102')
  const failures = Promise.all([expect(second).rejects.toBe(unavailable), expect(remountedSecond).rejects.toBe(unavailable)])
  finishFirst(snapshot)
  rejectSecond(unavailable)
  await expect(Promise.all([first, remountedFirst])).resolves.toEqual([snapshot, snapshot])
  await failures
  expect(getStatus.mock.calls).toEqual([['first'], ['second']])

  await expect(adapter.getStatus('first')).resolves.toEqual(snapshot)
  await expect(adapter.getStatus('second')).resolves.toBeNull()
  expect(getStatus.mock.calls).toEqual([['first'], ['second'], ['first'], ['second']])
})
