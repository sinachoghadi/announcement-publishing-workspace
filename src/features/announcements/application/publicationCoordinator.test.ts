// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { AnnouncementMockError, type IAnnouncementService, type PublicationOperation } from '../../../mocks'
import { publicationReducer, type PublicationAction } from '../state/publicationReducer'
import {
  selectOperation, selectPublicationDisplayStatus, selectPublicationRequestFailure,
} from '../state/publicationSelectors'
import { initialPublicationState } from '../state/publicationTypes'
import { createPublicationCoordinator } from './publicationCoordinator'

const announcementId = 'ann-101'
const createdAt = '2026-01-01T12:00:00Z'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

async function startPublication() {
  const publishResponse = deferred<PublicationOperation>()
  const statusResponse = deferred<PublicationOperation>()
  const publish = vi.fn<IAnnouncementService['publish']>(() => publishResponse.promise)
  const getStatus = vi.fn<IAnnouncementService['getStatus']>(() => statusResponse.promise)
  let state = initialPublicationState
  const getState = () => state
  const coordinator = createPublicationCoordinator({ publish, getStatus, listOperations: async () => [] }, {
    getState,
    dispatch(action: PublicationAction) {
      state = publicationReducer(state, action)
      return state
    },
  })
  await coordinator.refreshPublicationStatuses()
  const publishRequest = coordinator.publish(announcementId)
  const [, operationId] = publish.mock.calls[0]
  const processing = { operationId, announcementId, createdAt, status: 'processing', version: 1 } as const
  return { coordinator, getStatus, getState, operationId, processing, publishRequest, publishResponse, statusResponse }
}

test.each(['publish error first', 'status confirmation first'])(
  'keeps publication confirmed when responses arrive: %s',
  async (order) => {
    const { coordinator, getState, operationId, processing, publishRequest, publishResponse, statusResponse } =
      await startPublication()
    const published = {
      ...processing, status: 'published', version: 2,
      publicationId: 'publication-101', publishedAt: '2026-01-01T12:00:03Z',
    } as const satisfies PublicationOperation
    const lost = new AnnouncementMockError('RESPONSE_LOST', 'service-publish', operationId, announcementId)
    const publishFailure = expect(publishRequest).rejects.toBe(lost)
    const check = coordinator.checkStatus(announcementId, operationId)

    if (order === 'publish error first') {
      publishResponse.reject(lost)
      await publishFailure
      expect(selectPublicationRequestFailure(getState(), operationId)?.code).toBe('RESPONSE_LOST')
    }

    statusResponse.resolve(published)
    await check
    expect(selectOperation(getState(), operationId)).toEqual(published)

    if (order === 'status confirmation first') {
      publishResponse.reject(lost)
      await publishFailure
    }

    expect(selectOperation(getState(), operationId)).toEqual(published)
    expect(selectPublicationDisplayStatus(getState(), announcementId)).toBe('published')
    expect(selectPublicationRequestFailure(getState(), operationId)).toBeUndefined()
  },
)

test.each([
  ['before the first snapshot', false],
  ['after a processing snapshot', true],
] as const)('preserves a newer status error %s when an older publish succeeds', async (_, alreadyProcessing) => {
  const { coordinator, getStatus, getState, operationId, processing, publishRequest, publishResponse, statusResponse } =
    await startPublication()
  if (alreadyProcessing) {
    getStatus.mockResolvedValueOnce(processing)
    await coordinator.checkStatus(announcementId, operationId)
  }

  const check = coordinator.checkStatus(announcementId, operationId)
  const unavailable = new AnnouncementMockError('STATUS_UNAVAILABLE', 'service-status', operationId, announcementId)
  const statusFailure = expect(check).rejects.toBe(unavailable)
  statusResponse.reject(unavailable)
  await statusFailure
  const failure = selectPublicationRequestFailure(getState(), operationId)
  expect(failure).toMatchObject({ code: 'STATUS_UNAVAILABLE', serviceRequest: { operationId, announcementId } })

  publishResponse.resolve({ ...processing })
  await publishRequest
  expect(selectOperation(getState(), operationId)).toEqual(processing)
  expect(selectPublicationRequestFailure(getState(), operationId)).toEqual(failure)

  getStatus.mockResolvedValueOnce(processing)
  await coordinator.checkStatus(announcementId, operationId)
  expect(selectPublicationRequestFailure(getState(), operationId)).toBeUndefined()
})
