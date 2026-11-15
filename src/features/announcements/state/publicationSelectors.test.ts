// @vitest-environment node
import { expect, test } from 'vitest'
import { selectPublicationDisplayStatus } from './publicationSelectors'
import { initialPublicationState } from './publicationTypes'

test('reports an unsubmitted announcement as not published', () => {
  expect(selectPublicationDisplayStatus(initialPublicationState, 'ann-101')).toBe('not-published')
})
