import AnnouncementWorkspace from '../features/announcements/components/AnnouncementWorkspace'

export default function App() {
  return (
    <main>
      <header className="workspace-header">
        <h1>Announcement Workspace</h1>
        <p>Review prepared announcements, publish them, and track their status.</p>
      </header>
      <AnnouncementWorkspace />
    </main>
  )
}
