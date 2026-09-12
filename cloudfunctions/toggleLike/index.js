const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 点赞 / 取消点赞
 * - 使用 _.inc / _.addToSet / _.pull 原子操作，避免并发读改写丢赞
 * - 重复请求（幂等 no-op）返回服务端当前真实状态
 */
exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const { emojiID, like } = event
    if (!emojiID) return { code: -1, message: '缺少 emojiID', data: null }

    const docRef = db.collection('sharedEmojis').doc(emojiID)
    let doc
    try {
      doc = (await docRef.get()).data
    } catch (e) {
      return { code: -1, message: '表情不存在', data: null }
    }
    if (!doc) return { code: -1, message: '表情不存在', data: null }

    const likedBy = Array.isArray(doc.likedBy) ? doc.likedBy : []
    const has = likedBy.indexOf(OPENID) > -1
    const currentLikes = doc.likes || 0

    if (like && !has) {
      // 原子自增计数 + 去重写入点赞人
      await docRef.update({
        data: { likes: _.inc(1), likedBy: _.addToSet(OPENID) }
      })
      return { code: 0, message: 'success', data: { likes: currentLikes + 1, liked: true } }
    }

    if (!like && has) {
      await docRef.update({
        data: { likes: _.inc(-1), likedBy: _.pull(OPENID) }
      })
      return {
        code: 0,
        message: 'success',
        data: { likes: Math.max(0, currentLikes - 1), liked: false }
      }
    }

    // 重复请求：返回服务端真实状态（而非请求意图），保证客户端状态一致
    return { code: 0, message: 'success', data: { likes: currentLikes, liked: has } }
  } catch (err) {
    console.error('[toggleLike] error:', err)
    return { code: -1, message: err.message || '点赞操作失败', data: null }
  }
}
