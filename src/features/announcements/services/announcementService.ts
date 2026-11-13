import { createAnnouncementMock, type IAnnouncement } from '../../../mocks'

let client: ReturnType<typeof createAnnouncementMock> | undefined

export async function getAnnouncements(): Promise<IAnnouncement[]> {
  client ??= createAnnouncementMock()
  return client.getAnnouncements()
}
