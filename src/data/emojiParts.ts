// ============================================
// 表情部件库（参考微信创意表情包的部件拆分思路）
// 全部使用 Canvas 2D 路径程序化绘制（小程序 canvas 不支持画 SVG）
// 绘制坐标系：300 x 300
// 页面调用时先 ctx.scale(k, k)，k = 画布尺寸 / 300
// ============================================
// 部件以"层"为单位：每个部件可独立添加、拖动、缩放、旋转、调透明度，
// 同一类部件（如多对眉毛、多张嘴）可并存。

const INK = '#33322E'
const MOUTH_INK = '#7B463B'
const PINK = '#FF8FA3'
const BLUSH = '#FFA8B8'
const TEAR = '#7EC8FF'
const HEART = '#FF5B7A'
const STAR = '#FFC53D'

interface Ctx {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineCap: string
  lineJoin: string
  globalAlpha: number
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  ellipse(x: number, y: number, rx: number, ry: number, rot?: number, a0?: number, a1?: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
  rect(x: number, y: number, w: number, h: number): void
  fill(): void
  stroke(): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  scale(x: number, y: number): void
  setLineDash(segments: number[]): void
  strokeRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  drawImage(image: unknown, sx: number, sy: number, sw?: number, sh?: number): void
  clip(): void
}

/** 部件类型（用于"层"的分类，决定自然中心与是否可变色） */
export type PartKind = 'face' | 'eye' | 'brow' | 'mouth' | 'body' | 'accessory'

/** 部件定义：每个部件在 300x300 坐标系中有自己的"自然中心"，
 *  添加为图层时默认 x/y = naturalCenter；
 *  用户拖动时移动 (x,y) 即移动自然中心；
 *  缩放/旋转围绕自然中心进行。 */
export interface PartDef {
  id: string
  kind: PartKind
  label: string
  /** 选择面板上的 emoji 图标 */
  icon: string
  /** 在 300x300 坐标系中的"自然中心"（添加图层时的默认中心） */
  naturalCenter: { x: number; y: number }
  /** 是否支持改色（脸型需要） */
  colorable: boolean
  /** 绘制函数：在 300x300 坐标系绘制（绝对坐标），
   *  实际渲染时会包一层变换把 naturalCenter 平移到 (0,0) */
  draw: (ctx: Ctx, color: string) => void
}

/** 图层（部件层）：每个添加的五官都是一个独立图层 */
export interface PartLayer {
  id: string
  type: 'part'
  partId: string
  kind: PartKind
  /** 中心点（300x300 坐标系） */
  x: number
  y: number
  /** 非等比缩放：横向/纵向独立（1=原始，支持拉伸/压扁） */
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  /** 脸型/可变色部件的颜色 */
  color?: string
  /** 调节（P图效果）：亮度 1=原始 / 灰度 0=原始 / 马赛克 0=关闭 */
  brightness?: number
  grayscale?: number
  mosaic?: number
  visible: boolean
}

/** 图层（图片层）：用户上传的贴纸/底图 */
export interface ImageLayer {
  id: string
  type: 'image'
  img: import('@/utils/canvas').CanvasImage
  /** 原始尺寸 */
  w: number
  h: number
  /** 中心点（300x300 坐标系） */
  x: number
  y: number
  /** 非等比缩放：横向/纵向独立（1=原始，支持拉伸/压扁） */
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  /** 调节（P图效果）：亮度 1=原始 / 灰度 0=原始 / 马赛克 0=关闭 */
  brightness?: number
  grayscale?: number
  mosaic?: number
  /** 裁成圆形 */
  circle: boolean
  /** 裁剪区域（原图归一化坐标 x0/y0/x1/y1，0-1；不填表示整图） */
  crop?: { x0: number; y0: number; x1: number; y1: number }
  /** true=贴纸(在五官上层) false=底图(在五官下层) */
  over: boolean
  visible: boolean
}

export type AnyLayer = PartLayer | ImageLayer

// ---------- 通用小工具 ----------

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, color = INK): void {
  ctx.strokeStyle = color
  ctx.lineWidth = w
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function qcurve(ctx: Ctx, x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, w: number, color = INK): void {
  ctx.strokeStyle = color
  ctx.lineWidth = w
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo(cx, cy, x2, y2)
  ctx.stroke()
}

function heartPath(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.beginPath()
  ctx.moveTo(cx, cy + s)
  ctx.bezierCurveTo(cx - s, cy, cx - s, cy - s * 1.2, cx, cy - s * 0.35)
  ctx.bezierCurveTo(cx + s, cy - s * 1.2, cx + s, cy, cx, cy + s)
  ctx.closePath()
}

function starPath(ctx: Ctx, cx: number, cy: number, ro: number, ri: number): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 === 0 ? ro : ri
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
  ctx.lineTo(x + w, y + h - r)
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
  ctx.lineTo(x + r, y + h)
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
  ctx.lineTo(x, y + r)
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
  ctx.closePath()
}

