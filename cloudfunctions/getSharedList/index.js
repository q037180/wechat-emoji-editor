const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function normalize(doc, openid, url, favSet) {
  return {
    id: doc._id,
    fileID: doc.fileID,
    url: url || doc.fileID,
    name: doc.name || '未命名',
    tags: doc.tags || [],
    likes: doc.likes || 0,
    liked: Array.isArray(doc.likedBy) ? doc.likedBy.indexOf(openid) > -1 : false,
    fav: favSet.indexOf(doc._id) > -1,
    creatorNickname: doc.creatorNickname || '神秘用户',
    isMine: doc.creatorOpenid === openid,
    createdAt: doc.createdAt || null
  }
}

/**
 * 公共表情列表
 * - emojiID 存在时查询单条详情
 * - onlyMine=true 查询我发布的
 * - search 关键词匹配名称（模糊）或标签（精确）
 */
exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const skip = Math.max(0, Number(event.skip) || 0)
    const limit = Math.min(Number(event.limit) || 10, 30)
    const search = String(event.search || '')
    const emojiID = String(event.emojiID || '')
    const onlyMine = Boolean(event.onlyMine)

    const collection = db.collection('sharedEmojis')

    // 单条详情
    if (emojiID) {
      const res = await collection.doc(emojiID).get()
      const doc = res.data
      if (!doc) return { code: 0, message: 'success', data: { list: [], hasMore: false } }
      const urlRes = await cloud.getTempFileURL({ fileList: [doc.fileID] })
      const favRes = await db.collection('favorites').where({ openid: OPENID, emojiID }).get()
      const favSet = (favRes.data || []).map(f => f.emojiID)
      const url = (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) || doc.fileID
      return {
        code: 0,
        message: 'success',
        data: { list: [normalize(doc, OPENID, url, favSet)], hasMore: false }
      }
    }

    // 列表查询条件
    let where = {}
    if (onlyMine) {
      where = { creatorOpenid: OPENID }
    } else if (search.trim()) {
      const kw = search.trim()
      const reg = db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
      where = _.or([{ name: reg }, { tags: kw }])
    }

    const totalRes = await collection.where(where).count()
    const docsRes = await collection
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get()
    const docs = docsRes.data || []

    // 批量换取临时链接
    let urlMap = {}
    if (docs.length) {
      const urlRes = await cloud.getTempFileURL({ fileList: docs.map(d => d.fileID) })
      ;(urlRes.fileList || []).forEach(f => { urlMap[f.fileID] = f.tempFileURL })
    }

    // 当前用户的收藏集合
    const favRes = await db.collection('favorites').where({ openid: OPENID }).limit(1000).get()
    const favSet = (favRes.data || []).map(f => f.emojiID)

    const list = docs.map(d => normalize(d, OPENID, urlMap[d.fileID], favSet))

    // 当 onlyMine=true 时，额外聚合我所有作品的累计获赞（不受 limit 影响）
    let totalLikes
    if (onlyMine) {
      try {
        const sumRes = await db
          .collection('sharedEmojis')
          .where({ creatorOpenid: OPENID })
          .field({ likes: true })
          .limit(1000)
          .get()
        totalLikes = (sumRes.data || []).reduce((acc, d) => acc + (d.likes || 0), 0)
      } catch (e) {
        console.error('[getSharedList] totalLikes 聚合失败', e)
        // 兜底：用当前页累加，避免 UI 出现 0
        totalLikes = list.reduce((acc, it) => acc + (it.likes || 0), 0)
      }
    }

    return {
      code: 0,
      message: 'success',
      data: { list, hasMore: skip + limit < (totalRes.total || 0), totalLikes }
    }
  } catch (err) {
    console.error('[getSharedList] error:', err)
    return { code: -1, message: err.message || '获取广场列表失败', data: null }
  }
}
