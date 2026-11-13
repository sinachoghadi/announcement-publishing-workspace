import { useAnnouncements } from '../hooks/useAnnouncements'

export default function AnnouncementList() {
  const state = useAnnouncements()

  if (state.status === 'loading') {
    return <p role="status">Loading announcements…</p>
  }

  if (state.status === 'error') {
    return <p role="alert">Could not load announcements. Refresh the page to try again.</p>
  }

  return (
    <ul>
      {state.announcements.map(({ id, title, body }) => (
        <li key={id}>
          <h2>{title}</h2>
          <p>{body}</p>
        </li>
      ))}
    </ul>
  )
}
