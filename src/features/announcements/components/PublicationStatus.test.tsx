import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import PublicationStatus from './PublicationStatus'

test('renders publication status in an accessible status region', () => {
  render(<PublicationStatus displayStatus="processing" />)

  expect(within(screen.getByRole('status')).getByText('Processing')).toBeInTheDocument()
})
