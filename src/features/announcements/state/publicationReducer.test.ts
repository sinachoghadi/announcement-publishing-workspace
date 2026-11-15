// @vitest-environment node
import { expect, test } from 'vitest'
import type { PublicationOperation } from '../../../mocks'
import { publicationReducer, type PublicationAction } from './publicationReducer'
import {
  selectActiveOperationId,
  selectOperation,
  selectPublicationDisplayStatus,
  selectPublicationRequest,
} from './publicationSelectors'
import { initialPublicationState } from './publicationTypes'

const first = { announcementId: 'ann-101', operationId: 'first-attempt' }
const second = { announcementId: 'ann-102', operationId: 'second-attempt' }
const processing = {
  ...first, createdAt: '2026-01-01T12:00:00Z', status: 'processing', version: 1,
} as const satisfies PublicationOperation
const published = {
  ...processing, status: 'published', version: 2,
  publicationId: 'publication-101', publishedAt: '2026-01-01T12:00:03Z',
} as const satisfies PublicationOperation
const rejected = {
  ...processing, status: 'rejected', version: 2, reason: 'The service declined this announcement.',
} as const satisfies PublicationOperation

function reduce(...actions: PublicationAction[]) {
  return actions.reduce(publicationReducer, initialPublicationState)
}

test.each([published, rejected])('keeps $status metadata when an older or duplicate snapshot arrives', (terminal) => {
  const state = reduce(
    { type: 'operationStarted', ...first },
    { type: 'snapshotReceived', operation: processing },
    { type: 'snapshotReceived', operation: terminal },
  )
  const deliveries = [
    (operation) => ({ type: 'snapshotReceived', operation }),
    (operation) => ({ type: 'publishSucceeded', ...first, requestId: 'old-publish', operation }),
    (operation) => ({ type: 'statusCheckSucceeded', ...first, requestId: 'old-status', operation }),
  ] satisfies Array<(operation: PublicationOperation) => PublicationAction>

  for (const deliver of deliveries) {
    expect(publicationReducer(state, deliver({ ...terminal }))).toBe(state)
    const next = publicationReducer(state, deliver(processing))
    expect(next).toBe(state)
    expect(selectOperation(next, first.operationId)).toEqual(terminal)
    expect(selectPublicationDisplayStatus(next, first.announcementId)).toBe(terminal.status)
  }
})

test('rejects mismatched response identities and settles only the matching request', () => {
  const firstRequest = { ...first, requestId: 'check-first' }
  const secondRequest = { ...second, requestId: 'check-second' }
  const secondSnapshot = { ...published, ...second, publicationId: 'publication-102' }
  const state = reduce(
    { type: 'operationStarted', ...first },
    { type: 'operationStarted', ...second },
    { type: 'snapshotReceived', operation: processing },
    { type: 'statusCheckStarted', ...firstRequest },
    { type: 'statusCheckStarted', ...secondRequest },
  )

  expect(publicationReducer(state, {
    type: 'statusCheckSucceeded', ...firstRequest, operation: secondSnapshot,
  })).toBe(state)
  expect(publicationReducer(state, {
    type: 'statusCheckSucceeded', ...firstRequest, announcementId: second.announcementId, operation: published,
  })).toBe(state)
  const wrongOwner = { ...published, announcementId: second.announcementId }
  expect(publicationReducer(state, {
    type: 'publishSucceeded', ...firstRequest, operation: wrongOwner,
  })).toBe(state)
  expect(publicationReducer(state, { type: 'snapshotReceived', operation: wrongOwner })).toBe(state)

  const next = publicationReducer(state, {
    type: 'statusCheckSucceeded', ...secondRequest, operation: secondSnapshot,
  })
  expect(selectOperation(next, second.operationId)).toEqual(secondSnapshot)
  expect(selectOperation(next, first.operationId)).toEqual(processing)
  expect(selectPublicationRequest(next, first.operationId)).toEqual({
    status: 'checking', requestId: firstRequest.requestId, previousFailure: undefined,
  })
  expect(selectActiveOperationId(next, second.announcementId)).toBe(second.operationId)
})

test('merges a delayed recovery without replacing confirmed snapshots or a newer active attempt', () => {
  const older = { ...rejected, announcementId: 'ann-103', operationId: 'older-attempt' }
  const newer = { ...older, operationId: 'newer-attempt', createdAt: '2026-01-01T12:01:00Z' }
  const independent = { ...processing, ...second }
  const state = reduce(
    { type: 'operationStarted', ...first },
    { type: 'snapshotReceived', operation: processing },
    { type: 'operationStarted', ...older },
    { type: 'snapshotReceived', operation: older },
    { type: 'operationStarted', ...newer },
    { type: 'recoveryStarted', requestId: 'list-current' },
    { type: 'snapshotReceived', operation: published },
  )

  const next = publicationReducer(state, {
    type: 'recoverySucceeded', requestId: 'list-current', operations: [older, processing, independent],
  })
  expect(selectOperation(next, first.operationId)).toEqual(published)
  expect(selectActiveOperationId(next, older.announcementId)).toBe(newer.operationId)
  expect(selectOperation(next, older.operationId)).toEqual(older)
  expect(selectActiveOperationId(next, second.announcementId)).toBe(second.operationId)
  expect(selectOperation(next, second.operationId)).toEqual(independent)

  const replay = publicationReducer(next, { type: 'recoveryStarted', requestId: 'list-replay' })
  const duplicate = publicationReducer(replay, {
    type: 'recoverySucceeded', requestId: 'list-replay', operations: [{ ...published }, { ...older }, { ...independent }],
  })
  expect(duplicate.operationsById).toBe(next.operationsById)
  expect(duplicate.activeOperationIdByAnnouncementId).toBe(next.activeOperationIdByAnnouncementId)
  expect(duplicate.recovery.status).toBe('success')
  expect(publicationReducer(duplicate, {
    type: 'recoveryFailed', requestId: 'list-current', message: 'An earlier list request failed.',
  })).toBe(duplicate)
  expect(publicationReducer(duplicate, {
    type: 'recoverySucceeded', requestId: 'list-current', operations: [processing],
  })).toBe(duplicate)
})

test('keeps a newer status error when a recovery response carries an older processing snapshot', () => {
  const check = { ...first, requestId: 'check-after-list' }
  const state = reduce(
    { type: 'operationStarted', ...first },
    { type: 'snapshotReceived', operation: processing },
    { type: 'recoveryStarted', requestId: 'list-before-check' },
    { type: 'statusCheckStarted', ...check },
    {
      type: 'statusCheckFailed', ...check, code: 'STATUS_UNAVAILABLE',
      outcome: 'unconfirmed', message: 'The status check failed.',
    },
  )
  const next = publicationReducer(state, {
    type: 'recoverySucceeded', requestId: 'list-before-check', operations: [processing],
  })
  expect(next.recovery.status).toBe('success')
  expect(selectOperation(next, first.operationId)).toBe(processing)
  expect(selectPublicationRequest(next, first.operationId)).toEqual({
    code: 'STATUS_UNAVAILABLE', status: 'error', message: 'The status check failed.',
  })

  const retry = publicationReducer(next, { type: 'recoveryStarted', requestId: 'list-after-check' })
  const fresh = publicationReducer(retry, {
    type: 'recoverySucceeded', requestId: 'list-after-check', operations: [processing],
  })
  expect(selectPublicationRequest(fresh, first.operationId)).toBeUndefined()
})
