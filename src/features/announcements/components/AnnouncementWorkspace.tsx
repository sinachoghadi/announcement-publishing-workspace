import { useState } from 'react'
import { useAnnouncements } from '../hooks/useAnnouncements'
import { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'
import AnnouncementDetails from './AnnouncementDetails'
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

  const selected = selectedId === undefined
    ? state.announcements[0]
    : state.announcements.find(({ id }) => id === selectedId)
  const id = selected?.id
  const publication = id === undefined ? undefined : workspace.getAnnouncementPublication(id)
  const operationId = publication?.operationId

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
        <AnnouncementDetails announcement={selected} publication={publication}>
          {id !== undefined && publication && (
            <div className="publication-actions">
              {(publication.canPublish || publication.canRetry) && (
                <button className="primary-action" type="button" onClick={() => void workspace.publishAnnouncement(id).catch(() => {})}>
                  {publication.canRetry ? 'Start new publication attempt' : 'Publish'}
                </button>
              )}
              {publication.canRetryPublication && operationId !== undefined && (
                <button type="button" onClick={() => void workspace.retryPublication(id, operationId).catch(() => {})}>
                  Retry publication request
                </button>
              )}
              {publication.operation || publication.request ? (
                <button
                  type="button"
                  disabled={!publication.canCheckStatus}
                  onClick={() => void workspace.checkStatus(id).catch(() => {})}
                >
                  Check status
                </button>
              ) : null}
            </div>
          )}
        </AnnouncementDetails>
      </div>
    </>
  )
}
