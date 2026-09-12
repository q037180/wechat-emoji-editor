const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 删除我的私有表情（校验归属，同时清理云存储文件） */
exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const { id } = event
    if (!id) return { code: -1, message: '缺少 id', data: null }

    let docRes = null
    try {
      docRes = await db.collection('myEmojis').doc(id).get()
    } catch (e) {
      return { code: -1, message: '表情不存在', data: null }
    }
    const doc = docRes && docRes.data
    if (!doc) return { code: -1, message: '表情不存在', data: null }
    if (doc.openid !== OPENID) return { code: -1, message: '无权删除他人表情', data: null }

    await db.collection('myEmojis').doc(id).remove()

    try {
      await cloud.deleteFile({ fileList: [doc.fileID] })
    } catch (e) {
      console.error('[deleteMyEmoji] 云文件删除失败', e)
    }

    console.info('[deleteMyEmoji] 已删除', id)
    return { code: 0, message: 'success', data: { success: true } }
  } catch (err) {
    console.error('[deleteMyEmoji] error:', err)
    return { code: -1, message: err.message || '删除失败', data: null }
  }
}
