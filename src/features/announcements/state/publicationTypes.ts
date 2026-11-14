import type { AnnouncementErrorCode, AnnouncementMockError, IAnnouncement, PublicationOperation } from '../../../mocks'

export type AnnouncementId = IAnnouncement['id']
export type OperationId = PublicationOperation['operationId']

export type PublicationRequestFailure = {
  status: 'error' | 'unconfirmed'
  message: string
  code?: AnnouncementErrorCode
  serviceRequest?: Pick<AnnouncementMockError, 'requestId' | 'operationId' | 'announcementId'>
}

export type PublicationRequestState =
  | { status: 'idle' }
  | { status: 'publishing'; requestId: string; previousFailure?: PublicationRequestFailure }
  | { status: 'checking'; requestId: string; previousFailure?: PublicationRequestFailure }
  | PublicationRequestFailure

export type PublicationRecoveryState =
  | { status: 'idle' }
  | { status: 'loading'; requestId: string }
  | { status: 'error'; message: string; code?: AnnouncementErrorCode }

export type PublicationState = {
  // Set when an attempt starts, even before its first service snapshot arrives.
  readonly activeOperationIdByAnnouncementId: ReadonlyMap<AnnouncementId, OperationId>
  // Keep the latest accepted service snapshot for each attempt, including past rejections.
  readonly operationsById: ReadonlyMap<OperationId, PublicationOperation>
  // Track the latest request per operation. Request IDs correlate pending responses independently of snapshot versions.
  readonly requestsByOperationId: ReadonlyMap<OperationId, PublicationRequestState>
  readonly recovery: PublicationRecoveryState
  readonly hasRestoredPublications: boolean
}

export const initialPublicationState: PublicationState = {
  activeOperationIdByAnnouncementId: new Map(),
  operationsById: new Map(),
  requestsByOperationId: new Map(),
  recovery: { status: 'idle' },
  hasRestoredPublications: false,
}
