const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 收藏 / 取消收藏 */
exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const { emojiID, favorite } = event
    if (!emojiID) return { code: -1, message: '缺少 emojiID', data: null }

    const coll = db.collection('favorites')
    const existed = await coll.where({ openid: OPENID, emojiID }).get()

    if (favorite) {
      if (existed.data.length === 0) {
        await coll.add({ data: { openid: OPENID, emojiID, createdAt: db.serverDate() } })
      }
    } else {
      await coll.where({ openid: OPENID, emojiID }).remove()
    }

    return { code: 0, message: 'success', data: { fav: Boolean(favorite) } }
  } catch (err) {
    console.error('[toggleFavorite] error:', err)
    return { code: -1, message: err.message || '收藏操作失败', data: null }
  }
}
