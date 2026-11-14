import { useState } from 'react'
import { useAnnouncements } from '../hooks/useAnnouncements'
import { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'
import AnnouncementList from './AnnouncementList'

export default function AnnouncementWorkspace() {
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
        <AnnouncementList
          announcements={state.announcements}
          selectedId={id}
          onSelect={setSelectedId}
          getPublication={workspace.getAnnouncementPublication}
        />
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
