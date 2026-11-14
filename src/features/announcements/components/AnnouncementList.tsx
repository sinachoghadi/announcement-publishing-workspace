import { useId } from 'react'
import type { IAnnouncement } from '../../../mocks'
import type { PublicationDisplayStatus } from '../state/publicationSelectors'
import type { PublicationRequestState } from '../state/publicationTypes'

const statusLabels = {
  'not-published': 'Not Published',
  processing: 'Processing',
  published: 'Published',
  rejected: 'Rejected',
  unconfirmed: 'Unconfirmed',
  'request-error': 'Request Error',
} satisfies Record<PublicationDisplayStatus, string>

type AnnouncementListProps = {
  announcements: readonly IAnnouncement[]
  selectedId: IAnnouncement['id'] | undefined
  onSelect: (id: IAnnouncement['id']) => void
  getPublication: (id: IAnnouncement['id']) => {
    displayStatus: PublicationDisplayStatus
    request: PublicationRequestState | undefined
  }
}

export default function AnnouncementList({
  announcements,
  selectedId,
  onSelect,
  getPublication,
}: AnnouncementListProps) {
  const groupId = useId()

  return (
    <section className="workspace-panel" aria-labelledby={groupId}>
      <h2 id={groupId}>Announcements</h2>
      {announcements.length === 0 && <p>No announcements available.</p>}
      <ul className="announcement-options">
        {announcements.map(({ id, title }) => {
          const { displayStatus, request } = getPublication(id)
          const status = request?.status === 'publishing' ? 'submitting' : displayStatus
          const titleId = `${groupId}-${id}-title`
          const statusId = `${groupId}-${id}-status`

          return (
            <li key={id}>
              <label className="announcement-option">
                <input
                  type="radio"
                  name={groupId}
                  checked={id === selectedId}
                  aria-labelledby={titleId}
                  aria-describedby={statusId}
                  onChange={() => onSelect(id)}
                />
                <span className="announcement-option-content">
                  <span id={titleId}>{title}</span>
                  <span id={statusId} className="announcement-status" data-status={status}>
                    {status === 'submitting' ? 'Submitting…' : statusLabels[status]}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
