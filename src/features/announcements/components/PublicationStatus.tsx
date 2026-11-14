import type { PublicationOperation } from '../../../mocks'
import type { PublicationDisplayStatus } from '../state/publicationSelectors'
import type { PublicationRequestFailure, PublicationRequestState } from '../state/publicationTypes'

const statuses = {
  'not-published': { label: 'Not Published', icon: '○', description: 'This announcement has not been submitted.' },
  processing: { label: 'Processing', icon: '◷', description: 'The service has accepted this operation. Publication is still processing.' },
  published: { label: 'Published', icon: '✓', description: 'The service has confirmed publication.' },
  rejected: { label: 'Rejected', icon: '×', description: 'The service has declined publication.' },
  unconfirmed: { label: 'Unconfirmed', icon: '?', description: 'The outcome is not confirmed. Publication may still be processing or may already be complete.' },
  'request-error': { label: 'Request Error', icon: '!', description: 'The publication request could not be completed.' },
} satisfies Record<PublicationDisplayStatus, { label: string; icon: string; description: string }>

const errorMessages = {
  RESPONSE_LOST: 'The publication response was lost. Check the status of this attempt to confirm its outcome.',
  STATUS_UNAVAILABLE: 'Status is temporarily unavailable. The last confirmed information is shown. You can check again.',
  UNKNOWN_ANNOUNCEMENT: 'The service does not recognize this announcement. Check the announcement before trying again.',
  OPERATION_ID_CONFLICT: 'This operation ID belongs to another announcement. This attempt needs to be reviewed before retrying.',
} satisfies Record<NonNullable<PublicationRequestFailure['code']>, string>

const publicationDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export type PublicationStatusProps = {
  displayStatus: PublicationDisplayStatus
  operation?: PublicationOperation
  request?: PublicationRequestState
  requestFailure?: PublicationRequestFailure
  compact?: boolean
  id?: string
}

export default function PublicationStatus({
  displayStatus, operation, request, requestFailure, compact = false, id,
}: PublicationStatusProps) {
  const status = statuses[displayStatus]
  const terminal = displayStatus === 'published' || displayStatus === 'rejected'
  const submitting = request?.status === 'publishing' && !terminal
  const checking = request?.status === 'checking' && !terminal
  const feedback = requestFailure?.code
    ? errorMessages[requestFailure.code]
    : requestFailure ? 'The service could not be contacted. Check the status of this attempt again.' : undefined
  const errorFeedback = terminal && requestFailure &&
    (requestFailure.code === undefined || requestFailure.code === 'RESPONSE_LOST' || requestFailure.code === 'STATUS_UNAVAILABLE')
    ? 'A previous service request could not be completed. The confirmed publication result is shown above.'
    : feedback

  const badge = (
    <span id={id} className="announcement-status" data-status={submitting ? 'submitting' : displayStatus}>
      <span aria-hidden="true">{submitting ? '◷' : status.icon}</span>
      {submitting ? 'Submitting…' : status.label}
    </span>
  )

  if (compact) return badge

  return (
    <div className="publication-feedback">
      <div className="publication-feedback-summary" role="status" aria-live="polite" aria-atomic="true">
        {badge}
        <p>{submitting ? 'Sending this publication request to the service.' : status.description}</p>
        {operation?.status === 'published' && (
          <p>Published <time dateTime={operation.publishedAt}>{publicationDate.format(new Date(operation.publishedAt))}</time></p>
        )}
        {operation?.status === 'rejected' && <p>{operation.reason}</p>}
        {errorFeedback && <p className="publication-error-feedback">{errorFeedback}</p>}
      </div>
      {checking && <p aria-live="off">Checking status…</p>}
    </div>
  )
}
