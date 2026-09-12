import React from 'react'
import { Text, View } from '@tarojs/components'
import styles from './index.module.scss'

interface EmptyStateProps {
  icon?: string
  title: string
  desc?: string
}

/** 空状态占位组件 */
const EmptyState: React.FC<EmptyStateProps> = ({ icon = '🎨', title, desc }) => {
  return (
    <View className={styles.wrap}>
      <Text className={styles.icon}>{icon}</Text>
      <Text className={styles.title}>{title}</Text>
      {desc ? <Text className={styles.desc}>{desc}</Text> : null}
    </View>
  )
}

export default EmptyState
