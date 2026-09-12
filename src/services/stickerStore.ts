// ============================================
// 本地素材数据库（基于 Taro Storage 持久化）
// 保存：用户上传的贴纸/底图、收藏的网络素材、创作的表情缩略图
// 特性：写入自动去重（同素材不重复入库）、按收藏时间倒序、容量上限保护
// ============================================

import Taro from '@tarojs/taro'

const DB_KEY = 'emoji_sticker_db_v1'
const MAX_ITEMS = 120
const MAX_DATA_URL_LEN = 400_000 // 单条 dataURL 上限，防止超出本地存储配额

export interface LocalSticker {
  id: string
  name: string
  /** 网络素材地址 */
  url?: string
  /** 微信本地文件路径 */
  localPath?: string
  /** H5 base64 数据（可持久化） */
  dataUrl?: string
  /** true=贴纸层 false=底图 */
  over: boolean
  /** 来源：上传 / 网络收藏 / 创作 */
  source: 'upload' | 'net' | 'creation'
  createdAt: number
}

interface StickerDB {
  stickers: LocalSticker[]
}

function readDB(): StickerDB {
  try {
    const raw = Taro.getStorageSync(DB_KEY)
    if (raw && typeof raw === 'object') {
      const stickers = (raw as StickerDB).stickers
      if (Array.isArray(stickers)) return { stickers }
    }
  } catch (err) {
    console.error('[StickerDB] 读取失败', err)
  }
  return { stickers: [] }
}

function writeDB(db: StickerDB): void {
  try {
    Taro.setStorageSync(DB_KEY, db)
  } catch (err) {
    console.error('[StickerDB] 写入失败', err)
  }
}

/** 列出我的素材（按收藏时间倒序） */
export function listLocalStickers(): LocalSticker[] {
  return readDB()
    .stickers.slice()
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 新增素材（自动去重：url/localPath/dataUrl 任一相同即视为重复，跳过并返回 null）
 */
export function addLocalSticker(
  rec: Omit<LocalSticker, 'id' | 'createdAt'>
): LocalSticker | null {
  if (!rec.url && !rec.localPath && !rec.dataUrl) return null
  if (rec.dataUrl && rec.dataUrl.length > MAX_DATA_URL_LEN) {
    console.warn('[StickerDB] 素材过大，跳过保存')
    return null
  }
  const db = readDB()
  const dup = db.stickers.find(
    s =>
      (rec.url && s.url === rec.url) ||
      (rec.localPath && s.localPath === rec.localPath) ||
      (rec.dataUrl && s.dataUrl === rec.dataUrl)
  )
  if (dup) return null
  const item: LocalSticker = {
    ...rec,
    id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now()
  }
  writeDB({ stickers: [item, ...db.stickers].slice(0, MAX_ITEMS) })
  return item
}

/** 删除素材 */
export function removeLocalSticker(id: string): void {
  const db = readDB()
  writeDB({ stickers: db.stickers.filter(s => s.id !== id) })
}

/** 清空素材库 */
export function clearLocalStickers(): void {
  writeDB({ stickers: [] })
}

/** 素材记录 -> 可用于 <Image>/画布加载的地址 */
export function stickerRecordSrc(rec: LocalSticker): string {
  return rec.localPath || rec.dataUrl || rec.url || ''
}
