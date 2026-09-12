// ============================================
// 全局类型定义
// ============================================

/** 用户信息 */
export interface UserProfile {
  openid: string
  nickname: string
  avatar: string
}

/** 表情包基础条目（系统模板 / 我的表情） */
export interface EmojiItem {
  id: string
  fileID: string
  url: string
  name: string
  tags: string[]
  createdAt: string
}

/** 分页返回结构 */
export interface PageResult<T> {
  list: T[]
  hasMore: boolean
}
