import { useState } from 'react'
import { useAnnouncements } from '../hooks/useAnnouncements'
import { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'

export default function AnnouncementList() {
  const state = useAnnouncements()
  const workspace = usePublicationWorkspace()
  const [selectedId, setSelectedId] = useState<string>()

  if (state.status === 'loading') {
    return <p role="status">Loading announcements…</p>
  }

  if (state.status === 'error') {
    return <p role="alert">Could not load announcements. Refresh the page to try again.</p>
  }

  const selected = state.announcements.find(({ id }) => id === selectedId) ?? state.announcements[0]
  if (!selected) return <p>No announcements available.</p>
  const { id, title, body } = selected
  const { operationId, displayStatus, operation, request, requestError, canPublish, canCheckStatus, canRetry, canRetryPublication } =
    workspace.getAnnouncementPublication(id)

  return (
    <>
      <div className="workspace-toolbar">
        {workspace.recovery.status === 'loading' && <p role="status">Checking previous publication attempts…</p>}
        {workspace.recovery.status === 'error' && (
          <p role="alert">
            Could not load previous publication attempts. {workspace.recovery.message}
            {' '}Try again to resume starting new publications.
          </p>
        )}
        <button
          type="button"
          disabled={workspace.recovery.status === 'loading'}
          onClick={() => void workspace.refreshPublicationStatuses().catch(() => {})}
        >
          {workspace.recovery.status === 'error' ? 'Retry loading publication statuses' : 'Refresh publication statuses'}
        </button>
      </div>
      <div className="workspace-grid">
        <section className="workspace-panel" aria-labelledby="announcements-heading">
          <h2 id="announcements-heading">Announcements</h2>
          <ul className="announcement-options">
            {state.announcements.map((announcement) => (
              <li key={announcement.id}>
                <label className="announcement-option">
                  <input
                    type="radio"
                    name="selected-announcement"
                    checked={announcement.id === id}
                    onChange={() => setSelectedId(announcement.id)}
                  />
                  <span>{announcement.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section className="workspace-panel announcement-details" aria-labelledby="details-heading">
          <h2 id="details-heading">{title}</h2>
          <p>{body}</p>
          <p role="status">
            {request?.status === 'publishing' ? 'Submitting publication…' :
              displayStatus === 'unconfirmed' ? 'Publication outcome unconfirmed' :
              displayStatus.replace('-', ' ')}
            {request?.status === 'checking' && ' · Checking status…'}
            {operation?.status === 'rejected' && ` · ${operation.reason}`}
            {requestError && ` · ${requestError}`}
          </p>
          <div className="publication-actions">
            {(canPublish || canRetry) && (
              <button className="primary-action" type="button" onClick={() => void workspace.publishAnnouncement(id).catch(() => {})}>
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
          </div>
        </section>
      </div>
    </>
  )
}
