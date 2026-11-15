import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef, useImperativeHandle, type Ref } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAnnouncementMock, type AnnouncementScenario, type IAnnouncement } from '../../../mocks'
import { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'
import * as service from '../services/announcementService'
import { selectActiveOperationId } from '../state/publicationSelectors'
import AnnouncementDetails from './AnnouncementDetails'
import PublicationActions from './PublicationActions'

type Workspace = ReturnType<typeof usePublicationWorkspace>

function PublicationPanel({ announcement, workspaceRef }: {
  announcement: IAnnouncement
  workspaceRef: Ref<Workspace>
}) {
  const workspace = usePublicationWorkspace()
  const publication = workspace.getAnnouncementPublication(announcement.id)
  useImperativeHandle(workspaceRef, () => workspace, [workspace])

  return (
    <AnnouncementDetails announcement={announcement} publication={publication}>
      <PublicationActions announcementId={announcement.id} publication={publication} workspace={workspace} />
    </AnnouncementDetails>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function advance(ms: number) {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function openPublicationPanel(scenario: AnnouncementScenario) {
  const mock = createAnnouncementMock()
  mock.setScenario(scenario)
  const announcements = mock.getAnnouncements()
  await vi.advanceTimersByTimeAsync(80)
  const [announcement] = await announcements
  const workspaceRef = createRef<Workspace>()
  render(<PublicationPanel announcement={announcement} workspaceRef={workspaceRef} />)

  const workspace = () => {
    if (!workspaceRef.current) throw new Error('Publication panel is not mounted')
    return workspaceRef.current
  }
  const publication = () => workspace().getAnnouncementPublication(announcement.id)
  return { announcement, mock, workspace, publication }
}

test('publishes a registered attempt, keeps its confirmation, and stops polling', async () => {
  const send = service.publish
  let registeredOperationId: string | undefined
  const getStatus = vi.spyOn(service, 'getStatus')
  const publish = vi.spyOn(service, 'publish').mockImplementation((announcementId, operationId) => {
    registeredOperationId = selectActiveOperationId(workspace().application.getState(), announcementId)
    return send(announcementId, operationId)
  })

  const { announcement, workspace, publication } = await openPublicationPanel('success')
  await advance(100)
  const publishButton = screen.getByRole('button', { name: 'Publish' })
  expect(publishButton).toBeEnabled()
  fireEvent.click(publishButton)
  expect(publish).toHaveBeenCalledTimes(1)
  const [owner, operationId] = publish.mock.calls[0]
  expect(owner).toBe(announcement.id)
  expect(operationId).toBeTruthy()
  expect(registeredOperationId).toBe(operationId)

  await advance(120)
  expect(publication().operation).toMatchObject({ operationId, status: 'processing', version: 1 })
  expect(within(screen.getByRole('status')).getByText('Processing')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()

  await advance(2200)
  expect(getStatus).toHaveBeenCalledWith(operationId)
  expect(publication().operation?.status).toBe('processing')

  await advance(2200)
  const confirmed = await getStatus.mock.results.at(-1)?.value
  expect(confirmed).toMatchObject({
    operationId,
    status: 'published',
    version: 2,
    publicationId: expect.any(String),
    publishedAt: expect.any(String),
  })
  expect(workspace().getOperation(operationId)).toEqual(confirmed)
  expect(screen.getByRole('status')).toHaveTextContent('The service has confirmed publication.')
  expect(screen.queryByRole('group', { name: 'Publication actions' })).not.toBeInTheDocument()
  await expect(workspace().publishAnnouncement(announcement.id)).resolves.toBeUndefined()
  expect(publish).toHaveBeenCalledTimes(1)

  const checks = getStatus.mock.calls.length
  await advance(10_000)
  expect(getStatus).toHaveBeenCalledTimes(checks)
})

test('shows the service rejection and keeps it when a new attempt starts', async () => {
  const publish = vi.spyOn(service, 'publish')
  const getStatus = vi.spyOn(service, 'getStatus')
  const { announcement, mock, workspace, publication } = await openPublicationPanel('explicit-rejection')
  await advance(100)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await advance(120)

  const rejected = await publish.mock.results[0].value
  expect(rejected.status).toBe('rejected')
  if (rejected.status !== 'rejected') throw new Error('Expected a rejected snapshot')
  expect(publication().operation).toEqual(rejected)
  expect(publication().requestFailure).toBeUndefined()
  const status = within(screen.getByRole('status'))
  expect(status.getByText('Rejected')).toBeInTheDocument()
  expect(status.getByText(rejected.reason)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry request' })).not.toBeInTheDocument()

  await expect(workspace().retryPublication(announcement.id, rejected.operationId)).resolves.toBeUndefined()
  await advance(10_000)
  expect(publish).toHaveBeenCalledTimes(1)
  expect(getStatus).not.toHaveBeenCalled()

  mock.setScenario('success')
  const newAttempt = screen.getByRole('button', { name: 'New attempt' })
  expect(newAttempt).toBeEnabled()
  fireEvent.click(newAttempt)
  await advance(120)

  const next = publication().operation
  expect(next).toMatchObject({ announcementId: announcement.id, status: 'processing' })
  expect(next?.operationId).not.toBe(rejected.operationId)
  expect(publish).toHaveBeenCalledTimes(2)
  expect(workspace().getOperation(rejected.operationId)).toEqual(rejected)
})
