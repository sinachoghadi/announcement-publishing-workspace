import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef, useImperativeHandle, type Ref } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  AnnouncementMockError, createAnnouncementMock, type AnnouncementScenario, type IAnnouncement,
} from '../../../mocks'
import { usePublicationWorkspace } from '../hooks/usePublicationWorkspace'
import * as service from '../services/announcementService'
import { selectActiveOperationId } from '../state/publicationSelectors'
import AnnouncementDetails from './AnnouncementDetails'
import AnnouncementWorkspace from './AnnouncementWorkspace'
import PublicationActions from './PublicationActions'
import PublicationStatus from './PublicationStatus'

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
  const announcementsRequest = mock.getAnnouncements()
  await vi.advanceTimersByTimeAsync(80)
  const announcements = await announcementsRequest
  const [announcement] = announcements
  const workspaceRef = createRef<Workspace>()
  render(<PublicationPanel announcement={announcement} workspaceRef={workspaceRef} />)

  const workspace = () => {
    if (!workspaceRef.current) throw new Error('Publication panel is not mounted')
    return workspaceRef.current
  }
  const publication = () => workspace().getAnnouncementPublication(announcement.id)
  return { announcement, announcements, mock, workspace, publication }
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

test('recovers a lost response with the original attempt and deduplicates rapid retries', async () => {
  const send = service.publish
  const randomUUID = vi.spyOn(crypto, 'randomUUID')
  const getStatus = vi.spyOn(service, 'getStatus')
  let registeredOperationId: string | undefined
  const publish = vi.spyOn(service, 'publish').mockImplementationOnce((announcementId, operationId) => {
    registeredOperationId = selectActiveOperationId(workspace().application.getState(), announcementId)
    return send(announcementId, operationId)
  })
  const { announcement, mock, workspace, publication } = await openPublicationPanel('lost-response')
  await advance(100)

  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  const [, operationId] = publish.mock.calls[0]
  expect(registeredOperationId).toBe(operationId)
  await advance(120)

  const status = screen.getByRole('status')
  expect(publication()).toMatchObject({
    operationId,
    requestFailure: { code: 'RESPONSE_LOST', serviceRequest: { operationId, announcementId: announcement.id } },
  })
  expect(publication().operation).toBeUndefined()
  expect(within(status).getByText('Unconfirmed')).toBeInTheDocument()
  expect(within(status).queryByText('Rejected')).not.toBeInTheDocument()

  const retryButton = screen.getByRole('button', { name: 'Retry request' })
  expect(retryButton).toBeEnabled()
  fireEvent.click(retryButton)
  fireEvent.click(retryButton)
  await expect(workspace().retryPublication(announcement.id, operationId)).resolves.toBeUndefined()
  expect(publish.mock.calls).toEqual([[announcement.id, operationId], [announcement.id, operationId]])
  expect(randomUUID).toHaveBeenCalledTimes(1)
  await advance(120)
  expect(publication().operation).toMatchObject({ operationId, status: 'processing' })
  expect(within(status).getByText('Processing')).toBeInTheDocument()

  await advance(3000)
  const checks = getStatus.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
  expect(getStatus).toHaveBeenCalledTimes(checks + 1)
  expect(getStatus).toHaveBeenLastCalledWith(operationId)
  await advance(100)
  expect(status).toHaveTextContent('The service has confirmed publication.')
  expect(publication().requestFailure).toBeUndefined()
  expect(status).not.toHaveTextContent(/response was lost/i)

  const operations = mock.listOperations()
  await advance(100)
  const confirmed = publication().operation
  expect(confirmed).toMatchObject({ operationId, announcementId: announcement.id, status: 'published' })
  await expect(operations).resolves.toEqual([confirmed])
  expect(publish).toHaveBeenCalledTimes(2)
})

