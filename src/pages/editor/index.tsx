import React, { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import Taro, { useDidShow, useReady, useShareAppMessage } from '@tarojs/taro'
import { Canvas, Image, Input, ScrollView, Slider, Text, View } from '@tarojs/components'
import classnames from 'classnames'
import dayjs from 'dayjs'
import styles from './index.module.scss'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import {
  BG_COLORS,
  DEFAULT_BG_COLOR,
  DEFAULT_PART_COLOR,
  FACE_COLORS,
  PART_KIND_LIST,
  drawPartLayer,
  drawPartLayerSelection,
  getPartById,
  getPartsByKind,
  type AnyLayer,
  type ImageLayer,
  type PartKind,
  type PartLayer
} from '@/data/emojiParts'
import { uploadImageFile, uploadMyEmoji } from '@/services/emoji'
import { addLocalSticker, listLocalStickers, removeLocalSticker, stickerRecordSrc, type LocalSticker } from '@/services/stickerStore'
import { STICKER_CATEGORIES, getStickersByCategory, stickerImageUrl, type StickerCategory, type StickerDef } from '@/data/stickerLibrary'
import { useTransferStore } from '@/store/transfer'
import {
  clamp,
  createOffscreenCanvas,
  delay,
  exportCanvasImage,
  fitRect,
  getCanvasNode,
  loadCanvasImage,
  resolveImageSrc,
  type CanvasNode,
  type ExportResult,
  type NodeQueryResult
} from '@/utils/canvas'

type ToolKey = 'emoji' | 'text' | 'brush' | 'gif'

const TOOL_TABS: Array<{ key: ToolKey; label: string; icon: string }> = [
  { key: 'emoji', label: '捏表情', icon: '🧩' },
  { key: 'text', label: '文字', icon: '✏️' },
  { key: 'brush', label: '画笔', icon: '🖌️' },
  { key: 'gif', label: 'GIF', icon: '🎞️' }
]

const TEXT_COLORS = ['#1d2129', '#ffffff', '#ff6b35', '#ffc53d', '#00b42a', '#165dff', '#f5222d']
const BRUSH_COLORS = ['#ff6b35', '#ffc53d', '#00b42a', '#165dff', '#f5222d', '#ffffff', '#1d2129']

interface CanvasTouch {
  x?: number
  y?: number
  clientX?: number
  clientY?: number
}

interface CanvasTouchEvent {
  touches?: CanvasTouch[]
  changedTouches?: CanvasTouch[]
}

/** 画笔笔迹（坐标为画布 CSS 像素） */
interface BrushStroke {
  color: string
  size: number
  mosaic: boolean
  points: Array<{ x: number; y: number }>
}

interface TextLayer {
  enabled: boolean
  content: string
  fontSize: number
  colorIdx: number
  /** 相对画布的比例坐标 */
  x: number
  y: number
}

type DragTarget =
  | { kind: 'layer'; id: string; offX: number; offY: number }
  | { kind: 'text'; offX: number; offY: number }
  /** 角点：等比缩放（横纵同步） */
  | { kind: 'scale'; id: string; startDist: number; startScaleX: number; startScaleY: number }
  /** 右边中点：仅横向拉伸（改 scaleX） */
  | { kind: 'stretchX'; id: string; startProj: number; startScaleX: number }
  /** 下边中点：仅纵向拉伸（改 scaleY） */
  | { kind: 'stretchY'; id: string; startProj: number; startScaleY: number }
  | { kind: 'rotate'; id: string; startPointerAngle: number; startRotation: number }
  | null

/** 图层效果参数（P图调节） */
interface LayerAdjust {
  brightness: number
  grayscale: number
  mosaic: number
}

interface GifFrame {
  id: string
  data: ImageData
  thumb?: string
}

interface GifResult {
  url: string
}

const CAPTURE_SIZE = 360
const MAX_FRAMES = 20
const PART_HIT_RADIUS = 60 // 部件命中半径（300坐标系）

/** H5：blob:/objectURL 转 dataURL，便于持久化到本地素材库 */
function blobToDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof fetch === 'undefined' || typeof FileReader === 'undefined') {
      reject(new Error('当前环境不支持读取文件'))
      return
    }
    fetch(url)
      .then(r => r.blob())
      .then(blob => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(new Error('读取文件失败'))
        fr.readAsDataURL(blob)
      })
      .catch(reject)
  })
}

/** H5：把 dataURL 压缩为 size x size 的居中小图（存库用，控制体积） */
function shrinkDataUrl(dataUrl: string, size = 160): Promise<string> {
  return new Promise(resolve => {
    try {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = size
        c.height = size
        const cx = c.getContext('2d')
        if (!cx) {
          resolve(dataUrl)
          return
        }
        const cover = Math.max(size / (img.naturalWidth || size), size / (img.naturalHeight || size))
        const dw = (img.naturalWidth || size) * cover
        const dh = (img.naturalHeight || size) * cover
        cx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh)
        resolve(c.toDataURL('image/png'))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch {
      resolve(dataUrl)
    }
  })
}

