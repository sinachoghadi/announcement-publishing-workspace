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

  const announcements = state.status === 'success' ? state.announcements : []
  const selected = selectedId === undefined
    ? announcements[0]
    : announcements.find(({ id }) => id === selectedId)
  const id = selected?.id
  const publication = id === undefined ? undefined : workspace.getAnnouncementPublication(id)

  return (
    <>
      <div className="workspace-toolbar">
        <p role="status" aria-atomic="true">
          {workspace.recovery.status === 'loading' && 'Checking previous publication attempts…'}
        </p>
        {workspace.recovery.status === 'error' && (
          <p role="alert">
            Could not load previous publication attempts. {workspace.recovery.message}
            {' '}Try again to resume starting new publications.
          </p>
        )}
        <button
          type="button"
          aria-disabled={workspace.recovery.status === 'loading'}
          aria-busy={workspace.recovery.status === 'loading'}
          onClick={() => {
            if (workspace.recovery.status !== 'loading') {
              void workspace.refreshPublicationStatuses().catch(() => {})
            }
          }}
        >
          {workspace.recovery.status === 'loading' ? 'Loading publication statuses…' :
            workspace.recovery.status === 'error' ? 'Retry loading publication statuses' : 'Refresh publication statuses'}
        </button>
      </div>
      <div className="workspace-grid">
        <AnnouncementList
          announcements={announcements}
          status={state.status}
          selectedId={id}
          onSelect={setSelectedId}
          getPublication={workspace.getAnnouncementPublication}
        />
        <AnnouncementDetails
          announcement={selected}
          publication={publication}
          placeholder={state.status === 'loading' ? 'Announcement details will appear when loading finishes.' :
            state.status === 'error' ? 'Announcement details are unavailable until the list can be loaded.' :
            announcements.length === 0 ? 'Details will appear here when announcements are available.' : undefined}
        >
          {id !== undefined && publication && (
            <PublicationActions announcementId={id} publication={publication} workspace={workspace} />
          )}
        </AnnouncementDetails>
      </div>
    </>
  )
}
