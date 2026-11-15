import type { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'
import type { PublicationActionButton } from '../state/publicationSelectors'
import type { AnnouncementId } from '../state/publicationTypes'

type Workspace = ReturnType<typeof usePublicationWorkspace>

type PublicationActionsProps = {
  announcementId: AnnouncementId
  publication: ReturnType<Workspace['getAnnouncementPublication']>
  workspace: Pick<Workspace, 'publishAnnouncement' | 'retryPublication' | 'checkStatus'>
}

const labels: Record<PublicationActionButton['action'], { idle: string; busy?: string }> = {
  publish: { idle: 'Publish', busy: 'Publishing…' },
  retry: { idle: 'Retry request', busy: 'Retrying…' },
  'check-status': { idle: 'Check status', busy: 'Checking…' },
  'new-attempt': { idle: 'New attempt' },
}

export default function PublicationActions({ announcementId, publication, workspace }: PublicationActionsProps) {
  async function execute(action: typeof publication.actions[number]['action']) {
    try {
      switch (action) {
        case 'publish':
        case 'new-attempt':
          await workspace.publishAnnouncement(announcementId)
          break
        case 'retry':
          if (publication.operationId !== undefined) {
            await workspace.retryPublication(announcementId, publication.operationId)
          }
          break
        case 'check-status':
          await workspace.checkStatus(announcementId)
          break
      }
    } catch {
      // The coordinator records request failures for PublicationStatus to display.
    }
  }

  if (publication.actions.length === 0) return null

  return (
    <div className="publication-actions" role="group" aria-label="Publication actions">
      {publication.actions.map(({ action, disabled, busy }, index) => (
        <button
          key={action}
          className={index === 0 ? 'primary-action' : undefined}
          type="button"
          disabled={disabled && !busy}
          aria-disabled={disabled}
          aria-busy={busy}
          onClick={() => {
            if (!disabled) void execute(action)
          }}
        >
          {(busy ? labels[action].busy : undefined) ?? labels[action].idle}
        </button>
      ))}
    </div>
  )
}
