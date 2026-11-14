import { useAnnouncements } from '../hooks/useAnnouncements'
import { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'

export default function AnnouncementList() {
  const state = useAnnouncements()
  const workspace = usePublicationWorkspace()

  if (state.status === 'loading') {
    return <p role="status">Loading announcements…</p>
  }

  if (state.status === 'error') {
    return <p role="alert">Could not load announcements. Refresh the page to try again.</p>
  }

  return (
    <>
      <button
        type="button"
        disabled={workspace.recovery.status === 'loading'}
        onClick={() => void workspace.refreshPublicationStatuses().catch(() => {})}
      >
        {workspace.recovery.status === 'loading' ? 'Refreshing statuses…' : 'Refresh publication statuses'}
      </button>
      {workspace.recovery.status === 'error' && <p role="alert">{workspace.recovery.message}</p>}
      <ul>
        {state.announcements.map(({ id, title, body }) => {
          const { operationId, displayStatus, operation, request, requestError, canPublish, canCheckStatus, canRetry, canRetryPublication } =
            workspace.getAnnouncementPublication(id)

          return (
            <li key={id}>
              <h2>{title}</h2>
              <p>{body}</p>
              <p role="status">
                {request?.status === 'publishing' ? 'Submitting publication…' :
                  displayStatus === 'unconfirmed' ? 'Publication outcome unconfirmed' :
                  displayStatus.replace('-', ' ')}
                {request?.status === 'checking' && ' · Checking status…'}
                {operation?.status === 'rejected' && ` · ${operation.reason}`}
                {requestError && ` · ${requestError}`}
              </p>
              {(canPublish || canRetry) && (
                <button type="button" onClick={() => void workspace.publishAnnouncement(id).catch(() => {})}>
                  {canRetry ? 'Start new publication attempt' : 'Publish'}
                </button>
              )}
              {canRetryPublication && operationId !== undefined && (
                <button type="button" onClick={() => void workspace.retryPublication(id, operationId).catch(() => {})}>
                  Retry publication request
                </button>
              )}
              {operation || request ? (
                <button
                  type="button"
                  disabled={!canCheckStatus}
                  onClick={() => void workspace.checkStatus(id).catch(() => {})}
                >
                  Check status
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
