const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 发布到公共广场 */
exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const { fileID } = event
    if (!fileID || typeof fileID !== 'string') {
      return { code: -1, message: '缺少图片文件', data: null }
    }

    const safeName = String(event.name || '未命名表情').slice(0, 30)
    const safeTags = Array.isArray(event.tags)
      ? event.tags.map(t => String(t).slice(0, 10)).filter(Boolean).slice(0, 5)
      : []

    // 读取发布者昵称
    let nickname = '神秘用户'
    try {
      const userRes = await db.collection('users').where({ openid: OPENID }).limit(1).get()
      if (userRes.data && userRes.data[0] && userRes.data[0].nickname) {
        nickname = userRes.data[0].nickname
      }
    } catch (e) {
      console.error('[publishSharedEmoji] 读取用户昵称失败', e)
    }

    const addRes = await db.collection('sharedEmojis').add({
      data: {
        creatorOpenid: OPENID,
        creatorNickname: nickname,
        fileID,
        name: safeName,
        tags: safeTags,
        likes: 0,
        likedBy: [],
        createdAt: db.serverDate()
      }
    })

    const urlRes = await cloud.getTempFileURL({ fileList: [fileID] })
    const url = (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) || fileID

    console.info('[publishSharedEmoji] 已发布', addRes._id)
    return {
      code: 0,
      message: 'success',
      data: {
        id: addRes._id,
        fileID,
        url,
        name: safeName,
        tags: safeTags,
        likes: 0,
        liked: false,
        fav: false,
        creatorNickname: nickname,
        isMine: true,
        createdAt: new Date().toISOString()
      }
    }
  } catch (err) {
    console.error('[publishSharedEmoji] error:', err)
    return { code: -1, message: err.message || '发布失败', data: null }
  }
}
