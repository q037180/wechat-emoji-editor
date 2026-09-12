import Taro from '@tarojs/taro'

const isWeapp = process.env.TARO_ENV === 'weapp'

/** 运行时检测云能力是否可用（处理老版本微信未注入 Taro.cloud 的场景） */
function ensureCloudReady() {
  if (!isWeapp) return
  if (!Taro.cloud || typeof Taro.cloud.callFunction !== 'function') {
    throw new Error('当前微信版本过低，不支持云开发能力，请升级到最新版本')
  }
}

export async function callFunction<T = any>(
  name: string,
  data?: Record<string, any>
): Promise<T> {
  ensureCloudReady()
  if (!isWeapp) {
    const mockModule = await import(`../data/${name}`)
    return mockModule.default(data) as T
  }
  const res = await Taro.cloud.callFunction({ name, data })
  const result = res.result as { code: number; message: string; data: T }
  if (result.code !== 0) {
    console.error(`[Cloud] ${name} failed:`, result.message)
    throw new Error(result.message || '请求失败')
  }
  return result.data
}

export function getDatabase() {
  ensureCloudReady()
  if (!isWeapp) {
    return null
  }
  return Taro.cloud.database()
}
