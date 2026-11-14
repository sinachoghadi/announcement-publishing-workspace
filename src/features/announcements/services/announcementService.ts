import { createAnnouncementMock, type IAnnouncementService } from '../../../mocks'

type AnnouncementService = Pick<
  IAnnouncementService,
  'getAnnouncements' | 'publish' | 'getStatus' | 'listOperations'
>

let sharedClient: IAnnouncementService | undefined

export function createAnnouncementService(client?: IAnnouncementService): AnnouncementService {
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
      return getClient().getStatus(operationId)
    },
    async listOperations() {
      return getClient().listOperations()
    },
  }
}

export const { getAnnouncements, publish, getStatus, listOperations } = createAnnouncementService()
