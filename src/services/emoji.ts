import Taro from '@tarojs/taro'
import { callFunction } from './cloud'
import type { EmojiItem, PageResult, UserProfile } from '@/types'

const isWeapp = process.env.TARO_ENV === 'weapp'

/** 静默登录，获取/创建用户 */
export function login(): Promise<UserProfile> {
  return callFunction<UserProfile>('login')
}

/** 我的私有表情列表 */
export function getMyList(skip = 0, limit = 30): Promise<PageResult<EmojiItem>> {
  return callFunction<PageResult<EmojiItem>>('getMyList', { skip, limit })
}

/** 存入我的私有表情 */
export function uploadMyEmoji(payload: { fileID: string; name: string; tags: string[] }): Promise<EmojiItem> {
  return callFunction<EmojiItem>('uploadMyEmoji', payload)
}

/** 删除我的私有表情 */
export function deleteMyEmoji(id: string): Promise<{ success: boolean }> {
  return callFunction<{ success: boolean }>('deleteMyEmoji', { id })
}

/**
 * 上传表情图片到云存储（仅微信端真实上传）
 * 非微信环境直接返回 dataURL，由 mock 层接管
 */
export async function uploadImageFile(
  file: { filePath?: string; dataURL?: string },
  ext: 'png' | 'gif' = 'png'
): Promise<string> {
  if (isWeapp && file.filePath) {
    const cloudPath = `emoji/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const res = await Taro.cloud.uploadFile({ cloudPath, filePath: file.filePath })
    console.info('[EmojiService] 图片已上传云存储', res.fileID)
    return res.fileID
  }
  if (file.dataURL) return file.dataURL
  throw new Error('缺少可上传的图片')
}
