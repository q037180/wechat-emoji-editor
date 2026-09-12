import { useEffect } from 'react'
import Taro from '@tarojs/taro'
import { useDidShow, useDidHide } from '@tarojs/taro'
import { useUserStore } from '@/store/user'
import { login } from '@/services/emoji'
// 全局样式
import './app.scss'

function App(props) {
  useEffect(() => {
    // 云开发初始化（仅微信小程序端；其它平台走 mock 数据）
    if (process.env.TARO_ENV === 'weapp') {
      if (!Taro.cloud) {
        console.error('[App] 当前基础库过低，不支持云开发能力')
      } else {
        // ⚠️ 上线前必须替换为真实云环境 ID（在「微信云开发控制台 → 设置 → 环境设置」获取）
        const CLOUD_ENV_ID = 'your-env-id'
        if (CLOUD_ENV_ID === 'your-env-id') {
          console.warn('[App] ⚠️ 云环境 ID 仍为占位符，云函数将无法正常调用')
        }
        Taro.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
      }
    }
    // 静默登录，获取用户身份
    login()
      .then(user => {
        useUserStore.getState().setUser(user)
      })
      .catch(err => console.error('[App] 登录失败', err))
  }, [])

  // 对应 onShow
  useDidShow(() => {})

  // 对应 onHide
  useDidHide(() => {})

  return props.children
}

export default App
