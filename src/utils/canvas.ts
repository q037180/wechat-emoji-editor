import Taro from '@tarojs/taro'

const isWeapp = process.env.TARO_ENV === 'weapp'

// ============================================
// Canvas 2D 跨端工具（微信小程序 / H5）
// ============================================

/** 画布节点抽象（微信 createImage / H5 toDataURL） */
export interface CanvasNode {
  width: number
  height: number
  getContext(type: '2d'): CanvasRenderingContext2D
  createImage?(): CanvasImage
  toDataURL?(type?: string): string
}

/** 画布图片元素抽象 */
export interface CanvasImage {
  src: string
  width: number
  height: number
  onload: (() => void) | null
  onerror: ((err: unknown) => void) | null
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface ExportResult {
  /** 微信端：临时文件路径（可直接上传云存储/保存相册） */
  filePath?: string
  /** H5 端：dataURL */
  dataURL?: string
}

interface NodeQueryResult {
  node: CanvasNode
  width: number
  height: number
}

export type { NodeQueryResult }

/** 查询页面中的 canvas 2d 节点 */
export function getCanvasNode(selector: string): Promise<NodeQueryResult> {
  return new Promise((resolve, reject) => {
    const query = Taro.createSelectorQuery()
    query
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res: Array<NodeQueryResult | null> | undefined) => {
        const info = res && res[0]
        if (info && info.node) {
          resolve(info)
        } else {
          console.error('[Canvas] 未找到画布节点', selector)
          reject(new Error(`未找到画布节点: ${selector}`))
        }
      })
  })
}

/** 在画布上加载图片（微信用 canvas.createImage，H5 用 Image） */
export function loadCanvasImage(node: CanvasNode, src: string): Promise<CanvasImage> {
  return new Promise((resolve, reject) => {
    const done = (img: CanvasImage) => {
      if (img.width && img.height) {
        resolve(img)
      } else {
        reject(new Error('图片尺寸无效'))
      }
    }
    const fail = (err: unknown) => {
      console.error('[Canvas] 图片加载失败', src, err)
      reject(new Error('图片加载失败'))
    }

    if (isWeapp && typeof node.createImage === 'function') {
      const img = node.createImage()
      img.onload = () => done(img)
      img.onerror = fail
      img.src = src
      return
    }

    if (typeof window !== 'undefined' && typeof window.Image !== 'undefined') {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        // 必须返回真实的 HTMLImageElement，否则 drawImage 会报类型错误
        const el = img as unknown as CanvasImage
        el.width = img.naturalWidth
        el.height = img.naturalHeight
        el.onload = null
        el.onerror = null
        done(el)
      }
      img.onerror = fail
      img.src = src
      return
    }

    reject(new Error('当前环境不支持画布图片加载'))
  })
}

/** 将任意来源（cloud:// / https / 本地路径）解析为可绘制路径 */
export async function resolveImageSrc(src: string): Promise<string> {
  if (!src) throw new Error('图片地址为空')
  if (!isWeapp) return src
  if (src.indexOf('cloud://') === 0) {
    try {
      const res = await Taro.cloud.getTempFileURL({ fileList: [src] })
      const url = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL
      if (!url) throw new Error('获取云文件链接失败')
      return downloadFile(url)
    } catch (err) {
      console.error('[Canvas] 云文件解析失败', src, err)
      throw new Error('云图片读取失败')
    }
  }
  if (src.indexOf('http') === 0) return downloadFile(src)
  return src
}

async function downloadFile(url: string): Promise<string> {
  const res = await Taro.downloadFile({ url })
  if (res.statusCode !== 200) {
    console.error('[Canvas] 图片下载失败', url, res.statusCode)
    throw new Error('图片下载失败')
  }
  return res.tempFilePath
}

/** 将画布导出为可上传/可保存的结果 */
export async function exportCanvasImage(node: CanvasNode): Promise<ExportResult> {
  if (isWeapp) {
    const res = await Taro.canvasToTempFilePath({
      canvas: node as unknown as Record<string, unknown>,
      fileType: 'png',
      quality: 1
    } as unknown as Parameters<typeof Taro.canvasToTempFilePath>[0])
    return { filePath: res.tempFilePath }
  }
  if (typeof node.toDataURL === 'function') {
    return { dataURL: node.toDataURL('image/png') }
  }
  throw new Error('当前环境不支持画布导出')
}

/** 图片等比缩放并居中到 max x max 区域 */
export function fitRect(w: number, h: number, max: number): Rect {
  if (!w || !h) return { x: 0, y: 0, w: max, h: max }
  const scale = Math.min(max / w, max / h)
  const dw = w * scale
  const dh = h * scale
  return { x: (max - dw) / 2, y: (max - dh) / 2, w: dw, h: dh }
}

/** 数值夹取 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 创建离屏画布（微信 createOffscreenCanvas / H5 document.createElement）
 * 用于图层效果（亮度/灰度/马赛克）的离屏渲染管线；不可用时返回 null，调用方需降级
 */
export function createOffscreenCanvas(
  size: number
): { node: CanvasNode; ctx: CanvasRenderingContext2D } | null {
  if (isWeapp) {
    try {
      const T = Taro as unknown as {
        createOffscreenCanvas?: (opts: { type: string; width: number; height: number }) => CanvasNode
      }
      if (typeof T.createOffscreenCanvas === 'function') {
        const node = T.createOffscreenCanvas({ type: '2d', width: size, height: size })
        const ctx = node.getContext('2d')
        if (ctx) return { node, ctx }
      }
      return null
    } catch (err) {
      console.error('[Canvas] 离屏画布创建失败', err)
      return null
    }
  }
  if (typeof document !== 'undefined') {
    const el = document.createElement('canvas')
    el.width = size
    el.height = size
    const ctx = el.getContext('2d')
    if (!ctx) return null
    return { node: el as unknown as CanvasNode, ctx }
  }
  return null
}

/** 延时 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