function shade(hex: string, f: number): string {
  const n = hex.replace('#', '')
  const full = n.length === 3 ? n.split('').map(c => c + c).join('') : n
  const v = parseInt(full, 16)
  const r = Math.min(255, Math.round(((v >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((v >> 8) & 255) * f))
  const b = Math.min(255, Math.round((v & 255) * f))
  return `rgb(${r},${g},${b})`
}

function drop(ctx: Ctx, cx: number, top: number, s: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, top)
  ctx.bezierCurveTo(cx + s, top + s * 0.9, cx + s * 0.9, top + s * 1.7, cx, top + s * 1.7)
  ctx.bezierCurveTo(cx - s * 0.9, top + s * 1.7, cx - s, top + s * 0.9, cx, top)
  ctx.closePath()
  ctx.fill()
}

// ---------- 脸型 ----------

const FACE_PARTS: PartDef[] = [
  { id: 'round', kind: 'face', label: '圆圆', icon: '⚪', naturalCenter: { x: 150, y: 165 }, colorable: true,
    draw: ctx => {
      circle(ctx, 150, 165, 95); ctx.fill(); ctx.stroke()
    } },
  { id: 'squish', kind: 'face', label: '扁扁', icon: '🥞', naturalCenter: { x: 150, y: 172 }, colorable: true,
    draw: ctx => {
      ctx.beginPath()
      ctx.ellipse(150, 172, 108, 85, 0, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()
    } },
  { id: 'egg', kind: 'face', label: '蛋蛋', icon: '🥚', naturalCenter: { x: 150, y: 162 }, colorable: true,
    draw: ctx => {
      ctx.beginPath()
      ctx.ellipse(150, 162, 86, 103, 0, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()
    } },
  { id: 'square', kind: 'face', label: '方方', icon: '🟨', naturalCenter: { x: 150, y: 166 }, colorable: true,
    draw: ctx => {
      roundRectPath(ctx, 60, 76, 180, 180, 58)
      ctx.fill(); ctx.stroke()
    } },
  { id: 'rice', kind: 'face', label: '饭团', icon: '🍙', naturalCenter: { x: 150, y: 151 }, colorable: true,
    draw: ctx => {
      ctx.beginPath()
      ctx.moveTo(150, 58)
      ctx.quadraticCurveTo(236, 168, 150, 244)
      ctx.quadraticCurveTo(64, 168, 150, 58)
      ctx.closePath()
      ctx.fill(); ctx.stroke()
    } },
  { id: 'blob', kind: 'face', label: '云朵', icon: '☁️', naturalCenter: { x: 150, y: 165 }, colorable: true,
    draw: ctx => {
      circle(ctx, 106, 168, 58); ctx.fill()
      circle(ctx, 150, 140, 66); ctx.fill()
      circle(ctx, 196, 168, 58); ctx.fill()
      circle(ctx, 150, 190, 62); ctx.fill()
    } },
  { id: 'heart', kind: 'face', label: '爱心', icon: '❤️', naturalCenter: { x: 150, y: 170 }, colorable: true,
    draw: ctx => {
      heartPath(ctx, 150, 170, 102); ctx.fill(); ctx.stroke()
    } },
  { id: 'star', kind: 'face', label: '星星', icon: '⭐', naturalCenter: { x: 150, y: 168 }, colorable: true,
    draw: ctx => {
      starPath(ctx, 150, 168, 112, 56); ctx.fill(); ctx.stroke()
    } },
  { id: 'pudding', kind: 'face', label: '布丁', icon: '🍮', naturalCenter: { x: 150, y: 147 }, colorable: true,
    draw: ctx => {
      ctx.beginPath()
      ctx.moveTo(66, 210)
      ctx.lineTo(66, 198)
      ctx.bezierCurveTo(66, 118, 104, 62, 150, 62)
      ctx.bezierCurveTo(196, 62, 234, 118, 234, 198)
      ctx.lineTo(234, 210)
      ctx.quadraticCurveTo(234, 232, 212, 232)
      ctx.lineTo(88, 232)
      ctx.quadraticCurveTo(66, 232, 66, 210)
      ctx.closePath()
      ctx.fill(); ctx.stroke()
    } }
]

// ---------- 眼睛 ----------

const LX = 112
const RX = 188
const EY = 150

function dotEye(ctx: Ctx, cx: number): void {
  circle(ctx, cx, EY, 11)
  ctx.fillStyle = INK
  ctx.fill()
  circle(ctx, cx - 4, EY - 4, 3.6)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
}

const EYE_PARTS: PartDef[] = [
  { id: 'dot', kind: 'eye', label: '圆圆眼', icon: '👀', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => { dotEye(ctx, LX); dotEye(ctx, RX) } },
  { id: 'happy', kind: 'eye', label: '眯眯笑', icon: '😊', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      qcurve(ctx, LX - 14, EY + 6, LX, EY - 14, LX + 14, EY + 6, 9)
      qcurve(ctx, RX - 14, EY + 6, RX, EY - 14, RX + 14, EY + 6, 9)
    } },
  { id: 'closed', kind: 'eye', label: '闭眼', icon: '😌', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      line(ctx, LX - 13, EY, LX + 13, EY, 9)
      line(ctx, RX - 13, EY, RX + 13, EY, 9)
    } },
  { id: 'cry', kind: 'eye', label: '泪眼', icon: '😭', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      dotEye(ctx, LX); dotEye(ctx, RX)
      ctx.beginPath()
      ctx.ellipse(LX, EY + 27, 7, 11, 0, 0, Math.PI * 2); ctx.fillStyle = TEAR; ctx.fill()
      ctx.beginPath()
      ctx.ellipse(RX, EY + 27, 7, 11, 0, 0, Math.PI * 2); ctx.fill()
    } },
  { id: 'eye-angry', kind: 'eye', label: '怒目', icon: '😠', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      line(ctx, LX - 12, EY - 8, LX + 10, EY + 4, 9)
      line(ctx, RX + 12, EY - 8, RX - 10, EY + 4, 9)
    } },
  { id: 'dizzy', kind: 'eye', label: '晕圈圈', icon: '😵', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      line(ctx, LX - 9, EY - 9, LX + 9, EY + 9, 7)
      line(ctx, LX - 9, EY + 9, LX + 9, EY - 9, 7)
      line(ctx, RX - 9, EY - 9, RX + 9, EY + 9, 7)
      line(ctx, RX - 9, EY + 9, RX + 9, EY - 9, 7)
    } },
  { id: 'eye-heart', kind: 'eye', label: '花痴眼', icon: '😍', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      heartPath(ctx, LX, EY, 13); ctx.fillStyle = HEART; ctx.fill()
      heartPath(ctx, RX, EY, 13); ctx.fill()
    } },
  { id: 'eye-star', kind: 'eye', label: '星星眼', icon: '🤩', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      starPath(ctx, LX, EY, 15, 6.5); ctx.fillStyle = STAR; ctx.fill()
      starPath(ctx, RX, EY, 15, 6.5); ctx.fill()
    } },
  { id: 'wink', kind: 'eye', label: '眨眼', icon: '😉', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => { dotEye(ctx, LX); line(ctx, RX - 13, EY, RX + 13, EY, 9) } },
  { id: 'cross', kind: 'eye', label: '斗鸡眼', icon: '🤪', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      const goody = (cx: number, px: number) => {
        circle(ctx, cx, EY, 15); ctx.fillStyle = '#FFFFFF'; ctx.fill()
        ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke()
        circle(ctx, px, EY + 1, 7); ctx.fillStyle = INK; ctx.fill()
      }
      goody(LX, LX + 7); goody(RX, RX - 7)
    } },
  { id: 'watery', kind: 'eye', label: '水汪汪', icon: '🥹', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      const watery = (cx: number) => {
        circle(ctx, cx, EY, 17); ctx.fillStyle = '#FFFFFF'; ctx.fill()
        ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke()
        circle(ctx, cx, EY + 3, 10); ctx.fillStyle = INK; ctx.fill()
        ctx.beginPath()
        ctx.ellipse(cx, EY + 10, 9, 5, 0, 0, Math.PI * 2); ctx.fillStyle = TEAR; ctx.fill()
        circle(ctx, cx - 5, EY - 5, 3.5); ctx.fillStyle = '#FFFFFF'; ctx.fill()
      }
      watery(LX); watery(RX)
    } },
  { id: 'squint', kind: 'eye', label: '闭不上', icon: '😖', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(LX - 11, EY - 9); ctx.lineTo(LX + 5, EY); ctx.lineTo(LX - 11, EY + 9); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(RX + 11, EY - 9); ctx.lineTo(RX - 5, EY); ctx.lineTo(RX + 11, EY + 9); ctx.stroke()
    } },
  { id: 'up', kind: 'eye', label: '翻白眼', icon: '🙄', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      const up = (cx: number) => {
        circle(ctx, cx, EY, 15); ctx.fillStyle = '#FFFFFF'; ctx.fill()
        ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke()
        circle(ctx, cx, EY - 6, 6); ctx.fillStyle = INK; ctx.fill()
        line(ctx, cx - 12, EY + 9, cx + 12, EY + 9, 4)
      }
      up(LX); up(RX)
    } }
]