test('backs off after a temporary status failure while another announcement publishes independently', async () => {
  const publish = vi.spyOn(service, 'publish')
  const getStatus = vi.spyOn(service, 'getStatus')
  const { announcement, announcements, mock, workspace, publication } = await openPublicationPanel('status-check-failure')
  const second = announcements[1]
  await advance(100)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  const [, operationId] = publish.mock.calls[0]
  await advance(120)
  expect(publication().requestFailure?.code).toBe('RESPONSE_LOST')

  mock.setScenario('success')
  await act(async () => {
    const attempt = workspace().publishAnnouncement(second.id)
    await vi.advanceTimersByTimeAsync(120)
    await attempt
  })
  const [, secondOperationId] = publish.mock.calls[1]
  expect(secondOperationId).not.toBe(operationId)
  const secondPublication = () => workspace().getAnnouncementPublication(second.id)
  const secondSnapshot = secondPublication().operation
  expect(secondSnapshot).toMatchObject({ operationId: secondOperationId, announcementId: second.id, status: 'processing' })

  await advance(2000 - 120)
  expect(getStatus.mock.calls).toEqual([[operationId]])
  await advance(100)

  const status = screen.getByRole('status')
  expect(within(status).getByText('Unconfirmed')).toBeInTheDocument()
  expect(status).toHaveTextContent(/status is temporarily unavailable/i)
  expect(screen.getByRole('button', { name: 'Check status' })).toBeEnabled()
  expect(publication()).toMatchObject({
    operationId,
    requestFailure: { code: 'STATUS_UNAVAILABLE', serviceRequest: { operationId, announcementId: announcement.id } },
  })
  expect(publication().operation).toBeUndefined()
  expect(secondPublication().operation).toEqual(secondSnapshot)
  expect(secondPublication().requestFailure).toBeUndefined()

  const checksForAttempt = () => getStatus.mock.calls.filter(([id]) => id === operationId)
  await advance(3999)
  expect(checksForAttempt()).toHaveLength(1)
  expect(getStatus).toHaveBeenCalledWith(secondOperationId)
  await advance(101)
  expect(checksForAttempt()).toHaveLength(2)
  expect(publication().operation).toMatchObject({ operationId, status: 'published' })
  expect(publication().requestFailure).toBeUndefined()
  expect(status).toHaveTextContent('The service has confirmed publication.')
  expect(status).not.toHaveTextContent(/status is temporarily unavailable/i)

  await advance(10_000)
  expect(checksForAttempt()).toHaveLength(2)
  expect(secondPublication().operation).toMatchObject({ operationId: secondOperationId, status: 'published' })
  expect(publish.mock.calls).toEqual([[announcement.id, operationId], [second.id, secondOperationId]])
})

