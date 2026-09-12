const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 我的私有表情列表 */
exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const skip = Math.max(0, Number(event.skip) || 0)
    const limit = Math.min(Number(event.limit) || 30, 50)

    const res = await db
      .collection('myEmojis')
      .where({ openid: OPENID })
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get()
    const docs = res.data || []

    let urlMap = {}
    if (docs.length) {
      const urlRes = await cloud.getTempFileURL({ fileList: docs.map(d => d.fileID) })
      ;(urlRes.fileList || []).forEach(f => { urlMap[f.fileID] = f.tempFileURL })
    }

    const list = docs.map(d => ({
      id: d._id,
      fileID: d.fileID,
      url: urlMap[d.fileID] || d.fileID,
      name: d.name || '我的表情',
      tags: d.tags || [],
      createdAt: d.createdAt || null
    }))

    return { code: 0, message: 'success', data: { list, hasMore: docs.length === limit } }
  } catch (err) {
    console.error('[getMyList] error:', err)
    return { code: -1, message: err.message || '获取我的表情失败', data: null }
  }
}
