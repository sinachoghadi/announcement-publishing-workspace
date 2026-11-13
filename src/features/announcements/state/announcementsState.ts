import type { IAnnouncement } from '../../../mocks'

export type AnnouncementsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; announcements: IAnnouncement[] }
