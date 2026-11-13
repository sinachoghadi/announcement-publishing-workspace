import type { IAnnouncement, PublicationOperation } from '../../../mocks'

type AnnouncementId = IAnnouncement['id']
type OperationId = PublicationOperation['operationId']

export type PublicationRequestState =
  | { status: 'idle' }
  | { status: 'publishing'; requestId: string }
  | { status: 'checking'; requestId: string }
  | { status: 'error'; message: string }
  | { status: 'unconfirmed'; message: string }

export type PublicationState = {
  // Set when an attempt starts, even before its first service snapshot arrives.
  readonly activeOperationIdByAnnouncementId: ReadonlyMap<AnnouncementId, OperationId>
  // Keep the latest accepted service snapshot for each attempt, including past rejections.
  readonly operationsById: ReadonlyMap<OperationId, PublicationOperation>
  // Track the latest request per operation. Request IDs correlate pending responses independently of snapshot versions.
  readonly requestsByOperationId: ReadonlyMap<OperationId, PublicationRequestState>
}

export const initialPublicationState: PublicationState = {
  activeOperationIdByAnnouncementId: new Map(),
  operationsById: new Map(),
  requestsByOperationId: new Map(),
}
