import { create } from 'zustand'

interface TransferState {
  /** 跨页传递：待加载到编辑器的图片地址（做同款 / 用于创作） */
  pendingImageUrl: string
  setPendingImage: (url: string) => void
}

/** 页面间轻量数据传递 */
export const useTransferStore = create<TransferState>(set => ({
  pendingImageUrl: '',
  setPendingImage: url => set({ pendingImageUrl: url })
}))
