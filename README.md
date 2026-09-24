# 微信表情包捏脸编辑器 (WeChat Emoji Editor)

基于 **Taro 4 + React 18 + TypeScript** 的微信表情包创作工具，支持微信小程序与 H5 双端。

在编辑器中捏出表情、添加文字、涂鸦打码、导出 GIF，还可发布到广场与他人分享。

## 功能特性

- **捏表情**：五官/表情部件自由组合，拖拽、缩放、旋转（画布上的橙色圆点可手动旋转）
- **文字**：自定义文字内容、字号、颜色
- **画笔**：普通笔涂鸦 / 马赛克笔打码，可调粗细
- **GIF 导出**：多帧动画合成 GIF 表情
- **图层调节**：多图层管理、层级调整、旋转、框选裁剪
- **贴纸库**：分类贴纸一键添加
- **云同步**：我的作品、收藏、点赞、广场分享（基于微信云开发）

## 技术栈

| 模块 | 技术 |
|---|---|
| 跨端框架 | Taro 4.1.9（weapp / h5） |
| UI 层 | React 18 + CSS Modules (Sass) |
| 状态管理 | Zustand |
| GIF 编码 | gifenc |
| 后端 | 微信云开发（云函数 + 云存储） |

## 快速开始

```bash
# 安装依赖（Node.js >= 18）
npm install

# H5 开发模式（浏览器预览）
npm run dev:h5

# 微信小程序开发模式（配合微信开发者工具）
npm run dev:weapp
```

- **H5 端**：无需任何配置即可运行编辑器本体（捏脸、文字、画笔/马赛克、图层变换与裁剪、GIF 导出均可正常使用）；但登录、作品保存、广场、收藏点赞依赖云函数，**仅在小程序端可用**（H5 下调用会因缺少 mock 数据而报错）
- **小程序端**：需要下面的云开发配置才能使用完整功能

## 微信小程序配置

1. **AppID**：在微信公众平台获取自己的小程序 AppID，填入 [project.config.json](project.config.json) 的 `appid` 字段（仓库中为占位符 `touristappid`）

2. **开通云开发**：微信开发者工具 → 云开发控制台，创建环境

3. **云环境 ID**：在 [src/app.tsx](src/app.tsx) 中将 `your-env-id` 替换为自己的云环境 ID：

```ts
const CLOUD_ENV_ID = 'your-env-id' // ← 替换这里
```

4. **部署云函数**：在微信开发者工具中，对 `cloudfunctions/` 下的每个函数右键 → 「上传并部署：云端安装依赖」

## 云函数列表

| 函数 | 说明 |
|---|---|
| `login` | 静默登录，基于服务端 OPENID 获取/创建用户 |
| `uploadMyEmoji` | 存入我的私有表情（名称/标签做长度截断） |
| `getMyList` | 获取我的作品列表 |
| `deleteMyEmoji` | 删除我的作品（校验归属） |
| `publishSharedEmoji` | 发布作品到广场 |
| `getSharedList` | 广场作品列表（分页） |
| `toggleLike` | 广场作品点赞/取消（原子操作） |
| `toggleFavorite` | 收藏/取消收藏 |
| `getMyFavorites` | 我的收藏列表 |
| `getSystemTemplates` | 系统模板 |

## 项目结构

```
├── config/               # Taro 构建配置
├── src/
│   ├── app.tsx           # 入口（云开发初始化、静默登录）
│   ├── pages/
│   │   ├── editor/       # 创作工坊（编辑器主体）
│   │   └── mine/         # 我的（作品/收藏/广场）
│   ├── components/       # 通用组件
│   ├── services/         # 业务服务（云端 API、本地存储）
│   ├── store/            # Zustand 状态
│   ├── data/             # 表情部件、贴纸库数据
│   └── utils/            # Canvas 工具
├── cloudfunctions/       # 微信云函数
└── types/                # 全局类型声明
```

## License

[MIT](LICENSE)
