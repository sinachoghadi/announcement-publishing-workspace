import { createAnnouncementMock, type IAnnouncementService } from '../../../mocks'

type AnnouncementService = Pick<
  IAnnouncementService,
  'getAnnouncements' | 'publish' | 'getStatus' | 'listOperations'
>

let sharedClient: IAnnouncementService | undefined

export function createAnnouncementService(client?: IAnnouncementService): AnnouncementService {
  const statusReads = new Map<string, ReturnType<IAnnouncementService['getStatus']>>()

  function getClient(): IAnnouncementService {
    return client ?? (sharedClient ??= createAnnouncementMock())
  }

  return {
    async getAnnouncements() {
      return getClient().getAnnouncements()
    },
    async publish(announcementId, operationId) {
      return getClient().publish(announcementId, operationId)
    },
    async getStatus(operationId) {
      // A status request can outlive the workspace that started it.
      const pending = statusReads.get(operationId)
      if (pending) return pending
      const request = getClient().getStatus(operationId)
      statusReads.set(operationId, request)
      try {
        return await request
      } finally {
        statusReads.delete(operationId)
      }
    },
    async listOperations() {
      return getClient().listOperations()
    },
  }
}

export const { getAnnouncements, publish, getStatus, listOperations } = createAnnouncementService()
