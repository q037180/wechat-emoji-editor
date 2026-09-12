const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/** 微信云 _.in 单次查询上限，避免超过触发 -501001 错误 */
const IN_CHUNK_SIZE = 50

/** 我的收藏列表 */
exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    const favRes = await db
      .collection('favorites')
      .where({ openid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get()
    const favs = favRes.data || []
    if (!favs.length) {
      return { code: 0, message: 'success', data: { list: [], hasMore: false } }
    }

    const ids = favs.map(f => f.emojiID)
    // 分片查询（每片最多 50 个），最后合并
    const chunks = []
    for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
      chunks.push(ids.slice(i, i + IN_CHUNK_SIZE))
    }
    const docsResults = await Promise.all(
      chunks.map(chunk => db.collection('sharedEmojis').where({ _id: _.in(chunk) }).get())
    )
    const docs = docsResults.flatMap(r => r.data || [])

    let urlMap = {}
    if (docs.length) {
      const urlRes = await cloud.getTempFileURL({ fileList: docs.map(d => d.fileID) })
      ;(urlRes.fileList || []).forEach(f => { urlMap[f.fileID] = f.tempFileURL })
    }

    // 用 Map 索引 docs，按 favs 顺序（收藏时间倒序）输出
    const docMap = new Map(docs.map(d => [d._id, d]))
    const list = favs
      .map(fav => docMap.get(fav.emojiID))
      .filter(Boolean)
      .map(doc => ({
        id: doc._id,
        fileID: doc.fileID,
        url: urlMap[doc.fileID] || doc.fileID,
        name: doc.name || '未命名',
        tags: doc.tags || [],
        likes: doc.likes || 0,
        liked: Array.isArray(doc.likedBy) ? doc.likedBy.indexOf(OPENID) > -1 : false,
        fav: true,
        creatorNickname: doc.creatorNickname || '神秘用户',
        isMine: doc.creatorOpenid === OPENID,
        createdAt: doc.createdAt || null
      }))

    return { code: 0, message: 'success', data: { list, hasMore: false } }
  } catch (err) {
    console.error('[getMyFavorites] error:', err)
    return { code: -1, message: err.message || '获取收藏失败', data: null }
  }
}