// ---------- 眉毛 ----------

const BROW_PARTS: PartDef[] = [
  { id: 'flat', kind: 'brow', label: '平眉', icon: '➖', naturalCenter: { x: 150, y: 118 }, colorable: false,
    draw: ctx => {
      line(ctx, LX - 14, 118, LX + 14, 118, 7)
      line(ctx, RX - 14, 118, RX + 14, 118, 7)
    } },
  { id: 'sad', kind: 'brow', label: '八字眉', icon: '🥺', naturalCenter: { x: 150, y: 117 }, colorable: false,
    draw: ctx => {
      line(ctx, LX - 14, 112, LX + 12, 122, 7)
      line(ctx, RX + 14, 112, RX - 12, 122, 7)
    } },
  { id: 'angry', kind: 'brow', label: '怒眉', icon: '💢', naturalCenter: { x: 150, y: 118 }, colorable: false,
    draw: ctx => {
      line(ctx, LX - 13, 112, LX + 13, 124, 8)
      line(ctx, RX + 13, 112, RX - 13, 124, 8)
    } },
  { id: 'raise', kind: 'brow', label: '挑眉', icon: '🤨', naturalCenter: { x: 150, y: 113 }, colorable: false,
    draw: ctx => {
      qcurve(ctx, LX - 12, 120, LX, 106, LX + 12, 120, 7)
      line(ctx, RX - 12, 118, RX + 12, 118, 7)
    } },
  { id: 'wave', kind: 'brow', label: '皱眉', icon: '😖', naturalCenter: { x: 150, y: 118 }, colorable: false,
    draw: ctx => {
      ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(LX - 13, 118)
      ctx.quadraticCurveTo(LX - 5, 111, LX, 118)
      ctx.quadraticCurveTo(LX + 6, 125, LX + 13, 118)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(RX + 13, 118)
      ctx.quadraticCurveTo(RX + 5, 111, RX, 118)
      ctx.quadraticCurveTo(RX - 6, 125, RX + 13, 118)
      ctx.stroke()
    } },
  { id: 'bold', kind: 'brow', label: '粗平眉', icon: '🧱', naturalCenter: { x: 150, y: 117 }, colorable: false,
    draw: ctx => {
      line(ctx, LX - 15, 117, LX + 15, 116, 12)
      line(ctx, RX - 15, 116, RX + 15, 117, 12)
    } },
  { id: 'arch', kind: 'brow', label: '剑眉', icon: '🗡️', naturalCenter: { x: 150, y: 115 }, colorable: false,
    draw: ctx => {
      qcurve(ctx, LX - 13, 122, LX, 107, LX + 13, 122, 7)
      qcurve(ctx, RX - 13, 122, RX, 107, RX + 13, 122, 7)
    } }
]

