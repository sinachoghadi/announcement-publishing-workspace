import { useId, type ReactNode } from 'react'
import type { IAnnouncement } from '../../../mocks'
import type { OperationId } from '../state/publicationTypes'
import PublicationStatus, { type PublicationStatusProps } from './PublicationStatus'

type AnnouncementDetailsProps = {
  announcement?: IAnnouncement
  publication?: PublicationStatusProps & {
    operationId: OperationId | undefined
  }
  children?: ReactNode
}

export default function AnnouncementDetails({ announcement, publication, children }: AnnouncementDetailsProps) {
  const publicationHeadingId = useId()
  const operation = publication?.operation

  return (
    <section className="workspace-panel announcement-details" aria-labelledby="details-heading">
      <h2 id="details-heading">{announcement?.title ?? 'Announcement details'}</h2>
      {announcement ? (
        <p className="announcement-body">{announcement.body}</p>
      ) : (
        <p>Select an announcement to view its details.</p>
      )}
      {announcement && publication && (
        <section className="publication-details" aria-labelledby={publicationHeadingId}>
          <h3 id={publicationHeadingId}>Publication</h3>
          <PublicationStatus {...publication} />
          {publication.operationId !== undefined && (
            <dl className="publication-metadata">
              <dt>Operation ID</dt>
              <dd>{publication.operationId}</dd>
              {operation?.status === 'published' && (
                <>
                  <dt>Publication ID</dt>
                  <dd>{operation.publicationId}</dd>
                </>
              )}
            </dl>
          )}
          {children}
        </section>
      )}
    </section>
  )
}
