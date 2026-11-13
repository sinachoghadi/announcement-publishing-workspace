import { useEffect, useState } from 'react'
import { getAnnouncements } from '../services/announcementService'
import type { AnnouncementsState } from '../state/announcementsState'

export function useAnnouncements(): AnnouncementsState {
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

  return state
}