// ---------- 嘴巴 ----------

const MOUTH_PARTS: PartDef[] = [
  { id: 'smile', kind: 'mouth', label: '微笑', icon: '🙂', naturalCenter: { x: 150, y: 210 }, colorable: false,
    draw: ctx => qcurve(ctx, 128, 200, 150, 219, 172, 200, 8) },
  { id: 'grin', kind: 'mouth', label: '哈哈', icon: '😄', naturalCenter: { x: 150, y: 215 }, colorable: false,
    draw: ctx => {
      ctx.beginPath()
      ctx.moveTo(124, 197)
      ctx.quadraticCurveTo(150, 234, 176, 197)
      ctx.closePath()
      ctx.fillStyle = MOUTH_INK; ctx.fill()
      ctx.beginPath()
      ctx.ellipse(150, 216, 12, 8, 0, 0, Math.PI * 2)
      ctx.fillStyle = PINK; ctx.fill()
    } },
  { id: 'mouth-flat', kind: 'mouth', label: '抿嘴', icon: '😐', naturalCenter: { x: 150, y: 204 }, colorable: false,
    draw: ctx => line(ctx, 134, 204, 166, 204, 8) },
  { id: 'wavy', kind: 'mouth', label: '纠结', icon: '😬', naturalCenter: { x: 150, y: 204 }, colorable: false,
    draw: ctx => {
      ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(128, 204)
      ctx.quadraticCurveTo(139, 195, 150, 204)
      ctx.quadraticCurveTo(161, 213, 172, 204)
      ctx.stroke()
    } },
  { id: 'tongue', kind: 'mouth', label: '吐舌', icon: '😛', naturalCenter: { x: 150, y: 205 }, colorable: false,
    draw: ctx => {
      qcurve(ctx, 130, 196, 150, 213, 170, 196, 8)
      ctx.beginPath()
      ctx.ellipse(150, 213, 13, 14, 0, 0, Math.PI * 2)
      ctx.fillStyle = PINK; ctx.fill()
      qcurve(ctx, 130, 196, 150, 213, 170, 196, 8)
    } },
  { id: 'wow', kind: 'mouth', label: '惊哇', icon: '😲', naturalCenter: { x: 150, y: 206 }, colorable: false,
    draw: ctx => { circle(ctx, 150, 206, 14); ctx.fillStyle = MOUTH_INK; ctx.fill() } },
  { id: 'mouth-sad', kind: 'mouth', label: '撇嘴', icon: '🙁', naturalCenter: { x: 150, y: 204 }, colorable: false,
    draw: ctx => qcurve(ctx, 132, 213, 150, 195, 168, 213, 8) },
  { id: 'pucker', kind: 'mouth', label: '嘟嘟', icon: '😗', naturalCenter: { x: 150, y: 206 }, colorable: false,
    draw: ctx => {
      circle(ctx, 150, 206, 9); ctx.fillStyle = MOUTH_INK; ctx.fill()
      circle(ctx, 150, 206, 9); ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke()
    } },
  { id: 'wail', kind: 'mouth', label: '大哭', icon: '😫', naturalCenter: { x: 150, y: 215 }, colorable: false,
    draw: ctx => {
      ctx.beginPath()
      ctx.ellipse(150, 210, 20, 24, 0, 0, Math.PI * 2)
      ctx.fillStyle = MOUTH_INK; ctx.fill()
      ctx.beginPath()
      ctx.ellipse(150, 222, 12, 10, 0, 0, Math.PI * 2)
      ctx.fillStyle = PINK; ctx.fill()
    } },
  { id: 'toothy', kind: 'mouth', label: '咧嘴', icon: '😁', naturalCenter: { x: 150, y: 213 }, colorable: false,
    draw: ctx => {
      ctx.beginPath()
      ctx.moveTo(124, 196)
      ctx.quadraticCurveTo(150, 230, 176, 196)
      ctx.closePath()
      ctx.fillStyle = MOUTH_INK; ctx.fill()
      roundRectPath(ctx, 130, 196, 40, 10, 5); ctx.fillStyle = '#FFFFFF'; ctx.fill()
    } },
  { id: 'smirk', kind: 'mouth', label: '得意', icon: '😏', naturalCenter: { x: 150, y: 207 }, colorable: false,
    draw: ctx => qcurve(ctx, 132, 208, 154, 216, 174, 196, 8) },
  { id: 'kiss', kind: 'mouth', label: '么么', icon: '😘', naturalCenter: { x: 150, y: 203 }, colorable: false,
    draw: ctx => { heartPath(ctx, 150, 203, 10); ctx.fillStyle = HEART; ctx.fill() } }
]

