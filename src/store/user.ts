import { create } from 'zustand'
import type { UserProfile } from '@/types'

interface UserState {
  user: UserProfile | null
  setUser: (user: UserProfile) => void
  clearUser: () => void
}

/** 全局用户信息 */
export const useUserStore = create<UserState>(set => ({
  user: null,
  setUser: user => set({ user }),
  clearUser: () => set({ user: null })
}))
