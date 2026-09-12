const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 登录：获取/创建用户 */
exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) return { code: -1, message: '获取用户身份失败', data: null }

    const users = db.collection('users')
    const existed = await users.where({ openid: OPENID }).limit(1).get()

    if (existed.data.length === 0) {
      const nickname = `表情达人${String(OPENID).slice(-4).toUpperCase()}`
      await users.add({ data: { openid: OPENID, nickname, avatar: '', createdAt: db.serverDate() } })
      console.info('[login] 新用户注册', OPENID)
      return { code: 0, message: 'success', data: { openid: OPENID, nickname, avatar: '' } }
    }

    const doc = existed.data[0]
    return {
      code: 0,
      message: 'success',
      data: { openid: OPENID, nickname: doc.nickname || '表情达人', avatar: doc.avatar || '' }
    }
  } catch (err) {
    console.error('[login] error:', err)
    return { code: -1, message: err.message || '登录失败', data: null }
  }
}
