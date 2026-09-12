const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 存入我的私有表情（fileID 已由客户端上传到云存储） */
exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const { fileID } = event
    if (!fileID || typeof fileID !== 'string') {
      return { code: -1, message: '缺少图片文件', data: null }
    }

    const safeName = String(event.name || '我的表情').slice(0, 30)
    const safeTags = Array.isArray(event.tags)
      ? event.tags.map(t => String(t).slice(0, 10)).filter(Boolean).slice(0, 5)
      : []

    const addRes = await db.collection('myEmojis').add({
      data: { openid: OPENID, fileID, name: safeName, tags: safeTags, createdAt: db.serverDate() }
    })

    const urlRes = await cloud.getTempFileURL({ fileList: [fileID] })
    const url = (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) || fileID

    console.info('[uploadMyEmoji] 已保存', addRes._id)
    return {
      code: 0,
      message: 'success',
      data: {
        id: addRes._id,
        fileID,
        url,
        name: safeName,
        tags: safeTags,
        createdAt: new Date().toISOString()
      }
    }
  } catch (err) {
    console.error('[uploadMyEmoji] error:', err)
    return { code: -1, message: err.message || '保存失败', data: null }
  }
}