test('preserves a confirmed processing snapshot when the first status read fails', async () => {
  const { publication } = await openPublicationPanel('status-check-failure')
  await advance(100)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await advance(120)
  fireEvent.click(screen.getByRole('button', { name: 'Retry request' }))
  await advance(120)
  const snapshot = publication().operation
  expect(snapshot).toMatchObject({ status: 'processing', version: 1 })

  fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
  await advance(100)
  expect(publication().operation).toEqual(snapshot)
  expect(publication().operationId).toBe(snapshot?.operationId)
  expect(publication().requestFailure?.code).toBe('STATUS_UNAVAILABLE')
  expect(within(screen.getByRole('status')).getByText('Processing')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
  await advance(100)
  expect(publication().operation).toEqual(snapshot)
  expect(publication().requestFailure).toBeUndefined()
})

test('keeps three overlapping publications independent while the selection changes', async () => {
  const mock = createAnnouncementMock()
  mock.setScenario('overlapping')
  const publish = vi.spyOn(service, 'publish')
  const readStatus = service.getStatus
  let failedStatusCheck = false
  vi.spyOn(service, 'getStatus').mockImplementation((operationId) => {
    const [firstAnnouncementId, firstOperationId] = publish.mock.calls[0]
    // The overlapping scenario itself does not fail status reads.
    if (operationId === firstOperationId && !failedStatusCheck) {
      failedStatusCheck = true
      return Promise.reject(new AnnouncementMockError(
        'STATUS_UNAVAILABLE', 'temporary-status-failure', operationId, firstAnnouncementId,
      ))
    }
    return readStatus(operationId)
  })
  render(<AnnouncementWorkspace />)
  await advance(100)

  const [first, second, third] = screen.getAllByRole('radio')
  const details = () => within(screen.getByRole('region', { name: 'Publication' }))
  for (const option of [first, second, third]) {
    fireEvent.click(option)
    expect(option).toBeChecked()
    const button = details().getByRole('button', { name: 'Publish' })
    fireEvent.click(button)
    if (option === first) fireEvent.click(button)
  }

  expect(publish.mock.calls.map(([id]) => id)).toEqual(['ann-101', 'ann-102', 'ann-103'])
  expect(new Set(publish.mock.calls.map(([, id]) => id)).size).toBe(3)
  for (const option of [first, second, third]) expect(option).toHaveAccessibleDescription('Submitting…')

  await advance(80)
  expect(first).toHaveAccessibleDescription('Submitting…')
  expect(second).toHaveAccessibleDescription('Processing')
  expect(third).toHaveAccessibleDescription('Submitting…')
  await advance(120)
  expect(first).toHaveAccessibleDescription('Submitting…')
  expect(third).toHaveAccessibleDescription('Processing')
  await advance(400)
  expect(first).toHaveAccessibleDescription('Processing')

  await advance(1680)
  expect(second).toHaveAccessibleDescription('Published')
  expect(first).toHaveAccessibleDescription('Processing')
  expect(third).toHaveAccessibleDescription('Processing')

  fireEvent.click(first)
  await advance(420)
  expect(details().getByRole('status')).toHaveTextContent(/status is temporarily unavailable/i)
  expect(first).toHaveAccessibleDescription('Processing')
  fireEvent.click(third)
  expect(details().getByRole('status')).not.toHaveTextContent(/status is temporarily unavailable/i)

  await advance(3900)
  expect(third).toHaveAccessibleDescription('Published')
  expect(first).toHaveAccessibleDescription('Processing')
  await advance(4600)

  const list = mock.listOperations()
  await advance(100)
  const snapshots = await list
  expect(snapshots).toHaveLength(3)
  for (const [index, option] of [first, second, third].entries()) {
    const [announcementId, operationId] = publish.mock.calls[index]
    const snapshot = snapshots.find((operation) => operation.operationId === operationId)
    expect(snapshot).toMatchObject({ announcementId, status: 'published', version: 2 })
    if (snapshot?.status !== 'published') throw new Error('Expected a published snapshot')
    expect(option).toHaveAccessibleDescription('Published')
    fireEvent.click(option)
    expect(details().getByText(operationId)).toBeInTheDocument()
    expect(details().getByText(snapshot.publicationId)).toBeInTheDocument()
  }
})

test('preserves the published snapshot when the original slow publish response arrives', async () => {
  const publish = vi.spyOn(service, 'publish')
  const getStatus = vi.spyOn(service, 'getStatus')
  const listOperations = vi.spyOn(service, 'listOperations')
  const { announcement, mock, workspace, publication } = await openPublicationPanel('explicit-rejection')
  await advance(100)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await advance(120)
  const olderAttempt = publication().operation
  expect(olderAttempt).toMatchObject({ status: 'rejected' })
  if (olderAttempt?.status !== 'rejected') throw new Error('Expected the previous attempt to be rejected')

  mock.setScenario('slow-response')
  fireEvent.click(screen.getByRole('button', { name: 'New attempt' }))
  const [, operationId] = publish.mock.calls[1]
  expect(operationId).not.toBe(olderAttempt?.operationId)
  let responseDelivered = false
  const initialResponse = publish.mock.results[1].value.then((snapshot: Awaited<ReturnType<typeof service.publish>>) => {
    responseDelivered = true
    return snapshot
  })

  async function checkStatus() {
    await act(async () => {
      const check = workspace().checkStatus(announcement.id)
      await vi.advanceTimersByTimeAsync(100)
      await check
    })
  }

  await checkStatus()
  const processing = publication().operation
  expect(processing).toMatchObject({ operationId, status: 'processing', version: 1 })

  await act(async () => {
    const recovery = workspace().refreshPublicationStatuses()
    await vi.advanceTimersByTimeAsync(100)
    await recovery
  })
  await expect(listOperations.mock.results[1].value).resolves.toEqual([olderAttempt, processing])
  expect(publication().operationId).toBe(operationId)
  expect(workspace().getOperation(olderAttempt.operationId)).toEqual(olderAttempt)

  await advance(1300)
  await checkStatus()
  expect(responseDelivered).toBe(false)
  expect(getStatus.mock.calls).toEqual([[operationId], [operationId]])
  const confirmed = await getStatus.mock.results[1].value
  expect(confirmed).toMatchObject({
    announcementId: announcement.id, operationId, status: 'published', version: 2,
    publicationId: expect.any(String), publishedAt: expect.any(String),
  })
  expect(publication().operation).toEqual(confirmed)

  await advance(2900)
  expect(responseDelivered).toBe(true)
  await expect(initialResponse).resolves.toMatchObject({
    announcementId: announcement.id, operationId, status: 'processing', version: 1,
  })
  expect(publication().operation).toEqual(confirmed)
  expect(screen.getByRole('status')).toHaveTextContent('The service has confirmed publication.')
  expect(screen.queryByRole('button', { name: 'Check status' })).not.toBeInTheDocument()
  await advance(10_000)
  expect(getStatus.mock.calls).toEqual([[operationId], [operationId]])
})

test.each([
  ['published', 'The service has confirmed publication.'],
  ['rejected', 'The service has declined publication.'],
] as const)('shows the confirmed %s result alongside earlier network feedback', (displayStatus, confirmation) => {
  render(
    <PublicationStatus
      displayStatus={displayStatus}
      requestFailure={{ status: 'unconfirmed', code: 'STATUS_UNAVAILABLE', message: 'Status unavailable' }}
    />,
  )

  const status = screen.getByRole('status')
  expect(status).toHaveTextContent(confirmation)
  expect(status).toHaveTextContent(/previous service request could not be completed/i)
  expect(within(status).queryByText('Unconfirmed')).not.toBeInTheDocument()
})
