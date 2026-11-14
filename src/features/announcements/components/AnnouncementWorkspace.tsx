import { useState } from 'react'
import { useAnnouncements } from '../hooks/useAnnouncements'
import { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'
import AnnouncementDetails from './AnnouncementDetails'
import AnnouncementList from './AnnouncementList'
import PublicationActions from './PublicationActions'

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
            <PublicationActions announcementId={id} publication={publication} workspace={workspace} />
          )}
        </AnnouncementDetails>
      </div>
    </>
  )
}