const EditorPage: React.FC = () => {
  const [tool, setTool] = useState<ToolKey>('emoji')
  /** 捏表情面板页签：部件分类 / 素材库 / 我的素材 */
  const [emojiTab, setEmojiTab] = useState<PartKind | 'asset' | 'mine'>('face')
  const [assetCat, setAssetCat] = useState<StickerCategory>('face')
  const [bgColor, setBgColor] = useState(DEFAULT_BG_COLOR)
  const [layers, setLayers] = useState<AnyLayer[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [text, setText] = useState<TextLayer>({
    enabled: false,
    content: '哈哈哈哈',
    fontSize: 22,
    colorIdx: 0,
    x: 0.5,
    y: 0.78
  })
  const [brushColorIdx, setBrushColorIdx] = useState(0)
  const [brushSize, setBrushSize] = useState(8)
  const [mosaicMode, setMosaicMode] = useState(false)
  const [strokesCount, setStrokesCount] = useState(0)
  const [canvasSize, setCanvasSize] = useState(320)
  const [showActions, setShowActions] = useState(false)
  const [working, setWorking] = useState(false)
  const [frames, setFrames] = useState<GifFrame[]>([])
  const [frameDelay, setFrameDelay] = useState(300)
  const [gifResult, setGifResult] = useState<GifResult | null>(null)
  const [gifBusy, setGifBusy] = useState(false)
  const [showLayerPanel, setShowLayerPanel] = useState(true)
  const [showAdjust, setShowAdjust] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [mineStickers, setMineStickers] = useState<LocalSticker[]>([])

  const canvasRef = useRef<CanvasNode | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const sizeRef = useRef(320)
  const initRef = useRef(false)

  const bgRef = useRef(DEFAULT_BG_COLOR)
  const layersRef = useRef<AnyLayer[]>([])
  const selectedRef = useRef<string | null>(null)
  const toolRef = useRef<ToolKey>('emoji')
  const textRef = useRef<TextLayer>(text)
  const framesRef = useRef<GifFrame[]>([])
  const captureNodeRef = useRef<CanvasNode | null>(null)
  const captureCtxRef = useRef<CanvasRenderingContext2D | null>(null)

  const draggingRef = useRef<DragTarget>(null)
  const strokesRef = useRef<BrushStroke[]>([])
  const liveStrokeRef = useRef<BrushStroke | null>(null)
  const offscreenRef = useRef<{ node: CanvasNode; ctx: CanvasRenderingContext2D } | null>(null)
  const offscreenFailedRef = useRef(false)

  /** 裁剪模式：目标图层 / 框选草稿（图层本地归一化坐标）/ 是否正在拖动 */
  const cropActiveRef = useRef(false)
  const cropLayerIdRef = useRef<string | null>(null)
  const cropDraftRef = useRef<{ u0: number; v0: number; u1: number; v1: number } | null>(null)
  const cropDraggingRef = useRef(false)

  // 同步 ref
  useEffect(() => { bgRef.current = bgColor }, [bgColor])
  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { textRef.current = text }, [text])
  useEffect(() => { framesRef.current = frames }, [frames])

  // ---------- 图层效果（P图调节） ----------
  const layerAdjust = (l: AnyLayer): LayerAdjust | null => {
    const brightness = l.brightness ?? 1
    const grayscale = l.grayscale ?? 0
    const mosaic = l.mosaic ?? 0
    if (brightness === 1 && grayscale === 0 && mosaic === 0) return null
    return { brightness, grayscale, mosaic }
  }

  const ensureOffscreen = () => {
    if (offscreenRef.current) return offscreenRef.current
    if (offscreenFailedRef.current) return null
    const made = createOffscreenCanvas(300)
    if (!made) {
      offscreenFailedRef.current = true
      return null
    }
    offscreenRef.current = made
    return made
  }

  /** 在 ImageData 上应用马赛克/亮度/灰度/饱和度/整体透明度（alpha 加权平均保透明度） */
  const applyAdjustPixels = (
    d: Uint8ClampedArray,
    width: number,
    cell: number,
    brightness: number,
    grayscale: number,
    saturation = 1,
    alphaScale = 1
  ) => {
    const W = width
    if (cell > 1) {
      for (let by = 0; by < W; by += cell) {
        for (let bx = 0; bx < W; bx += cell) {
          let r = 0, g = 0, b = 0, a = 0, n = 0
          const xmax = Math.min(bx + cell, W)
          const ymax = Math.min(by + cell, W)
          for (let y = by; y < ymax; y++) {
            for (let x = bx; x < xmax; x++) {
              const i = (y * W + x) * 4
              const al = d[i + 3]
              r += d[i] * al
              g += d[i + 1] * al
              b += d[i + 2] * al
              a += al
              n++
            }
          }
          const avgR = a > 0 ? r / a : 0
          const avgG = a > 0 ? g / a : 0
          const avgB = a > 0 ? b / a : 0
          const avgA = a / n
          for (let y = by; y < ymax; y++) {
            for (let x = bx; x < xmax; x++) {
              const i = (y * W + x) * 4
              d[i] = avgR
              d[i + 1] = avgG
              d[i + 2] = avgB
              d[i + 3] = avgA
            }
          }
        }
      }
    }
    if (grayscale > 0 || brightness !== 1 || saturation !== 1 || alphaScale !== 1) {
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue
        let r = d[i], g = d[i + 1], b = d[i + 2]
        if (saturation !== 1) {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b
          r = lum + (r - lum) * saturation
          g = lum + (g - lum) * saturation
          b = lum + (b - lum) * saturation
        }
        if (grayscale > 0) {
          const y = 0.299 * r + 0.587 * g + 0.114 * b
          r += (y - r) * grayscale
          g += (y - g) * grayscale
          b += (y - b) * grayscale
        }
        if (brightness !== 1) {
          r *= brightness
          g *= brightness
          b *= brightness
        }
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
        if (alphaScale !== 1) d[i + 3] = d[i + 3] * alphaScale
      }
    }
  }

  const hasContent = useMemo(() => {
    return layers.length > 0 || strokesCount > 0 || (text.enabled && !!text.content.trim())
  }, [layers, strokesCount, text])

  // ---------- 重绘 ----------
  const redraw = useCallback(() => {
    const ctx = ctxRef.current
    const W = sizeRef.current
    if (!ctx || !W) return
    const k = W / 300

    // 背景
    ctx.fillStyle = bgRef.current
    ctx.fillRect(0, 0, W, W)

    /** 在 300 坐标系上下文中绘制单层（带效果管线） */
    const paintLayer = (c: CanvasRenderingContext2D, layer: AnyLayer) => {
      const eff = layerAdjust(layer)
      if (!eff) {
        if (layer.type === 'part') {
          drawPartLayer(c as unknown as Parameters<typeof drawPartLayer>[0], layer)
        } else {
          drawImageLayer(c, layer)
        }
        return
      }
      // 离屏渲染：画到 300x300 离屏画布 -> 像素级滤镜 -> 合成回主画布
      const off = ensureOffscreen()
      if (!off) {
        if (layer.type === 'part') {
          drawPartLayer(c as unknown as Parameters<typeof drawPartLayer>[0], layer)
        } else {
          drawImageLayer(c, layer)
        }
        return
      }
      const octx = off.ctx
      octx.clearRect(0, 0, 300, 300)
      if (layer.type === 'part') {
        drawPartLayer(octx as unknown as Parameters<typeof drawPartLayer>[0], layer)
      } else {
        drawImageLayer(octx, layer)
      }
      try {
        const img = octx.getImageData(0, 0, 300, 300)
        applyAdjustPixels(img.data, 300, Math.round(eff.mosaic), eff.brightness, eff.grayscale)
        octx.putImageData(img, 0, 0)
      } catch (err) {
        console.error('[Editor] 图层效果处理失败', err)
      }
      c.save()
      c.drawImage(off.node as unknown as CanvasImageSource, 0, 0, 300, 300)
      c.restore()
    }

    // 1) 底图（over=false 的图片层，300 坐标系）
    ctx.save()
    ctx.scale(k, k)
    for (const layer of layersRef.current) {
      if (layer.type === 'image' && !layer.over && layer.visible) paintLayer(ctx, layer)
    }
    ctx.restore()

    // 2) 部件层（按数组顺序，自下而上，300 坐标系）
    ctx.save()
    ctx.scale(k, k)
    for (const layer of layersRef.current) {
      if (layer.type === 'part' && layer.visible) paintLayer(ctx, layer)
    }
    ctx.restore()

    // 3) 贴纸（over=true 的图片层，300 坐标系）
    ctx.save()
    ctx.scale(k, k)
    for (const layer of layersRef.current) {
      if (layer.type === 'image' && layer.over && layer.visible) paintLayer(ctx, layer)
    }
    ctx.restore()

    // 4) 选中框（300 坐标系）+ 拖拽手柄（画布像素坐标系）；裁剪中的图层不画
    if (selectedRef.current && !(cropActiveRef.current && cropLayerIdRef.current === selectedRef.current)) {
      const sel = layersRef.current.find(l => l.id === selectedRef.current)
      if (sel) {
        ctx.save()
        ctx.scale(k, k)
        if (sel.type === 'part') {
          drawPartLayerSelection(ctx as unknown as Parameters<typeof drawPartLayerSelection>[0], sel)
        } else {
          drawImageSelection(ctx, sel)
        }
        ctx.restore()
        if (toolRef.current !== 'brush') drawHandles(ctx, sel)
      }
    }

    // 4.5) 裁剪框选预览：图层本地坐标系，框外压暗 + 白框 + 三分线
    if (cropActiveRef.current && cropLayerIdRef.current) {
      const cl = layersRef.current.find(l => l.id === cropLayerIdRef.current)
      if (cl && cl.type === 'image') {
        const d = cropDraftRef.current || { u0: 0, v0: 0, u1: 1, v1: 1 }
        const w = cl.w * cl.scaleX
        const h = cl.h * cl.scaleY
        const cx0 = (Math.min(d.u0, d.u1) - 0.5) * w
        const cx1 = (Math.max(d.u0, d.u1) - 0.5) * w
        const cy0 = (Math.min(d.v0, d.v1) - 0.5) * h
        const cy1 = (Math.max(d.v0, d.v1) - 0.5) * h
        ctx.save()
        ctx.scale(k, k)
        ctx.translate(cl.x, cl.y)
        if (cl.rotation) ctx.rotate(cl.rotation)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.fillRect(-w / 2, -h / 2, w, cy0 + h / 2)
        ctx.fillRect(-w / 2, cy1, w, h / 2 - cy1)
        ctx.fillRect(-w / 2, cy0, cx0 + w / 2, cy1 - cy0)
        ctx.fillRect(cx1, cy0, w / 2 - cx1, cy1 - cy0)
        ctx.setLineDash([])
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 1.5 / k
        ctx.strokeRect(cx0, cy0, cx1 - cx0, cy1 - cy0)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
        ctx.lineWidth = 1 / k
        ctx.beginPath()
        for (let i = 1; i <= 2; i++) {
          const gx = cx0 + ((cx1 - cx0) * i) / 3
          const gy = cy0 + ((cy1 - cy0) * i) / 3
          ctx.moveTo(gx, cy0)
          ctx.lineTo(gx, cy1)
          ctx.moveTo(cx0, gy)
          ctx.lineTo(cx1, gy)
        }
        ctx.stroke()
        ctx.restore()
      }
    }

    // 5) 画笔笔迹
    if (strokesRef.current.length) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const s of strokesRef.current) {
        if (!s.points.length) continue
        if (s.mosaic) {
          drawMosaicStroke(ctx, s)
        } else {
          ctx.strokeStyle = s.color
          ctx.lineWidth = s.size
          ctx.beginPath()
          ctx.moveTo(s.points[0].x, s.points[0].y)
          if (s.points.length === 1) {
            ctx.lineTo(s.points[0].x + 0.01, s.points[0].y)
          } else {
            for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
          }
          ctx.stroke()
        }
      }
    }

    // 6) 文字
    if (textRef.current.enabled && textRef.current.content.trim()) {
      const sizePx = Math.round(textRef.current.fontSize * (W / 375))
      const label = textRef.current.content.slice(0, 20)
      ctx.font = `bold ${sizePx}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = Math.max(2, sizePx / 7)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.fillStyle = TEXT_COLORS[textRef.current.colorIdx] || '#1d2129'
      const tx = textRef.current.x * W
      const ty = textRef.current.y * W
      ctx.strokeText(label, tx, ty)
      ctx.fillText(label, tx, ty)
    }
  }, [])

  /** 绘制图片层（含旋转/透明度/圆形/框选裁剪）。坐标为 300 坐标系，
   *  调用方需先 ctx.scale(W/300, W/300)，与部件层共用同一坐标系 */
  const drawImageLayer = (ctx: CanvasRenderingContext2D, layer: ImageLayer) => {
    const lw = layer.w * layer.scaleX
    const lh = layer.h * layer.scaleY
    const img = layer.img
    const crop = layer.crop
    const iw = img.width || 0
    const ih = img.height || 0
    const sx = crop ? crop.x0 * iw : 0
    const sy = crop ? crop.y0 * ih : 0
    const sw = crop ? (crop.x1 - crop.x0) * iw : iw
    const sh = crop ? (crop.y1 - crop.y0) * ih : ih
    if (sw <= 0 || sh <= 0) return
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(layer.x, layer.y)
    if (layer.rotation) ctx.rotate(layer.rotation)
    if (layer.circle) {
      const r = Math.min(lw, lh) / 2
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.clip()
      const cover = Math.max((r * 2) / sw, (r * 2) / sh)
      const dw = sw * cover
      const dh = sh * cover
      ctx.drawImage(img as unknown as CanvasImageSource, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh)
    } else {
      ctx.drawImage(img as unknown as CanvasImageSource, sx, sy, sw, sh, -lw / 2, -lh / 2, lw, lh)
    }
    ctx.restore()
  }

  /** 选中图片层时画虚线框（300 坐标系，调用方已 scale(W/300)） */
  const drawImageSelection = (ctx: CanvasRenderingContext2D, layer: ImageLayer) => {
    const lw = layer.w * layer.scaleX
    const lh = layer.h * layer.scaleY
    ctx.save()
    ctx.translate(layer.x, layer.y)
    if (layer.rotation) ctx.rotate(layer.rotation)
    ctx.strokeStyle = '#FF6B35'
    ctx.lineWidth = 1.6
    ctx.setLineDash([6, 4])
    ctx.strokeRect(-lw / 2, -lh / 2, lw, lh)
    ctx.restore()
  }

  /** 选中层的包围盒半宽/半高（300 坐标系，已含图层非等比缩放） */
  const layerHalfSize = (l: AnyLayer) => {
    if (l.type === 'image') {
      return { hw: (l.w * l.scaleX) / 2, hh: (l.h * l.scaleY) / 2 }
    }
    return { hw: 110 * l.scaleX, hh: 110 * l.scaleY }
  }

  /** 计算缩放/拉伸/旋转手柄位置（画布 CSS 像素坐标） */
  const getHandlePositions = (l: AnyLayer) => {
    const k = sizeRef.current / 300
    const { hw, hh } = layerHalfSize(l)
    const cx = l.x * k
    const cy = l.y * k
    const cosR = Math.cos(l.rotation)
    const sinR = Math.sin(l.rotation)
    const hwC = hw * k
    const hhC = hh * k
    // 右下角：旋转向量 (hw, hh) —— 等比缩放手柄
    const sx = cx + cosR * hwC - sinR * hhC
    const sy = cy + sinR * hwC + cosR * hhC
    // 右边中点：旋转向量 (hw, 0) —— 横向拉伸手柄
    const exX = cx + cosR * hwC
    const exY = cy + sinR * hwC
    // 下边中点：旋转向量 (0, hh) —— 纵向拉伸手柄
    const exYx = cx - sinR * hhC
    const exYy = cy + cosR * hhC
    // 顶边中点向外延伸：方向 (sinR, -cosR)
    const rExt = hhC + 26
    const rx = cx + sinR * rExt
    const ry = cy - cosR * rExt
    return {
      center: { x: cx, y: cy },
      scale: { x: sx, y: sy },
      stretchX: { x: exX, y: exY },
      stretchY: { x: exYx, y: exYy },
      rotate: { x: rx, y: ry },
      top: { x: cx + sinR * hhC, y: cy - cosR * hhC }
    }
  }

  /** 绘制拖拽手柄：右下白点=等比缩放，右/下蓝点=拉伸压扁，顶部橙点=旋转 */
  const drawHandles = (ctx: CanvasRenderingContext2D, layer: AnyLayer) => {
    const pos = getHandlePositions(layer)
    ctx.save()
    ctx.setLineDash([])
    // 连接虚线（顶边中点 -> 旋转手柄）
    ctx.strokeStyle = '#FF6B35'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(pos.top.x, pos.top.y)
    ctx.lineTo(pos.rotate.x, pos.rotate.y)
    ctx.stroke()
    // 旋转手柄（橙）
    ctx.beginPath()
    ctx.arc(pos.rotate.x, pos.rotate.y, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#FF6B35'
    ctx.fill()
    // 拉伸手柄（白底蓝边，小一号）
    const drawStretch = (p: { x: number; y: number }) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = '#165DFF'
      ctx.stroke()
    }
    drawStretch(pos.stretchX)
    drawStretch(pos.stretchY)
    // 等比缩放手柄（白底橙边）
    ctx.beginPath()
    ctx.arc(pos.scale.x, pos.scale.y, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#FF6B35'
    ctx.stroke()
    ctx.restore()
  }

  /** 马赛克笔：用画布已有的颜色画方格块 */
  const drawMosaicStroke = (ctx: CanvasRenderingContext2D, s: BrushStroke) => {
    const cell = Math.max(4, Math.round(s.size))
    for (const p of s.points) {
      const cx = Math.floor(p.x / cell) * cell
      const cy = Math.floor(p.y / cell) * cell
      ctx.fillStyle = s.color
      ctx.fillRect(cx, cy, cell, cell)
    }
  }

  // 状态变化后自动重绘
  useEffect(() => {
    if (initRef.current) redraw()
  }, [redraw, bgColor, layers, text])

  // 进入/退出裁剪模式后重绘
  useEffect(() => {
    cropActiveRef.current = cropping
    if (initRef.current) redraw()
  }, [cropping, redraw])

  // 切换工具时刷新
  useEffect(() => {
    if (initRef.current) redraw()
  }, [tool, redraw])

  // ---------- 画布初始化 ----------
  const queryCanvasNode = async (): Promise<NodeQueryResult | null> => {
    try {
      const res = await getCanvasNode('#editorCanvas')
      if (res && res.node && res.width > 0) return res
    } catch {
      // ignore
    }
    if (process.env.TARO_ENV !== 'weapp' && typeof document !== 'undefined') {
      const el =
        (document.querySelector('taro-canvas-core#editorCanvas canvas') ||
          document.querySelector('#editorCanvas canvas') ||
          document.querySelector('taro-canvas-core canvas')) as HTMLCanvasElement | null
      if (el) {
        const rect = el.getBoundingClientRect()
        const cssSize = rect.width || sizeRef.current - 32
        return { node: el as unknown as CanvasNode, width: cssSize, height: rect.height || cssSize }
      }
    }
    return null
  }

  const initCanvas = async () => {
    try {
      const sys = Taro.getSystemInfoSync()
      const cssW = Math.max(260, Math.floor(sys.windowWidth - 32))
      sizeRef.current = cssW
      setCanvasSize(cssW)

      let info: NodeQueryResult | null = null
      for (let i = 0; i < 20; i++) {
        info = await queryCanvasNode()
        if (info) break
        await delay(120)
      }
      if (!info) throw new Error('画布节点未就绪')

      const node = info.node
      const dpr = Math.min(sys.pixelRatio || 2, 3)
      const cssSize = info.width || cssW - 32
      node.width = Math.floor(cssSize * dpr)
      node.height = Math.floor(cssSize * dpr)
      const ctx = node.getContext('2d')
      ctx.scale(dpr, dpr)
      canvasRef.current = node
      ctxRef.current = ctx
      sizeRef.current = cssSize
      initRef.current = true
      redraw()

      const { pendingImageUrl, setPendingImage } = useTransferStore.getState()
      if (pendingImageUrl) {
        setPendingImage('')
        addImageLayer(pendingImageUrl, false)
      }
    } catch (err) {
      console.error('[Editor] 画布初始化失败', err)
      Taro.showToast({ title: '画布初始化失败', icon: 'none' })
    }
  }

  useReady(() => {
    initCanvas()
  })

  useDidShow(() => {
    if (!initRef.current) return
    const { pendingImageUrl, setPendingImage } = useTransferStore.getState()
    if (pendingImageUrl) {
      setPendingImage('')
      addImageLayer(pendingImageUrl, false)
    }
  })

  // ---------- 图层操作 ----------
  const commitLayers = (next: AnyLayer[]) => {
    layersRef.current = next
    setLayers(next)
  }

  /** 添加部件层（在部件选项上点按触发） */
  const addPartLayer = (partId: string) => {
    const def = getPartById(partId)
    if (!def) return
    const layer: PartLayer = {
      id: `part-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'part',
      partId,
      kind: def.kind,
      x: def.naturalCenter.x,
      y: def.naturalCenter.y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      color: def.colorable ? DEFAULT_PART_COLOR : undefined,
      visible: true
    }
    commitLayers([...layersRef.current, layer])
    selectedRef.current = layer.id
    setSelectedId(layer.id)
    redraw()
  }

  /** 添加图片层 */
  const addImageLayer = async (src: string, over: boolean) => {
    if (!src) return
    const node = canvasRef.current
    if (!node || !initRef.current) {
      Taro.showToast({ title: '画布未就绪，请稍候', icon: 'none' })
      return
    }
    Taro.showLoading({ title: '加载素材…', mask: true })
    try {
      const localPath = await resolveImageSrc(src)
      const img = await loadCanvasImage(node, localPath)
      const W = sizeRef.current
      const maxW = W * (over ? 0.7 : 0.92)
      const rect = fitRect(img.width, img.height, maxW)
      // 小尺寸素材（如 64px emoji）限制放大倍数，避免拉大后模糊
      let dw = rect.w
      let dh = rect.h
      const upscaleCap = 1.6
      if (img.width > 0 && dw > img.width * upscaleCap) {
        const capped = (img.width * upscaleCap) / dw
        dw *= capped
        dh *= capped
      }
      // 统一换算到 300 坐标系：居中放置
      const k = 300 / W
      const layer: ImageLayer = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'image',
        img,
        w: dw * k,
        h: dh * k,
        x: 150,
        y: 150,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        circle: false,
        over,
        visible: true
      }
      commitLayers([...layersRef.current, layer])
      selectedRef.current = layer.id
      setSelectedId(layer.id)
      redraw()
      Taro.hideLoading()
    } catch (err) {
      console.error('[Editor] 素材加载失败', err)
      Taro.hideLoading()
      Taro.showToast({ title: '素材加载失败', icon: 'none' })
    }
  }

  const updateLayer = (id: string, patch: Partial<AnyLayer>) => {
    commitLayers(layersRef.current.map(l => (l.id === id ? ({ ...l, ...patch } as AnyLayer) : l)))
    redraw()
  }

  // ---------- 裁剪（图片层框选裁剪） ----------
  /** 画布 CSS 像素 -> 图片层本地归一化坐标（0-1，已逆旋转/逆缩放） */
  const layerToUV = (l: ImageLayer, px: number, py: number) => {
    const k = sizeRef.current / 300
    const dx = px / k - l.x
    const dy = py / k - l.y
    const cos = Math.cos(l.rotation)
    const sin = Math.sin(l.rotation)
    const lx = dx * cos + dy * sin
    const ly = -dx * sin + dy * cos
    return {
      u: clamp(lx / Math.max(1, l.w * l.scaleX) + 0.5, 0, 1),
      v: clamp(ly / Math.max(1, l.h * l.scaleY) + 0.5, 0, 1)
    }
  }

  /** 进入裁剪模式：框选区默认覆盖整个图层 */
  const enterCrop = () => {
    const l = selectedRef.current ? layersRef.current.find(x => x.id === selectedRef.current) : null
    if (!l || l.type !== 'image') return
    setShowAdjust(false)
    cropLayerIdRef.current = l.id
    cropDraftRef.current = { u0: 0, v0: 0, u1: 1, v1: 1 }
    cropDraggingRef.current = false
    setCropping(true)
  }

  const exitCrop = () => {
    cropLayerIdRef.current = null
    cropDraftRef.current = null
    cropDraggingRef.current = false
    setCropping(false)
  }

  /** 应用裁剪：把框选区换算到原图坐标并收拢图层尺寸（保持显示比例不变形） */
  const applyCrop = () => {
    const l = cropLayerIdRef.current
      ? (layersRef.current.find(x => x.id === cropLayerIdRef.current) as ImageLayer | undefined)
      : undefined
    const d = cropDraftRef.current
    if (!l || !d) {
      exitCrop()
      return
    }
    const u0 = Math.min(d.u0, d.u1)
    const u1 = Math.max(d.u0, d.u1)
    const v0 = Math.min(d.v0, d.v1)
    const v1 = Math.max(d.v0, d.v1)
    if (u1 - u0 < 0.05 || v1 - v0 < 0.05) {
      Taro.showToast({ title: '裁剪区域太小，请重新框选', icon: 'none' })
      return
    }
    const base = l.crop || { x0: 0, y0: 0, x1: 1, y1: 1 }
    updateLayer(l.id, {
      crop: {
        x0: base.x0 + u0 * (base.x1 - base.x0),
        y0: base.y0 + v0 * (base.y1 - base.y0),
        x1: base.x0 + u1 * (base.x1 - base.x0),
        y1: base.y0 + v1 * (base.y1 - base.y0)
      },
      w: l.w * (u1 - u0),
      h: l.h * (v1 - v0)
    })
    exitCrop()
  }

  // ---------- H5 桌面端滑块鼠标支持 ----------
  // Taro H5 的 Slider 只监听 touch 事件，鼠标点按/拖动无效；这里补一层 mouse 处理，
  // 状态更新后受控 value 会同步滑块位置。小程序端无鼠标事件，不受影响。
  const sliderMouseProps = (min: number, max: number, step: number, onValue: (v: number) => void) => ({
    onMouseDown: (e: ReactMouseEvent) => {
      const el = e.currentTarget as unknown as HTMLElement | null
      if (!el || typeof el.getBoundingClientRect !== 'function') return
      const rect = el.getBoundingClientRect()
      if (!rect.width) return
      const emit = (clientX: number) => {
        let v = min + ((clientX - rect.left) / rect.width) * (max - min)
        v = clamp(v, min, max)
        if (step > 1) v = Math.round(v / step) * step
        onValue(Math.round(v))
      }
      emit(e.clientX)
      const move = (ev: MouseEvent) => emit(ev.clientX)
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
  })

  const removeLayer = (id: string) => {
    commitLayers(layersRef.current.filter(l => l.id !== id))
    if (selectedRef.current === id) {
      selectedRef.current = null
      setSelectedId(null)
    }
    redraw()
  }

  const moveLayer = (id: string, dir: -1 | 1) => {
    const idx = layersRef.current.findIndex(l => l.id === id)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= layersRef.current.length) return
    const next = [...layersRef.current]
    const [item] = next.splice(idx, 1)
    next.splice(target, 0, item)
    commitLayers(next)
    redraw()
  }

  // 选中层（用于在画布上点击切换）
  const hitTestLayer = (x: number, y: number): AnyLayer | null => {
    // 图片层（顶层先）
    for (let i = layersRef.current.length - 1; i >= 0; i--) {
      const l = layersRef.current[i]
      if (l.type === 'image' && l.over && hitImageLayer(l, x, y)) return l
    }
    // 部件层（从顶层往下）
    for (let i = layersRef.current.length - 1; i >= 0; i--) {
      const l = layersRef.current[i]
      if (l.type === 'part' && hitPartLayer(l, x, y)) return l
    }
    // 图片层（底层）
    for (let i = layersRef.current.length - 1; i >= 0; i--) {
      const l = layersRef.current[i]
      if (l.type === 'image' && !l.over && hitImageLayer(l, x, y)) return l
    }
    return null
  }

  const hitPartLayer = (l: PartLayer, x: number, y: number) => {
    // x, y 已是 300 坐标系
    const dx = x - l.x
    const dy = y - l.y
    const avgScale = (l.scaleX + l.scaleY) / 2
    return Math.sqrt(dx * dx + dy * dy) < PART_HIT_RADIUS * avgScale + 8
  }

  const hitImageLayer = (l: ImageLayer, x: number, y: number) => {
    const lw = l.w * l.scaleX
    const lh = l.h * l.scaleY
    return x >= l.x - lw / 2 && x <= l.x + lw / 2 && y >= l.y - lh / 2 && y <= l.y + lh / 2
  }

  // ---------- 触摸交互 ----------
  const getTouchPoint = (e: CanvasTouchEvent) => {
    const t = e.touches?.[0] || e.changedTouches?.[0]
    if (!t) return { x: -1, y: -1 }
    if (typeof t.x === 'number' && typeof t.y === 'number') return { x: t.x, y: t.y }
    const node = canvasRef.current as unknown as { getBoundingClientRect?: () => DOMRect } | null
    if (node && typeof node.getBoundingClientRect === 'function' && typeof t.clientX === 'number') {
      const rect = node.getBoundingClientRect()
      return { x: t.clientX - rect.left, y: (t.clientY as number) - rect.top }
    }
    return { x: -1, y: -1 }
  }

  /** 画布 CSS 像素 -> 300 坐标系 */
  const toCanvas = (px: number) => (px / sizeRef.current) * 300

  const handleTouchStart = (e: CanvasTouchEvent) => {
    const p = getTouchPoint(e)
    if (p.x < 0) return

    // 画笔模式
    if (tool === 'brush') {
      const stroke: BrushStroke = {
        color: BRUSH_COLORS[brushColorIdx],
        size: brushSize,
        mosaic: mosaicMode,
        points: [p]
      }
      strokesRef.current.push(stroke)
      liveStrokeRef.current = stroke
      setStrokesCount(strokesRef.current.length)
      return
    }

    // 裁剪模式：在画布上按下即开始框选，不命中手柄/图层
    if (cropActiveRef.current && cropLayerIdRef.current) {
      const cl = layersRef.current.find(l => l.id === cropLayerIdRef.current) as ImageLayer | undefined
      if (cl) {
        const { u, v } = layerToUV(cl, p.x, p.y)
        cropDraftRef.current = { u0: u, v0: v, u1: u, v1: v }
        cropDraggingRef.current = true
        redraw()
        return
      }
    }

    // 拖拽手柄优先：旋转（顶部橙点）/ 等比缩放（右下白点）/ 拉伸压扁（右/下蓝点）
    const sel = layersRef.current.find(l => l.id === selectedRef.current)
    if (sel) {
      const pos = getHandlePositions(sel)
      if (Math.hypot(p.x - pos.rotate.x, p.y - pos.rotate.y) < 22) {
        draggingRef.current = {
          kind: 'rotate',
          id: sel.id,
          startPointerAngle: Math.atan2(p.y - pos.center.y, p.x - pos.center.x),
          startRotation: sel.rotation
        }
        return
      }
      if (Math.hypot(p.x - pos.scale.x, p.y - pos.scale.y) < 24) {
        draggingRef.current = {
          kind: 'scale',
          id: sel.id,
          startDist: Math.max(8, Math.hypot(p.x - pos.center.x, p.y - pos.center.y)),
          startScaleX: sel.scaleX,
          startScaleY: sel.scaleY
        }
        return
      }
      if (Math.hypot(p.x - pos.stretchX.x, p.y - pos.stretchX.y) < 20) {
        const cosR = Math.cos(sel.rotation)
        const sinR = Math.sin(sel.rotation)
        const dx = p.x - pos.center.x
        const dy = p.y - pos.center.y
        const proj = dx * cosR + dy * sinR
        draggingRef.current = {
          kind: 'stretchX',
          id: sel.id,
          startProj: Math.abs(proj) < 12 ? (proj < 0 ? -12 : 12) : proj,
          startScaleX: sel.scaleX
        }
        return
      }
      if (Math.hypot(p.x - pos.stretchY.x, p.y - pos.stretchY.y) < 20) {
        const cosR = Math.cos(sel.rotation)
        const sinR = Math.sin(sel.rotation)
        const dx = p.x - pos.center.x
        const dy = p.y - pos.center.y
        const proj = -dx * sinR + dy * cosR
        draggingRef.current = {
          kind: 'stretchY',
          id: sel.id,
          startProj: Math.abs(proj) < 12 ? (proj < 0 ? -12 : 12) : proj,
          startScaleY: sel.scaleY
        }
        return
      }
    }

    if (tool === 'text' && text.enabled) {
      const W = sizeRef.current
      const tx = text.x * W
      const ty = text.y * W
      const hitR = Math.max(44, (text.fontSize * (W / 375)) / 1.5)
      if (Math.sqrt((p.x - tx) ** 2 + (p.y - ty) ** 2) < hitR) {
        draggingRef.current = { kind: 'text', offX: p.x - tx, offY: p.y - ty }
        return
      }
    }

    if (tool === 'emoji' || tool === 'gif' || tool === 'text') {
      const px = toCanvas(p.x)
      const py = toCanvas(p.y)
      const hit = hitTestLayer(px, py)
      if (hit) {
        draggingRef.current = { kind: 'layer', id: hit.id, offX: px - hit.x, offY: py - hit.y }
        selectedRef.current = hit.id
        setSelectedId(hit.id)
        redraw()
        return
      } else {
        // 点空白处取消选中
        selectedRef.current = null
        setSelectedId(null)
        redraw()
      }
    }
  }

  const drawSegment = (s: BrushStroke) => {
    const ctx = ctxRef.current
    if (!ctx || s.points.length < 2) return
    const p0 = s.points[s.points.length - 2]
    const p1 = s.points[s.points.length - 1]
    if (s.mosaic) {
      drawMosaicStroke(ctx, s)
    } else {
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
    }
  }

  const handleTouchMove = (e: CanvasTouchEvent) => {
    if (tool === 'brush') {
      if (!liveStrokeRef.current) return
      const p = getTouchPoint(e)
      if (p.x < 0) return
      const s = liveStrokeRef.current
      s.points.push(p)
      drawSegment(s)
      return
    }

    // 裁剪模式：更新框选终点
    if (cropActiveRef.current && cropDraggingRef.current) {
      const cl = layersRef.current.find(l => l.id === cropLayerIdRef.current) as ImageLayer | undefined
      if (!cl) return
      const p = getTouchPoint(e)
      if (p.x < 0) return
      const d = cropDraftRef.current
      if (d) {
        const { u, v } = layerToUV(cl, p.x, p.y)
        d.u1 = u
        d.v1 = v
        redraw()
      }
      return
    }

    const drag = draggingRef.current
    if (!drag) return
    const p = getTouchPoint(e)
    if (p.x < 0) return

    if (drag.kind === 'text') {
      const W = sizeRef.current
      setText(prev => ({
        ...prev,
        x: clamp((p.x - drag.offX) / W, 0.06, 0.94),
        y: clamp((p.y - drag.offY) / W, 0.06, 0.94)
      }))
      return
    }

    // 角点等比缩放：距离比例换算（横纵同步）
    if (drag.kind === 'scale') {
      const layer = layersRef.current.find(l => l.id === drag.id)
      if (!layer) return
      const k = sizeRef.current / 300
      const cx = layer.x * k
      const cy = layer.y * k
      const dist = Math.hypot(p.x - cx, p.y - cy)
      const f = clamp((dist / drag.startDist), 0.15, 4)
      layer.scaleX = clamp(drag.startScaleX * f, 0.15, 4)
      layer.scaleY = clamp(drag.startScaleY * f, 0.15, 4)
      redraw()
      return
    }

    // 右边中点横向拉伸：沿图层本地 x 轴投影比例换算
    if (drag.kind === 'stretchX') {
      const layer = layersRef.current.find(l => l.id === drag.id)
      if (!layer) return
      const k = sizeRef.current / 300
      const cx = layer.x * k
      const cy = layer.y * k
      const cosR = Math.cos(layer.rotation)
      const sinR = Math.sin(layer.rotation)
      const dx = p.x - cx
      const dy = p.y - cy
      const proj = dx * cosR + dy * sinR
      layer.scaleX = clamp((drag.startScaleX * proj) / drag.startProj, 0.15, 6)
      redraw()
      return
    }

    // 下边中点纵向拉伸：沿图层本地 y 轴投影比例换算
    if (drag.kind === 'stretchY') {
      const layer = layersRef.current.find(l => l.id === drag.id)
      if (!layer) return
      const k = sizeRef.current / 300
      const cx = layer.x * k
      const cy = layer.y * k
      const cosR = Math.cos(layer.rotation)
      const sinR = Math.sin(layer.rotation)
      const dx = p.x - cx
      const dy = p.y - cy
      const proj = -dx * sinR + dy * cosR
      layer.scaleY = clamp((drag.startScaleY * proj) / drag.startProj, 0.15, 6)
      redraw()
      return
    }

    // 手柄旋转：指针角度差换算
    if (drag.kind === 'rotate') {
      const layer = layersRef.current.find(l => l.id === drag.id)
      if (!layer) return
      const k = sizeRef.current / 300
      const cx = layer.x * k
      const cy = layer.y * k
      let rot = drag.startRotation + (Math.atan2(p.y - cy, p.x - cx) - drag.startPointerAngle)
      while (rot > Math.PI) rot -= Math.PI * 2
      while (rot < -Math.PI) rot += Math.PI * 2
      layer.rotation = rot
      redraw()
      return
    }

    const layer = layersRef.current.find(l => l.id === drag.id)
    if (!layer) return
    const px = toCanvas(p.x)
    const py = toCanvas(p.y)
    layer.x = clamp(px - drag.offX, -PART_HIT_RADIUS, 300 + PART_HIT_RADIUS)
    layer.y = clamp(py - drag.offY, -PART_HIT_RADIUS, 300 + PART_HIT_RADIUS)
    redraw()
  }

  const handleTouchEnd = () => {
    if (tool === 'brush') {
      const s = liveStrokeRef.current
      if (s && s.points.length === 1) {
        const ctx = ctxRef.current
        if (ctx) {
          if (s.mosaic) {
            drawMosaicStroke(ctx, s)
          } else {
            ctx.fillStyle = s.color
            ctx.beginPath()
            ctx.arc(s.points[0].x, s.points[0].y, s.size / 2, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      liveStrokeRef.current = null
      setStrokesCount(strokesRef.current.length)
      return
    }
    // 裁剪框选结束：保留草稿待应用/取消
    if (cropDraggingRef.current) {
      cropDraggingRef.current = false
      redraw()
      return
    }
    // 拖动/缩放/旋转结束：提交引用变更，让面板与调节窗口拿到最新值
    const drag = draggingRef.current
    if (drag && drag.kind !== 'text') {
      commitLayers([...layersRef.current])
    }
    draggingRef.current = null
  }

  const handleMouseDown = (e: ReactMouseEvent) => {
    handleTouchStart({ touches: [{ clientX: e.clientX, clientY: e.clientY }] })
  }
  const handleMouseMove = (e: ReactMouseEvent) => {
    handleTouchMove({ touches: [{ clientX: e.clientX, clientY: e.clientY }] })
  }
  const handleMouseUp = () => {
    handleTouchEnd()
  }
  const mouseProps = {
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseUp
  } as unknown as Record<string, never>

  // ---------- 上传 / 选择 ----------
  const refreshMine = () => {
    setMineStickers(listLocalStickers())
  }

  /** 上传成功后自动存入本地素材库（自动去重） */
  const saveUploadToLibrary = async (path: string, over: boolean) => {
    try {
      const isWeappEnv = process.env.TARO_ENV === 'weapp'
      let dataUrl: string | undefined
      if (!isWeappEnv && typeof path === 'string' && path.indexOf('data:') !== 0) {
        try {
          dataUrl = await blobToDataUrl(path)
        } catch (err) {
          console.warn('[Editor] H5 上传图转 dataURL 失败，仅本次可用', err)
        }
      }
      const rec = addLocalSticker({
        name: over ? '我的贴纸' : '我的底图',
        url: isWeappEnv ? undefined : (dataUrl || path),
        localPath: isWeappEnv ? path : undefined,
        dataUrl,
        over,
        source: 'upload'
      })
      refreshMine()
      if (!rec) console.info('[Editor] 素材已存在，跳过入库')
    } catch (err) {
      console.error('[Editor] 素材入库失败', err)
    }
  }

  const chooseUpload = (over: boolean) => {
    Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const path = res.tempFilePaths && res.tempFilePaths[0]
        if (path) {
          addImageLayer(path, over)
          saveUploadToLibrary(path, over)
        } else {
          Taro.showToast({ title: '未选择到图片', icon: 'none' })
        }
      },
      fail: err => {
        const msg = (err as { errMsg?: string }).errMsg || ''
        if (msg.indexOf('cancel') > -1 || msg.indexOf('Cancel') > -1) return
        console.error('[Editor] 相册选图失败', err)
        Taro.showToast({ title: '选图失败，请重试', icon: 'none' })
      }
    })
  }

  /** 把当前画面缩略图存入本地素材库 */
  const saveCanvasToLibrary = async () => {
    setShowActions(false)
    if (!ensureContent() || working) return
    const node = canvasRef.current
    if (!node) return
    setWorking(true)
    try {
      if (initRef.current) redraw()
      const res = await exportCanvasImage(node)
      const isWeappEnv = process.env.TARO_ENV === 'weapp'
      let rec: LocalSticker | null = null
      const name = `创作 ${dayjs().format('MM-DD HH:mm')}`
      if (isWeappEnv && res.filePath) {
        rec = addLocalSticker({ name, localPath: res.filePath, over: true, source: 'creation' })
      } else if (res.dataURL) {
        const thumb = await shrinkDataUrl(res.dataURL, 160)
        rec = addLocalSticker({ name, dataUrl: thumb, over: true, source: 'creation' })
      }
      refreshMine()
      Taro.showToast({ title: rec ? '已存入本地素材库' : '已保存（重复素材已跳过）', icon: 'success' })
    } catch (err) {
      console.error('[Editor] 存入素材库失败', err)
      Taro.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      setWorking(false)
    }
  }

  const confirmRemoveSticker = (rec: LocalSticker) => {
    Taro.showModal({
      title: '删除素材',
      content: `确定从素材库删除「${rec.name}」吗？`,
      success: r => {
        if (r.confirm) {
          removeLocalSticker(rec.id)
          refreshMine()
        }
      }
    })
  }

  // ---------- 素材库 ----------
  useEffect(() => {
    refreshMine()
  }, [])

  /** 点击网络素材：作为图片图层加入画布（可拖动/缩放/拉伸/调透明度），并自动收藏到本地素材库 */
  const addEmojiAsset = (s: StickerDef) => {
    const url = stickerImageUrl(s)
    addImageLayer(url, true)
    const rec = addLocalSticker({ name: s.name, url, over: true, source: 'net' })
    if (rec) {
      console.info('[Editor] 网络素材已收藏到本地素材库', s.name)
      refreshMine()
    }
  }

  // ---------- 画笔操作 ----------
  const undoStroke = () => {
    strokesRef.current.pop()
    setStrokesCount(strokesRef.current.length)
    redraw()
  }

  const clearStrokes = () => {
    if (!strokesRef.current.length) return
    strokesRef.current = []
    setStrokesCount(0)
    redraw()
  }

  // ---------- GIF 动图 ----------
  const ensureCaptureCanvas = async (): Promise<boolean> => {
    if (captureCtxRef.current) return true
    if (process.env.TARO_ENV !== 'weapp') return false
    try {
      let info: NodeQueryResult | null = null
      for (let i = 0; i < 15; i++) {
        try {
          info = await getCanvasNode('#gifCaptureCanvas')
          if (info && info.node) break
        } catch {
          // ignore
        }
        await delay(100)
      }
      if (!info || !info.node) return false
      info.node.width = CAPTURE_SIZE
      info.node.height = CAPTURE_SIZE
      captureNodeRef.current = info.node
      captureCtxRef.current = info.node.getContext('2d')
      return true
    } catch (err) {
      console.error('[GIF] 捕捉画布初始化失败', err)
      return false
    }
  }

  /** 把任一图片源绘制成 CAPTURE_SIZE 的帧数据（H5 用临时画布 / 小程序用离屏捕捉画布） */
  const rasterizeToFrame = async (source: CanvasImageSource): Promise<{ data: ImageData; thumb?: string } | null> => {
    if (process.env.TARO_ENV !== 'weapp' && typeof document !== 'undefined') {
      const tmp = document.createElement('canvas')
      tmp.width = CAPTURE_SIZE
      tmp.height = CAPTURE_SIZE
      const tctx = tmp.getContext('2d')
      if (!tctx) return null
      tctx.drawImage(source, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE)
      const thumbC = document.createElement('canvas')
      thumbC.width = 96
      thumbC.height = 96
      thumbC.getContext('2d')?.drawImage(source, 0, 0, 96, 96)
      return { data: tctx.getImageData(0, 0, CAPTURE_SIZE, CAPTURE_SIZE), thumb: thumbC.toDataURL('image/png') }
    }

    const ok = await ensureCaptureCanvas()
    if (ok && captureCtxRef.current) {
      try {
        captureCtxRef.current.clearRect(0, 0, CAPTURE_SIZE, CAPTURE_SIZE)
        captureCtxRef.current.drawImage(source, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE)
        return { data: captureCtxRef.current.getImageData(0, 0, CAPTURE_SIZE, CAPTURE_SIZE) }
      } catch (err) {
        console.error('[GIF] 离屏捕捉失败', err)
      }
    }
    return null
  }

  const captureFrame = async (): Promise<{ data: ImageData; thumb?: string } | null> => {
    const node = canvasRef.current
    const ctx = ctxRef.current
    if (!node || !ctx) return null

    if (process.env.TARO_ENV !== 'weapp' && typeof document !== 'undefined') {
      return rasterizeToFrame(node as unknown as CanvasImageSource)
    }

    const ok = await ensureCaptureCanvas()
    if (ok && captureCtxRef.current && captureNodeRef.current) {
      try {
        captureCtxRef.current.clearRect(0, 0, CAPTURE_SIZE, CAPTURE_SIZE)
        captureCtxRef.current.drawImage(node as unknown as CanvasImageSource, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE)
        return { data: captureCtxRef.current.getImageData(0, 0, CAPTURE_SIZE, CAPTURE_SIZE) }
      } catch (err) {
        console.error('[GIF] 离屏捕捉失败，使用全尺寸兜底', err)
      }
    }
    return { data: ctx.getImageData(0, 0, node.width, node.height) }
  }

  const addFrame = async () => {
    if (!hasContent) {
      Taro.showToast({ title: '先创作点什么再捕捉', icon: 'none' })
      return
    }
    if (framesRef.current.length >= MAX_FRAMES) {
      Taro.showToast({ title: `最多 ${MAX_FRAMES} 帧`, icon: 'none' })
      return
    }
    if (initRef.current) redraw()
    Taro.showLoading({ title: '捕捉中…', mask: true })
    try {
      const captured = await captureFrame()
      if (!captured) throw new Error('画布未就绪')
      const frame: GifFrame = {
        id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        data: captured.data,
        thumb: captured.thumb
      }
      framesRef.current = [...framesRef.current, frame]
      setFrames(framesRef.current)
      Taro.hideLoading()
      Taro.showToast({ title: `已加第 ${framesRef.current.length} 帧`, icon: 'success' })
    } catch (err) {
      console.error('[GIF] 捕捉帧失败', err)
      Taro.hideLoading()
      Taro.showToast({ title: '捕捉失败，请重试', icon: 'none' })
    }
  }

  const removeFrame = (id: string) => {
    framesRef.current = framesRef.current.filter(f => f.id !== id)
    setFrames(framesRef.current)
  }

  /** 从相册选择多张图片作为 GIF 帧 */
  const chooseImagesForFrames = () => {
    const remain = MAX_FRAMES - framesRef.current.length
    if (remain <= 0) {
      Taro.showToast({ title: `最多 ${MAX_FRAMES} 帧`, icon: 'none' })
      return
    }
    Taro.chooseImage({
      count: Math.min(9, remain),
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const paths = res.tempFilePaths || []
        if (!paths.length) {
          Taro.showToast({ title: '未选择到图片', icon: 'none' })
          return
        }
        importFramesFromImages(paths)
      },
      fail: err => {
        const msg = (err as { errMsg?: string }).errMsg || ''
        if (msg.indexOf('cancel') > -1 || msg.indexOf('Cancel') > -1) return
        console.error('[GIF] 选图失败', err)
        Taro.showToast({ title: '选图失败，请重试', icon: 'none' })
      }
    })
  }

  /** 把多张图片按选择顺序导入为 GIF 帧 */
  const importFramesFromImages = async (paths: string[]) => {
    const node = canvasRef.current
    if (!node || !initRef.current) {
      Taro.showToast({ title: '画布未就绪，请稍候', icon: 'none' })
      return
    }
    Taro.showLoading({ title: '导入中…', mask: true })
    let added = 0
    try {
      for (const p of paths) {
        if (framesRef.current.length >= MAX_FRAMES) break
        const localPath = await resolveImageSrc(p)
        const img = await loadCanvasImage(node, localPath)
        const captured = await rasterizeToFrame(img as unknown as CanvasImageSource)
        if (!captured) continue
        framesRef.current = [
          ...framesRef.current,
          {
            id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            data: captured.data,
            thumb: captured.thumb
          }
        ]
        added++
      }
      Taro.hideLoading()
      Taro.showToast({ title: added ? `已导入 ${added} 帧` : '导入失败', icon: added ? 'success' : 'none' })
    } catch (err) {
      console.error('[GIF] 导入图片帧失败', err)
      Taro.hideLoading()
      Taro.showToast({ title: added ? `已导入 ${added} 帧，部分失败` : '导入失败，请重试', icon: 'none' })
    } finally {
      setFrames(framesRef.current)
    }
  }

  const clearFrames = () => {
    if (!framesRef.current.length && !gifResult) return
    framesRef.current = []
    setFrames([])
    setGifResult(null)
  }

  const moveFrame = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= framesRef.current.length) return
    const next = [...framesRef.current]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    framesRef.current = next
    setFrames(next)
  }

  const generateGif = async () => {
    if (gifBusy) return
    if (framesRef.current.length < 2) {
      Taro.showToast({ title: '至少捕捉两帧哦', icon: 'none' })
      return
    }
    setGifBusy(true)
    try {
      const encoder = GIFEncoder()
      for (const frame of framesRef.current) {
        const palette = quantize(frame.data.data, 256)
        const index = applyPalette(frame.data.data, palette)
        encoder.writeFrame(index, frame.data.width, frame.data.height, { palette, delay: frameDelay })
      }
      encoder.finish()
      const bytes = encoder.bytes()

      if (process.env.TARO_ENV === 'weapp') {
        const base64 = Taro.arrayBufferToBase64(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        )
        const env = (Taro as unknown as { env?: { USER_DATA_PATH?: string } }).env
        const dir = env?.USER_DATA_PATH || 'wxfile://usr'
        const path = `${dir}/emoji-gif-${Date.now()}.gif`
        Taro.getFileSystemManager().writeFileSync(path, base64, 'base64')
        setGifResult({ url: path })
      } else {
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)))
        }
        setGifResult({ url: `data:image/gif;base64,${btoa(binary)}` })
      }
      console.info('[GIF] 合成完成，大小', bytes.length)
      Taro.showToast({ title: 'GIF 已生成', icon: 'success' })
    } catch (err) {
      console.error('[GIF] 合成失败', err)
      Taro.showToast({ title: '合成失败，请重试', icon: 'none' })
    } finally {
      setGifBusy(false)
    }
  }

  const handleGifSaveMine = async () => {
    if (!gifResult || working) return
    setWorking(true)
    try {
      const fileID = await uploadImageFile(
        process.env.TARO_ENV === 'weapp' ? { filePath: gifResult.url } : { dataURL: gifResult.url },
        'gif'
      )
      const item = await uploadMyEmoji({
        fileID,
        name: `GIF表情 ${dayjs().format('MM月DD日 HH:mm')}`,
        tags: []
      })
      console.info('[GIF] 已存入我的表情', item.id)
      Taro.showToast({ title: '已存入我的表情', icon: 'success' })
    } catch (err) {
      console.error('[GIF] 存入我的表情失败', err)
      Taro.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      setWorking(false)
    }
  }

  const handleGifSave = async () => {
    if (!gifResult || working) return
    if (process.env.TARO_ENV !== 'weapp') {
      try {
        const a = document.createElement('a')
        a.href = gifResult.url
        a.download = `emoji-${Date.now()}.gif`
        document.body.appendChild(a)
        a.click()
        a.remove()
        Taro.showToast({ title: '已保存到本地下载', icon: 'success' })
      } catch (err) {
        console.error('[GIF] H5 保存失败', err)
        Taro.showToast({ title: '保存失败', icon: 'none' })
      }
      return
    }
    setWorking(true)
    try {
      await Taro.saveImageToPhotosAlbum({ filePath: gifResult.url })
      Taro.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (err) {
      console.error('[GIF] 保存相册失败', err)
      const msg = (err as { errMsg?: string }).errMsg || ''
      if (msg.indexOf('auth') > -1 || msg.indexOf('deny') > -1) {
        Taro.showModal({
          title: '需要相册权限',
          content: '请在设置中允许「保存图片到相册」',
          confirmText: '去设置',
          success: r => {
            if (r.confirm) Taro.openSetting()
          }
        })
      } else {
        Taro.showModal({
          title: '保存失败',
          content: '当前设备可能不支持保存 GIF 到相册，可先「存入我的表情」再从聊天里长按添加为微信表情。',
          showCancel: false
        })
      }
    } finally {
      setWorking(false)
    }
  }

  // ---------- 导出与保存 ----------
  const ensureContent = (): boolean => {
    if (hasContent) return true
    Taro.showToast({ title: '先创作点什么吧', icon: 'none' })
    return false
  }

  const exportResult = async (): Promise<ExportResult | null> => {
    const node = canvasRef.current
    if (!node) return null
    try {
      return await exportCanvasImage(node)
    } catch (err) {
      console.error('[Editor] 导出画布失败', err)
      Taro.showToast({ title: '导出失败，请重试', icon: 'none' })
      return null
    }
  }

  const handleSaveAlbum = async () => {
    setShowActions(false)
    if (!ensureContent() || working) return
    setWorking(true)
    const res = await exportResult()
    if (!res || (!res.filePath && !res.dataURL)) {
      setWorking(false)
      return
    }

    if (process.env.TARO_ENV !== 'weapp') {
      try {
        if (res.dataURL && typeof document !== 'undefined') {
          const a = document.createElement('a')
          a.href = res.dataURL
          a.download = `emoji-${Date.now()}.png`
          document.body.appendChild(a)
          a.click()
          a.remove()
        }
        Taro.showToast({ title: '已保存到本地下载', icon: 'success' })
      } catch (err) {
        console.error('[Editor] H5 保存失败', err)
        Taro.showToast({ title: '保存失败', icon: 'none' })
      } finally {
        setWorking(false)
      }
      return
    }

    try {
      await Taro.saveImageToPhotosAlbum({ filePath: res.filePath as string })
      console.info('[Editor] 已保存到相册')
      Taro.showModal({
        title: '已保存到相册',
        content: '添加到微信表情：① 聊天输入框点「+」→ 相册，发送这张图；② 长按已发送的图片 → 「添加到表情」。之后聊天里就能直接用了。',
        confirmText: '知道了',
        showCancel: false
      })
    } catch (err) {
      console.error('[Editor] 保存相册失败', err)
      const msg = (err as { errMsg?: string }).errMsg || ''
      if (msg.indexOf('auth') > -1 || msg.indexOf('deny') > -1) {
        Taro.showModal({
          title: '需要相册权限',
          content: '请在设置中允许「保存图片到相册」',
          confirmText: '去设置',
          success: r => {
            if (r.confirm) Taro.openSetting()
          }
        })
      } else {
        Taro.showToast({ title: '保存失败', icon: 'none' })
      }
    } finally {
      setWorking(false)
    }
  }

  const handleSaveMine = async () => {
    setShowActions(false)
    if (!ensureContent() || working) return
    setWorking(true)
    try {
      const res = await exportResult()
      if (!res) return
      const fileID = await uploadImageFile(res)
      const item = await uploadMyEmoji({
        fileID,
        name: `捏脸表情 ${dayjs().format('MM月DD日 HH:mm')}`,
        tags: []
      })
      console.info('[Editor] 已存入我的表情', item.id)
      Taro.showToast({ title: '已存入我的表情', icon: 'success' })
    } catch (err) {
      console.error('[Editor] 存入我的表情失败', err)
      Taro.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      setWorking(false)
    }
  }

  // ---------- 分享 ----------
  useShareAppMessage(() => ({
    title: '我用「AI表情包工坊」捏了个表情，快来一起玩！',
    path: '/pages/editor/index'
  }))

  // ---------- 部件选项渲染 ----------
  const renderPartOptions = () => {
    const options = getPartsByKind(emojiTab as PartKind)
    return (
      <View className={styles.partGrid}>
        {options.map(opt => (
          <View
            key={opt.id}
            className={styles.partCard}
            onClick={() => addPartLayer(opt.id)}
          >
            <Text className={styles.partIcon}>{opt.icon}</Text>
            <Text className={styles.partLabel}>{opt.label}</Text>
          </View>
        ))}
      </View>
    )
  }

  // ---------- 选中层工具条 + 调节窗口 ----------
  const selectedLayer = useMemo(
    () => layers.find(l => l.id === selectedId) || null,
    [layers, selectedId]
  )

  const renderLayerToolbar = () => {
    if (!selectedLayer || cropping) return null
    const label = selectedLayer.type === 'part'
      ? `${getPartKindLabel(selectedLayer.kind)} · ${getPartById(selectedLayer.partId)?.label || '部件'}`
      : '图片图层'
    return (
      <View className={styles.toolCard}>
        <View className={styles.layerCtrlHeader}>
          <Text className={styles.layerCtrlTitle}>{label}</Text>
          <View className={styles.layerCtrlOps}>
            <Text className={styles.layerOp} onClick={() => setShowAdjust(true)}>🎛 调节</Text>
            <Text className={styles.layerOp} onClick={() => moveLayer(selectedLayer.id, -1)}>⬆</Text>
            <Text className={styles.layerOp} onClick={() => moveLayer(selectedLayer.id, 1)}>⬇</Text>
            <Text className={classnames(styles.layerOp, styles.layerOpDel)} onClick={() => removeLayer(selectedLayer.id)}>🗑</Text>
          </View>
        </View>
        <Text className={styles.toolNote}>画布上拖动移动 · 右下白点缩放 · 右/下蓝点拉伸压扁 · 顶部橙点旋转</Text>
      </View>
    )
  }

  /** 图层调节窗口（透明度 / 亮度 / 灰度 + 图片层裁剪；旋转用画布顶部橙点手动拖） */
  const renderAdjustSheet = () => {
    if (!showAdjust || !selectedLayer) return null
    const l = selectedLayer
    return (
      <View className={styles.mask} onClick={() => setShowAdjust(false)}>
        <View className={styles.adjustSheet} onClick={e => e.stopPropagation()}>
          <View className={styles.adjustHeader}>
            <Text className={styles.adjustTitle}>🎛 图层调节</Text>
            <Text className={styles.adjustClose} onClick={() => setShowAdjust(false)}>✕</Text>
          </View>

          <View className={styles.sliderRow}>
            <Text className={styles.sliderLabel}>透明度 {Math.round(l.opacity * 100)}%</Text>
            <View className={styles.sliderBox} {...sliderMouseProps(0, 100, 1, v => updateLayer(l.id, { opacity: v / 100 }))}>
              <Slider
                className={styles.slider}
                min={0}
                max={100}
                value={Math.round(l.opacity * 100)}
                activeColor='#FF6B35'
                blockColor='#FF6B35'
                onChange={e => updateLayer(l.id, { opacity: Number(e.detail.value) / 100 })}
              />
            </View>
          </View>
          <View className={styles.sliderRow}>
            <Text className={styles.sliderLabel}>亮度 {Math.round((l.brightness ?? 1) * 100)}%</Text>
            <View className={styles.sliderBox} {...sliderMouseProps(40, 180, 1, v => updateLayer(l.id, { brightness: v / 100 }))}>
              <Slider
                className={styles.slider}
                min={40}
                max={180}
                value={Math.round((l.brightness ?? 1) * 100)}
                activeColor='#FF6B35'
                blockColor='#FF6B35'
                onChange={e => updateLayer(l.id, { brightness: Number(e.detail.value) / 100 })}
              />
            </View>
          </View>
          <View className={styles.sliderRow}>
            <Text className={styles.sliderLabel}>灰度 {Math.round((l.grayscale ?? 0) * 100)}%</Text>
            <View className={styles.sliderBox} {...sliderMouseProps(0, 100, 1, v => updateLayer(l.id, { grayscale: v / 100 }))}>
              <Slider
                className={styles.slider}
                min={0}
                max={100}
                value={Math.round((l.grayscale ?? 0) * 100)}
                activeColor='#FF6B35'
                blockColor='#FF6B35'
                onChange={e => updateLayer(l.id, { grayscale: Number(e.detail.value) / 100 })}
              />
            </View>
          </View>

          {l.type === 'image' && (
            <View className={styles.stickerOps}>
              <View
                className={classnames(styles.miniBtn, (l as ImageLayer).circle && styles.miniBtnActive)}
                onClick={() => updateLayer(l.id, { circle: !(l as ImageLayer).circle })}
              >
                <Text>{(l as ImageLayer).circle ? '⭕ 已裁圆' : '⭕ 裁成圆'}</Text>
              </View>
              <View
                className={styles.miniBtn}
                onClick={enterCrop}
              >
                <Text>✂️ 裁剪</Text>
              </View>
              <View
                className={styles.miniBtn}
                onClick={() => updateLayer(l.id, { over: !(l as ImageLayer).over })}
              >
                <Text>{(l as ImageLayer).over ? '⬇️ 设为底图' : '⬆️ 置顶显示'}</Text>
              </View>
            </View>
          )}

          {l.type === 'part' && (l.kind === 'face' || l.kind === 'body' || (l.partId || '').indexOf('ears-') === 0) && (
            <View className={styles.colorRow}>
              <Text className={styles.colorLabel}>颜色</Text>
              {FACE_COLORS.map(color => (
                <View
                  key={color}
                  className={classnames(styles.colorDot, (l as PartLayer).color === color && styles.colorDotActive)}
                  style={{ backgroundColor: color }}
                  onClick={() => updateLayer(l.id, { color })}
                />
              ))}
            </View>
          )}

          <Text className={styles.toolNote}>调整实时生效，关闭窗口自动保留</Text>
        </View>
      </View>
    )
  }

  const renderLayerList = () => {
    if (!layers.length) return null
    return (
      <View className={styles.layerList}>
        <View className={styles.layerListHeader}>
          <Text className={styles.layerListTitle}>图层（{layers.length}）</Text>
          <Text className={styles.layerListToggle} onClick={() => setShowLayerPanel(v => !v)}>
            {showLayerPanel ? '收起 ⌃' : '展开 ⌄'}
          </Text>
        </View>
        {showLayerPanel ? (
          <ScrollView className={styles.layerListScroll} scrollX enhanced showScrollbar={false}>
            {layers.map((l, i) => {
              const isSel = l.id === selectedId
              const label = l.type === 'part'
                ? `${getPartKindLabel(l.kind)}·${getPartById(l.partId)?.label || '?'}`
                : '图片'
              const icon = l.type === 'part'
                ? (getPartById(l.partId)?.icon || '🧩')
                : '🖼'
              return (
                <View
                  key={l.id}
                  className={classnames(styles.layerChip, isSel && styles.layerChipActive)}
                  onClick={() => {
                    selectedRef.current = l.id
                    setSelectedId(l.id)
                    redraw()
                  }}
                >
                  <Text className={styles.layerChipIcon}>{icon}</Text>
                  <Text className={styles.layerChipLabel}>#{i + 1} {label}</Text>
                </View>
              )
            })}
          </ScrollView>
        ) : null}
      </View>
    )
  }

  // ---------- 渲染 ----------
  return (
    <View className={styles.page}>
      <View className={styles.header}>
        <Text className={styles.title}>创作工坊 🎨</Text>
        <Text className={styles.subtitle}>点部件添加图层 · 拖动调整 · 像P图一样自由组合</Text>
      </View>

      {/* 画布 */}
      <View className={styles.canvasCard}>
        <Canvas
          type='2d'
          id='editorCanvas'
          className={styles.canvas}
          style={{ width: `${canvasSize - 32}px`, height: `${canvasSize - 32}px` }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          {...mouseProps}
        />
        {!hasContent ? (
          <View className={styles.canvasHint}>
            <Text className={styles.canvasHintIcon}>🧑‍🎨</Text>
            <Text className={styles.canvasHintText}>从下方选部件点一下添加，可叠加多个</Text>
          </View>
        ) : null}
        {hasContent && tool === 'brush' ? (
          <View className={styles.dragTip}>
            {mosaicMode ? '🟧 马赛克笔：拖动涂抹方格打码' : '画笔模式：拖动涂鸦'}
          </View>
        ) : null}
        {selectedLayer ? (
          <View className={styles.dragTip}>
            拖动移动 · 白点缩放 · 蓝点拉扁 · 橙点旋转
          </View>
        ) : null}
      </View>

      {/* 图层列表 */}
      {renderLayerList()}

      {/* 工具页签 */}
      <View className={styles.toolTabs}>
        {TOOL_TABS.map(tab => (
          <View
            key={tab.key}
            className={classnames(styles.toolTab, tool === tab.key && styles.toolTabActive)}
            onClick={() => setTool(tab.key)}
          >
            <Text className={styles.toolTabIcon}>{tab.icon}</Text>
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* 选中层控制面板（始终显示在工具卡上方） */}
      {selectedLayer ? renderLayerToolbar() : null}

      {/* 图层调节窗口 */}
      {renderAdjustSheet()}

      {/* 裁剪操作条（框选中） */}
      {cropping && (
        <View className={styles.toolCard}>
          <Text className={styles.layerTitle}>✂️ 裁剪图片</Text>
          <Text className={styles.toolNote}>在画布上按住拖动，框选要保留的区域（框外变暗）</Text>
          <View className={styles.stickerOps}>
            <View className={styles.miniBtn} onClick={exitCrop}>
              <Text>✕ 取消</Text>
            </View>
            <View className={classnames(styles.miniBtn, styles.miniBtnActive)} onClick={applyCrop}>
              <Text>✓ 应用裁剪</Text>
            </View>
          </View>
        </View>
      )}

      {/* 捏表情面板（部件 + 素材库 + 我的素材） */}
      {tool === 'emoji' ? (
        <View className={styles.toolCard}>
          <Text className={styles.layerTitle}>点选部件/素材添加为图层（同类可叠加）</Text>
          <View className={styles.partTabs}>
            {PART_KIND_LIST.map(k => (
              <View
                key={k.key}
                className={classnames(styles.partTab, emojiTab === k.key && styles.partTabActive)}
                onClick={() => setEmojiTab(k.key)}
              >
                <Text>{k.label}</Text>
              </View>
            ))}
            <View
              className={classnames(styles.partTab, emojiTab === 'asset' && styles.partTabActive)}
              onClick={() => setEmojiTab('asset')}
            >
              <Text>🖼 素材</Text>
            </View>
            <View
              className={classnames(styles.partTab, emojiTab === 'mine' && styles.partTabActive)}
              onClick={() => setEmojiTab('mine')}
            >
              <Text>⭐ 我的</Text>
            </View>
          </View>

          {emojiTab === 'asset' ? (
            <View>
              <View className={styles.partTabs}>
                {STICKER_CATEGORIES.map(c => (
                  <View
                    key={c.key}
                    className={classnames(styles.partTab, assetCat === c.key && styles.partTabActive)}
                    onClick={() => setAssetCat(c.key)}
                  >
                    <Text>{c.icon} {c.label}</Text>
                  </View>
                ))}
              </View>
              <View className={styles.stickerGrid}>
                {getStickersByCategory(assetCat).map(s => (
                  <View key={s.id} className={styles.stickerCell} onClick={() => addEmojiAsset(s)}>
                    <Image className={styles.stickerImg} src={stickerImageUrl(s)} mode='aspectFill' lazyLoad />
                    <Text className={styles.stickerName}>{s.name}</Text>
                  </View>
                ))}
              </View>
              <Text className={styles.toolNote}>点按加入画布，之后可拖动、缩放、拉伸、调透明度。</Text>
            </View>
          ) : null}

          {emojiTab === 'mine' ? (
            <View>
              <View className={styles.stickerOps}>
                <View className={styles.miniBtn} onClick={() => chooseUpload(true)}>
                  <Text>🖼️ 上传图片捏表情</Text>
                </View>
                <View className={styles.miniBtn} onClick={() => chooseUpload(false)}>
                  <Text>📸 上传照片做底图</Text>
                </View>
              </View>
              {mineStickers.length ? (
                <View className={styles.stickerGrid}>
                  {mineStickers.map(rec => (
                    <View
                      key={rec.id}
                      className={styles.stickerCell}
                      onClick={() => addImageLayer(stickerRecordSrc(rec), rec.over)}
                      onLongPress={() => confirmRemoveSticker(rec)}
                    >
                      <Image className={styles.stickerImg} src={stickerRecordSrc(rec)} mode='aspectFill' lazyLoad />
                      <Text className={styles.stickerName}>
                        {rec.source === 'creation' ? '🎨 创作' : rec.source === 'net' ? '⭐ 收藏' : '📤 上传'}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className={styles.toolNote}>
                  「我的」还是空的：上传图片或点上方素材，会自动存入本地素材库。
                </Text>
              )}
              {mineStickers.length ? (
                <Text className={styles.toolNote}>点按加入画布编辑，长按可删除素材。</Text>
              ) : null}
            </View>
          ) : null}

          {emojiTab !== 'asset' && emojiTab !== 'mine' ? (
            <View>
              {renderPartOptions()}
              <View className={styles.colorRow}>
                <Text className={styles.colorLabel}>背景</Text>
                {BG_COLORS.map(color => (
                  <View
                    key={color}
                    className={classnames(styles.colorDot, bgColor === color && styles.colorDotActive)}
                    style={{ backgroundColor: color }}
                    onClick={() => setBgColor(color)}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 文字贴纸面板 */}
      {tool === 'text' ? (
        <View className={styles.toolCard}>
          <View className={styles.toolHeader}>
            <Text className={styles.toolTitle}>文字贴纸</Text>
            <View
              className={classnames(styles.toggleBtn, text.enabled && styles.toggleBtnOn)}
              onClick={() => setText(v => ({ ...v, enabled: !v.enabled }))}
            >
              <Text className={styles.toggleText}>{text.enabled ? '已开启' : '添加文字'}</Text>
            </View>
          </View>
          {text.enabled ? (
            <View>
              <Input
                className={styles.textInput}
                value={text.content}
                maxlength={20}
                placeholder='输入表情包文字（最多20字）'
                onInput={e => setText(v => ({ ...v, content: e.detail.value }))}
              />
              <View className={styles.colorRow}>
                {TEXT_COLORS.map((color, idx) => (
                  <View
                    key={color}
                    className={classnames(styles.colorDot, text.colorIdx === idx && styles.colorDotActive)}
                    style={{ backgroundColor: color }}
                    onClick={() => setText(v => ({ ...v, colorIdx: idx }))}
                  />
                ))}
              </View>
              <View className={styles.sliderRow}>
                <Text className={styles.sliderLabel}>字号 {text.fontSize}</Text>
                <View className={styles.sliderBox} {...sliderMouseProps(16, 44, 2, v => setText(prev => ({ ...prev, fontSize: v })))}>
                  <Slider
                    className={styles.slider}
                    min={16}
                    max={44}
                    step={2}
                    value={text.fontSize}
                    activeColor='#FF6B35'
                    blockColor='#FF6B35'
                    onChange={e => setText(v => ({ ...v, fontSize: Number(e.detail.value) }))}
                  />
                </View>
              </View>
              <Text className={styles.toolNote}>在画布上拖动文字可调整位置。</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 画笔涂鸦面板 */}
      {tool === 'brush' ? (
        <View className={styles.toolCard}>
          <View className={styles.toolHeader}>
            <Text className={styles.toolTitle}>画笔涂鸦</Text>
            <View
              className={classnames(styles.toggleBtn, mosaicMode && styles.toggleBtnOn)}
              onClick={() => setMosaicMode(v => !v)}
            >
              <Text className={styles.toggleText}>{mosaicMode ? '🟧 马赛克笔 已开' : '🟦 普通笔'}</Text>
            </View>
          </View>
          <View className={styles.colorRow}>
            {BRUSH_COLORS.map((color, idx) => (
              <View
                key={color}
                className={classnames(styles.colorDot, brushColorIdx === idx && styles.colorDotActive)}
                style={{ backgroundColor: color }}
                onClick={() => setBrushColorIdx(idx)}
              />
            ))}
          </View>
          <View className={styles.sliderRow}>
            <Text className={styles.sliderLabel}>粗细 {brushSize}</Text>
            <View className={styles.sliderBox} {...sliderMouseProps(2, 20, 2, v => setBrushSize(v))}>
              <Slider
                className={styles.slider}
                min={2}
                max={20}
                step={2}
                value={brushSize}
                activeColor='#FF6B35'
                blockColor='#FF6B35'
                onChange={e => setBrushSize(Number(e.detail.value))}
              />
            </View>
          </View>
          <View className={styles.brushOps}>
            <View className={styles.miniBtn} onClick={undoStroke}>
              <Text>↩ 撤销</Text>
            </View>
            <View className={styles.miniBtn} onClick={clearStrokes}>
              <Text>清空涂鸦</Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* GIF 动画面板 */}
      {tool === 'gif' ? (
        <View className={styles.toolCard}>
          <View className={styles.toolHeader}>
            <Text className={styles.toolTitle}>GIF 动图</Text>
            <Text className={styles.toolBadge}>{frames.length}/{MAX_FRAMES} 帧</Text>
          </View>
          <Text className={styles.toolNote}>
            玩法：① 画布摆好造型 → 捕捉一帧 → 换个部件/挪一挪 → 再捕捉；② 或直接「多图转GIF」一次选多张图片按顺序生成动图。攒够两帧以上就能合成。
          </Text>
          <View className={styles.gifOps}>
            <View className={styles.miniBtn} onClick={addFrame}>
              <Text>📸 捕捉当前帧</Text>
            </View>
            <View className={styles.miniBtn} onClick={chooseImagesForFrames}>
              <Text>🖼️ 多图转GIF</Text>
            </View>
            <View className={styles.miniBtn} onClick={clearFrames}>
              <Text>清空帧</Text>
            </View>
          </View>

          {frames.length ? (
            <ScrollView className={styles.frameScroll} scrollX enhanced showScrollbar={false}>
              {frames.map((f, i) => (
                <View key={f.id} className={styles.frameItem}>
                  {f.thumb ? (
                    <Image className={styles.frameThumb} src={f.thumb} mode='aspectFill' />
                  ) : (
                    <View className={styles.frameThumbFallback}>
                      <Text>{i + 1}</Text>
                    </View>
                  )}
                  <Text className={styles.frameIdx}>#{i + 1}</Text>
                  <View className={styles.frameOps}>
                    <Text className={styles.frameOp} onClick={() => moveFrame(i, -1)}>◀</Text>
                    <Text className={styles.frameOp} onClick={() => moveFrame(i, 1)}>▶</Text>
                    <Text className={classnames(styles.frameOp, styles.frameOpDel)} onClick={() => removeFrame(f.id)}>✕</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : null}

          <View className={styles.sliderRow}>
            <Text className={styles.sliderLabel}>每帧 {frameDelay}ms</Text>
            <View className={styles.sliderBox} {...sliderMouseProps(100, 1000, 50, v => setFrameDelay(v))}>
              <Slider
                className={styles.slider}
                min={100}
                max={1000}
                step={50}
                value={frameDelay}
                activeColor='#FF6B35'
                blockColor='#FF6B35'
                onChange={e => setFrameDelay(Number(e.detail.value))}
              />
            </View>
          </View>

          <View className={classnames(styles.gifGenBtn, (gifBusy || frames.length < 2) && styles.btnDisabled)} onClick={generateGif}>
            <Text className={styles.gifGenText}>{gifBusy ? '合成中…' : '🎬 合成 GIF'}</Text>
          </View>

          {gifResult ? (
            <View className={styles.gifPreview}>
              <Image className={styles.gifPreviewImg} src={gifResult.url} mode='aspectFit' />
              <View className={styles.stickerOps}>
                <View className={styles.miniBtn} onClick={handleGifSave}>
                  <Text>💾 保存</Text>
                </View>
                <View className={styles.miniBtn} onClick={handleGifSaveMine}>
                  <Text>⭐ 存入我的表情</Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ height: '180rpx' }} />

      {/* 底部操作栏 */}
      <View className={styles.bottomBar}>
        <View className={styles.albumBtn} onClick={() => chooseUpload(false)}>
          <Text className={styles.albumBtnText}>📷 上传照片</Text>
        </View>
        <View className={classnames(styles.saveBtn, working && styles.btnDisabled)} onClick={() => setShowActions(true)}>
          <Text className={styles.saveBtnText}>{working ? '处理中…' : '保存/发布'}</Text>
        </View>
      </View>

      {/* 保存/发布 操作面板 */}
      {showActions ? (
        <View className={styles.mask} onClick={() => setShowActions(false)}>
          <View className={styles.actionSheet} onClick={e => e.stopPropagation()}>
            <Text className={styles.actionTitle}>保存与分享</Text>
            <View className={styles.actionItem} onClick={handleSaveAlbum}>
              <Text>保存到相册 / 本地</Text>
            </View>
            <View className={styles.actionItem} onClick={handleSaveMine}>
              <Text>存入我的表情</Text>
            </View>
            <View className={styles.actionItem} onClick={saveCanvasToLibrary}>
              <Text>⭐ 存入素材库（我的）</Text>
            </View>
            <View className={styles.actionCancel} onClick={() => setShowActions(false)}>
              <Text>取消</Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* 小程序端 GIF 离屏捕捉画布 */}
      {process.env.TARO_ENV === 'weapp' ? (
        <Canvas
          type='2d'
          id='gifCaptureCanvas'
          className={styles.captureCanvas}
          style={{ width: `${CAPTURE_SIZE}px`, height: `${CAPTURE_SIZE}px` }}
        />
      ) : null}
    </View>
  )
}

function getPartKindLabel(kind: PartKind): string {
  const t = PART_KIND_LIST.find(k => k.key === kind)
  return t ? t.label : kind
}

export default EditorPage
