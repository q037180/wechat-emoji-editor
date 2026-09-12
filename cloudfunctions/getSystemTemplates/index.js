const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 系统模板列表（systemTemplates 集合，管理员维护） */
exports.main = async (event) => {
  try {
    const limit = Math.min(Number(event.limit) || 20, 50)
    const res = await db.collection('systemTemplates').limit(limit).get()
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
      name: d.name || '系统模板',
      tags: d.tags || [],
      createdAt: d.createdAt || null
    }))

    return { code: 0, message: 'success', data: { list, hasMore: false } }
  } catch (err) {
    console.error('[getSystemTemplates] error:', err)
    return { code: -1, message: err.message || '获取系统模板失败', data: null }
  }
}
