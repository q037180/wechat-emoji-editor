import React, { useCallback, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Image, Text, View } from '@tarojs/components'
import classnames from 'classnames'
import dayjs from 'dayjs'
import styles from './index.module.scss'
import EmptyState from '@/components/EmptyState'
import { deleteMyEmoji, getMyList, login } from '@/services/emoji'
import { useTransferStore } from '@/store/transfer'
import { useUserStore } from '@/store/user'
import type { EmojiItem } from '@/types'

const MinePage: React.FC = () => {
  const user = useUserStore(s => s.user)
  const setUser = useUserStore(s => s.setUser)

  const [myList, setMyList] = useState<EmojiItem[]>([])

  /** 确保已登录（App 级登录失败时兜底） */
  const ensureUser = useCallback(async () => {
    if (useUserStore.getState().user) return
    try {
      const u = await login()
      setUser(u)
    } catch (err) {
      console.error('[Mine] 登录失败', err)
    }
  }, [setUser])

  const loadMine = useCallback(async () => {
    try {
      const res = await getMyList(0, 50)
      setMyList(res.list)
    } catch (err) {
      console.error('[Mine] 我的表情加载失败', err)
    }
  }, [])

  useDidShow(() => {
    ensureUser()
    loadMine()
  })

  // ---------- 用于创作 ----------
  const handleUse = (item: EmojiItem) => {
    useTransferStore.getState().setPendingImage(item.url)
    Taro.switchTab({ url: '/pages/editor/index' })
  }

  // ---------- 删除 ----------
  const handleDelete = (item: EmojiItem) => {
    Taro.showModal({
      title: '删除表情',
      content: `确定删除「${item.name}」吗？删除后不可恢复`,
      confirmColor: '#F53F3F',
      success: async res => {
        if (!res.confirm) return
        try {
          await deleteMyEmoji(item.id)
          setMyList(prev => prev.filter(it => it.id !== item.id))
          Taro.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          console.error('[Mine] 删除失败', err)
          Taro.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  }

  return (
    <View className={styles.page}>
      {/* 个人卡片 */}
      <View className={styles.profileCard}>
        {user && user.avatar ? (
          <Image
            className={styles.avatar}
            src={user.avatar}
            mode='aspectFill'
            onError={() => console.error('[Mine] 头像加载失败', user.avatar)}
          />
        ) : (
          <View className={classnames(styles.avatar, styles.avatarPlaceholder)}>
            <Text>😎</Text>
          </View>
        )}
        <View className={styles.profileInfo}>
          <Text className={styles.nickname}>{user ? user.nickname : '表情达人'}</Text>
          <Text className={styles.openidTip}>微信用户 · {user ? user.openid.slice(-8) : '登录中…'}</Text>
        </View>
      </View>

      {/* 数据统计 */}
      <View className={styles.statsCard}>
        <View className={styles.statItem}>
          <Text className={styles.statValue}>{myList.length}</Text>
          <Text className={styles.statLabel}>我的表情</Text>
        </View>
      </View>

      {/* 列表 */}
      <View className={styles.listWrap}>
        {myList.length === 0 ? (
          <View className={styles.emptyWrap}>
            <EmptyState
              icon='📦'
              title='还没有保存过表情'
              desc='去创作一个并「存入我的表情」吧'
            />
          </View>
        ) : (
          <View className={styles.grid}>
            {myList.map(item => (
              <View key={item.id} className={styles.gridItem}>
                <View className={styles.card} onClick={() => handleUse(item)}>
                  <View className={styles.cover}>
                    <Image
                      className={styles.image}
                      src={item.url}
                      mode='aspectFill'
                      lazyLoad
                      onError={() => console.error('[Mine] 表情图加载失败', item.url)}
                    />
                  </View>
                  <View className={styles.body}>
                    <Text className={styles.name}>{item.name}</Text>
                    <Text className={styles.time}>{dayjs(item.createdAt).format('MM-DD HH:mm')}</Text>
                    <View className={styles.ops}>
                      <View
                        className={styles.useBtn}
                        onClick={e => {
                          e.stopPropagation()
                          handleUse(item)
                        }}
                      >
                        <Text className={styles.useText}>用于创作</Text>
                      </View>
                      <View
                        className={styles.delBtn}
                        onClick={e => {
                          e.stopPropagation()
                          handleDelete(item)
                        }}
                      >
                        <Text className={styles.delText}>删除</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  )
}

export default MinePage