// ---------- 身体 ----------

const BODY_PARTS: PartDef[] = [
  {
    id: 'body-round', kind: 'body', label: '圆滚滚', icon: '🟢', naturalCenter: { x: 150, y: 240 }, colorable: true,
    draw: ctx => {
      ctx.beginPath()
      ctx.ellipse(150, 240, 110, 50, 0, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()
    }
  },
  {
    id: 'pear', kind: 'body', label: '梨形', icon: '🍐', naturalCenter: { x: 150, y: 244 }, colorable: true,
    draw: ctx => {
      ctx.beginPath()
      ctx.moveTo(60, 220)
      ctx.quadraticCurveTo(150, 250, 240, 220)
      ctx.quadraticCurveTo(220, 290, 150, 290)
      ctx.quadraticCurveTo(80, 290, 60, 220)
      ctx.closePath()
      ctx.fill(); ctx.stroke()
    }
  },
  {
    id: 'cloud', kind: 'body', label: '云朵', icon: '☁️', naturalCenter: { x: 150, y: 250 }, colorable: true,
    draw: ctx => {
      circle(ctx, 90, 252, 38); ctx.fill()
      circle(ctx, 130, 236, 44); ctx.fill()
      circle(ctx, 175, 234, 46); ctx.fill()
      circle(ctx, 210, 250, 38); ctx.fill()
      circle(ctx, 150, 270, 50); ctx.fill()
    }
  },
  {
    id: 'shadow', kind: 'body', label: '影子', icon: '⬛', naturalCenter: { x: 150, y: 280 }, colorable: false,
    draw: ctx => {
      ctx.globalAlpha = 0.25
      ctx.fillStyle = '#000000'
      ctx.beginPath()
      ctx.ellipse(150, 280, 100, 16, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
]

// ---------- 配饰 ----------

function catEars(ctx: Ctx, color: string): void {
  const dark = shade(color, 0.82)
  ctx.fillStyle = dark
  ctx.beginPath(); ctx.moveTo(80, 104); ctx.lineTo(90, 34); ctx.lineTo(140, 76); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(220, 104); ctx.lineTo(210, 34); ctx.lineTo(160, 76); ctx.closePath(); ctx.fill()
  ctx.fillStyle = PINK
  ctx.beginPath(); ctx.moveTo(96, 92); ctx.lineTo(101, 54); ctx.lineTo(128, 76); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(204, 92); ctx.lineTo(199, 54); ctx.lineTo(172, 76); ctx.closePath(); ctx.fill()
}

function bearEars(ctx: Ctx, color: string): void {
  const dark = shade(color, 0.82)
  ctx.fillStyle = dark
  circle(ctx, 88, 86, 34); ctx.fill()
  circle(ctx, 212, 86, 34); ctx.fill()
  ctx.fillStyle = PINK
  circle(ctx, 88, 86, 15); ctx.fill()
  circle(ctx, 212, 86, 15); ctx.fill()
}

function bunnyEars(ctx: Ctx, color: string): void {
  const dark = shade(color, 0.85)
  ctx.fillStyle = dark
  ctx.beginPath(); ctx.ellipse(108, 58, 20, 54, -0.22, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(192, 58, 20, 54, 0.22, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = PINK
  ctx.beginPath(); ctx.ellipse(108, 60, 10, 38, -0.22, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(192, 60, 10, 38, 0.22, 0, Math.PI * 2); ctx.fill()
}

const ACC_PARTS: PartDef[] = [
  { id: 'ears-cat', kind: 'accessory', label: '猫耳', icon: '🐱', naturalCenter: { x: 150, y: 70 }, colorable: true,
    draw: (ctx, color) => catEars(ctx, color) },
  { id: 'ears-round', kind: 'accessory', label: '熊耳', icon: '🐻', naturalCenter: { x: 150, y: 86 }, colorable: true,
    draw: (ctx, color) => bearEars(ctx, color) },
  { id: 'ears-long', kind: 'accessory', label: '兔耳', icon: '🐰', naturalCenter: { x: 150, y: 58 }, colorable: true,
    draw: (ctx, color) => bunnyEars(ctx, color) },
  { id: 'blush', kind: 'accessory', label: '腮红', icon: '🌸', naturalCenter: { x: 150, y: 190 }, colorable: false,
    draw: ctx => {
      ctx.globalAlpha = 0.75
      ctx.fillStyle = BLUSH
      ctx.beginPath(); ctx.ellipse(86, 190, 18, 11, 0, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(214, 190, 18, 11, 0, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
    } },
  { id: 'whiskers', kind: 'accessory', label: '胡须', icon: '😼', naturalCenter: { x: 150, y: 180 }, colorable: false,
    draw: ctx => {
      ctx.globalAlpha = 0.65
      line(ctx, 84, 168, 46, 158, 5, '#5A5A5A')
      line(ctx, 84, 180, 42, 180, 5, '#5A5A5A')
      line(ctx, 84, 192, 46, 200, 5, '#5A5A5A')
      line(ctx, 216, 168, 254, 158, 5, '#5A5A5A')
      line(ctx, 216, 180, 258, 180, 5, '#5A5A5A')
      line(ctx, 216, 192, 254, 200, 5, '#5A5A5A')
      ctx.globalAlpha = 1
    } },
  { id: 'glasses', kind: 'accessory', label: '眼镜', icon: '👓', naturalCenter: { x: 150, y: EY }, colorable: false,
    draw: ctx => {
      ctx.strokeStyle = INK; ctx.lineWidth = 7
      circle(ctx, LX, EY, 27); ctx.stroke()
      circle(ctx, RX, EY, 27); ctx.stroke()
      line(ctx, LX + 27, EY - 4, RX - 27, EY - 4, 7)
      line(ctx, LX - 27, EY - 4, 62, EY - 10, 7)
      line(ctx, RX + 27, EY - 4, 238, EY - 10, 7)
    } },
  { id: 'sweat', kind: 'accessory', label: '汗滴', icon: '💦', naturalCenter: { x: 232, y: 88 }, colorable: false,
    draw: ctx => drop(ctx, 232, 64, 24, TEAR) },
  { id: 'tears', kind: 'accessory', label: '泪痕', icon: '💧', naturalCenter: { x: 150, y: 175 }, colorable: false,
    draw: ctx => {
      drop(ctx, LX, EY + 14, 18, TEAR)
      drop(ctx, RX, EY + 14, 18, TEAR)
    } },
  { id: 'bow', kind: 'accessory', label: '蝴蝶结', icon: '🎀', naturalCenter: { x: 226, y: 68 }, colorable: false,
    draw: ctx => {
      ctx.fillStyle = '#FF6B80'
      ctx.beginPath(); ctx.moveTo(226, 68); ctx.lineTo(198, 50); ctx.lineTo(198, 86); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(226, 68); ctx.lineTo(254, 50); ctx.lineTo(254, 86); ctx.closePath(); ctx.fill()
      circle(ctx, 226, 68, 10); ctx.fill()
    } },
  { id: 'halo', kind: 'accessory', label: '天使圈', icon: '😇', naturalCenter: { x: 150, y: 46 }, colorable: false,
    draw: ctx => {
      ctx.strokeStyle = '#FFD65C'; ctx.lineWidth = 10
      ctx.beginPath(); ctx.ellipse(150, 46, 46, 13, 0, 0, Math.PI * 2); ctx.stroke()
    } },
  { id: 'horns', kind: 'accessory', label: '恶魔角', icon: '😈', naturalCenter: { x: 150, y: 46 }, colorable: false,
    draw: ctx => {
      ctx.fillStyle = '#B3475B'
      ctx.beginPath(); ctx.moveTo(94, 68); ctx.lineTo(82, 24); ctx.lineTo(122, 52); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(206, 68); ctx.lineTo(218, 24); ctx.lineTo(178, 52); ctx.closePath(); ctx.fill()
    } },
  { id: 'hat', kind: 'accessory', label: '毛线帽', icon: '🧢', naturalCenter: { x: 150, y: 86 }, colorable: false,
    draw: ctx => {
      ctx.fillStyle = '#4C9AFF'
      ctx.beginPath(); ctx.moveTo(64, 108); ctx.arc(150, 108, 86, Math.PI, 0); ctx.closePath(); ctx.fill()
      roundRectPath(ctx, 54, 98, 192, 22, 11); ctx.fill()
      circle(ctx, 150, 26, 14); ctx.fill()
    } },
  { id: 'crown', kind: 'accessory', label: '皇冠', icon: '👑', naturalCenter: { x: 150, y: 64 }, colorable: false,
    draw: ctx => {
      ctx.fillStyle = '#FFD65C'; ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(98, 88); ctx.lineTo(98, 40); ctx.lineTo(126, 66); ctx.lineTo(150, 32)
      ctx.lineTo(174, 66); ctx.lineTo(202, 40); ctx.lineTo(202, 88)
      ctx.closePath()
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#FF6B80'
      circle(ctx, 98, 38, 5); ctx.fill()
      circle(ctx, 150, 30, 5); ctx.fill()
      circle(ctx, 202, 38, 5); ctx.fill()
    } },
  { id: 'bowtie', kind: 'accessory', label: '领结', icon: '🎀', naturalCenter: { x: 150, y: 254 }, colorable: false,
    draw: ctx => {
      ctx.fillStyle = '#FF6B80'
      ctx.beginPath(); ctx.moveTo(150, 254); ctx.lineTo(116, 236); ctx.lineTo(116, 272); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(150, 254); ctx.lineTo(184, 236); ctx.lineTo(184, 272); ctx.closePath(); ctx.fill()
      circle(ctx, 150, 254, 10); ctx.fillStyle = '#E0535F'; ctx.fill()
    } },
  { id: 'flower', kind: 'accessory', label: '小花', icon: '🌺', naturalCenter: { x: 94, y: 78 }, colorable: false,
    draw: ctx => {
      ctx.fillStyle = '#FF8FA3'
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
        circle(ctx, 94 + Math.cos(a) * 12, 78 + Math.sin(a) * 12, 9); ctx.fill()
      }
      ctx.fillStyle = '#FFD65C'
      circle(ctx, 94, 78, 7); ctx.fill()
    } },
  { id: 'teeth', kind: 'accessory', label: '兔牙', icon: '🦷', naturalCenter: { x: 150, y: 215 }, colorable: false,
    draw: ctx => {
      ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = INK; ctx.lineWidth = 3
      roundRectPath(ctx, 138, 206, 11, 17, 5); ctx.fill(); ctx.stroke()
      roundRectPath(ctx, 151, 206, 11, 17, 5); ctx.fill(); ctx.stroke()
    } }
]

// ---------- 分类聚合 ----------

export const FACE_OPTIONS: PartDef[] = FACE_PARTS
export const EYE_OPTIONS: PartDef[] = EYE_PARTS
export const BROW_OPTIONS: PartDef[] = BROW_PARTS
export const MOUTH_OPTIONS: PartDef[] = MOUTH_PARTS
export const BODY_OPTIONS: PartDef[] = BODY_PARTS
export const ACC_OPTIONS: PartDef[] = ACC_PARTS

export const PART_KIND_LIST: Array<{ key: PartKind; label: string }> = [
  { key: 'face', label: '脸型' },
  { key: 'eye', label: '眼睛' },
  { key: 'brow', label: '眉毛' },
  { key: 'mouth', label: '嘴巴' },
  { key: 'body', label: '身体' },
  { key: 'accessory', label: '配饰' }
]

export function getPartsByKind(kind: PartKind): PartDef[] {
  switch (kind) {
    case 'face': return FACE_PARTS
    case 'eye': return EYE_PARTS
    case 'brow': return BROW_PARTS
    case 'mouth': return MOUTH_PARTS
    case 'body': return BODY_PARTS
    case 'accessory': return ACC_PARTS
  }
}

const PART_MAP: Record<string, PartDef> = (() => {
  const all = [...FACE_PARTS, ...EYE_PARTS, ...BROW_PARTS, ...MOUTH_PARTS, ...BODY_PARTS, ...ACC_PARTS]
  const map: Record<string, PartDef> = {}
  const seen = new Set<string>()
  for (const p of all) {
    // 去重防护：重复 id 只保留第一个，避免互相覆盖产生错误部件
    if (seen.has(p.id)) {
      console.warn('[EmojiParts] 发现重复部件 id，已去重:', p.id)
      continue
    }
    seen.add(p.id)
    map[p.id] = p
  }
  return map
})()

/** 通过 id 查部件定义 */
export function getPartById(id: string): PartDef | undefined {
  return PART_MAP[id]
}

// ---------- 颜色 ----------

export const FACE_COLORS = ['#FFD65C', '#F2B879', '#FDF3F6', '#A8D672', '#C3CBD8', '#FFB48A', '#C9A6E8', '#FFFFFF']
export const BG_COLORS = ['#FFEFD8', '#FFFFFF', '#E8F1FF', '#EAF7DC', '#FFE9F0', '#EDEBFF', '#FFF6D9', '#2B2B33']

/** 部件默认脸型颜色 */
export const DEFAULT_PART_COLOR = '#FFD65C'
export const DEFAULT_BG_COLOR = '#FFEFD8'

// ---------- 渲染（部件层 + 选中框） ----------

export interface DrawPartOptions {
  color?: string
  ignoreVisibility?: boolean
}

/**
 * 在 300x300 坐标系下绘制单个部件层
 * ctx 已缩放至 1 单位 = 1 像素（300 坐标系）
 */
export function drawPartLayer(
  ctx: Ctx,
  layer: PartLayer,
  options: DrawPartOptions = {}
): void {
  if (!layer.visible && !options.ignoreVisibility) return
  const part = PART_MAP[layer.partId]
  if (!part) return

  ctx.save()
  ctx.globalAlpha = layer.opacity
  // 1) 平移到图层中心
  ctx.translate(layer.x, layer.y)
  // 2) 旋转
  if (layer.rotation) ctx.rotate(layer.rotation)
  // 3) 非等比缩放（拉伸/压扁）
  if (layer.scaleX !== 1 || layer.scaleY !== 1) ctx.scale(layer.scaleX, layer.scaleY)
  // 4) 把"自然中心"移回原点（这样 draw 内部仍可用绝对坐标）
  ctx.translate(-part.naturalCenter.x, -part.naturalCenter.y)
  // 5) 基础色：可变色部件用图层色，其余用墨色；
  //    部件内部可自行覆盖（如腮红、泪滴、耳内粉色）
  ctx.fillStyle = layer.color || (part.colorable ? DEFAULT_PART_COLOR : INK)
  ctx.strokeStyle = INK
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // 6) 绘制
  part.draw(ctx, layer.color || DEFAULT_PART_COLOR)
  ctx.restore()
}

/** 绘制一个部件层的选中虚线框（用图层的 x/y/scaleX/scaleY/rotation） */
export function drawPartLayerSelection(
  ctx: Ctx,
  layer: PartLayer
): void {
  const part = PART_MAP[layer.partId]
  if (!part) return
  // 估计包围盒（用经验值；每个部件的覆盖范围约 ±100）
  // 简化处理：所有部件用一个 220x220 的包络
  const halfW = 110
  const halfH = 110
  ctx.save()
  ctx.translate(layer.x, layer.y)
  if (layer.rotation) ctx.rotate(layer.rotation)
  if (layer.scaleX !== 1 || layer.scaleY !== 1) ctx.scale(layer.scaleX, layer.scaleY)
  ctx.strokeStyle = '#FF6B35'
  ctx.lineWidth = 1.6
  ctx.setLineDash([6, 4])
  ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2)
  ctx.restore()
}
