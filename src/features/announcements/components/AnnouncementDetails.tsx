import { useId, type ReactNode } from 'react'
import type { IAnnouncement, PublicationOperation } from '../../../mocks'
import type { PublicationDisplayStatus } from '../state/publicationSelectors'
import type { OperationId, PublicationRequestState } from '../state/publicationTypes'

const statusMessages = {
  'not-published': 'Not published yet',
  processing: 'Publication is processing',
  published: 'Published',
  rejected: 'Publication rejected',
  unconfirmed: 'Publication outcome unconfirmed',
  'request-error': 'Publication request error',
} satisfies Record<PublicationDisplayStatus, string>

const publicationDate = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

type AnnouncementDetailsProps = {
  announcement?: IAnnouncement
  publication?: {
    operationId: OperationId | undefined
    operation: PublicationOperation | undefined
    displayStatus: PublicationDisplayStatus
    request: PublicationRequestState | undefined
    requestError: string | undefined
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
          <p role="status">
            {publication.request?.status === 'publishing'
              ? 'Submitting publication…'
              : statusMessages[publication.displayStatus]}
            {publication.request?.status === 'checking' && ' · Checking status…'}
            {publication.requestError && ` · ${publication.requestError}`}
          </p>
          {publication.operationId !== undefined && (
            <dl className="publication-metadata">
              <dt>Operation ID</dt>
              <dd>{publication.operationId}</dd>
              {operation?.status === 'published' && (
                <>
                  <dt>Publication ID</dt>
                  <dd>{operation.publicationId}</dd>
                  <dt>Published at</dt>
                  <dd><time dateTime={operation.publishedAt}>{publicationDate.format(new Date(operation.publishedAt))}</time></dd>
                </>
              )}
              {operation?.status === 'rejected' && (
                <>
                  <dt>Rejection reason</dt>
                  <dd>{operation.reason}</dd>
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
