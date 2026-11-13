import { useEffect, useState } from 'react'
import { getAnnouncements } from './features/announcements/services/announcementService'
import type { IAnnouncement } from './mocks'

type AnnouncementsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; announcements: IAnnouncement[] }

export default function App() {
  const [state, setState] = useState<AnnouncementsState>({ status: 'loading' })

  useEffect(() => {
    let active = true

    getAnnouncements().then(
      (announcements) => {
        if (active) setState({ status: 'success', announcements })
      },
      () => {
        if (active) setState({ status: 'error' })
      },
    )

    return () => {
      active = false
    }
  }, [])

  return (
    <main>
      <h1>Announcement Publishing Workspace</h1>
      {state.status === 'loading' && <p role="status">Loading announcements…</p>}
      {state.status === 'error' && (
        <p role="alert">Could not load announcements. Refresh the page to try again.</p>
      )}
      {state.status === 'success' && (
        <ul>
          {state.announcements.map(({ id, title, body }) => (
            <li key={id}>
              <h2>{title}</h2>
              <p>{body}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
