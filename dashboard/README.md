# Priestess Console Dashboard

新 Dashboard 前端。旧 Vue Dashboard 已归档到 `../archive/dashboard-vue-20261117/`。

## 结构

- `index.html`：六 Tab shell、登录层、图标 sprite
- `styles.css`：新设计样式
- `app.js`：真实 API 客户端与六个页面渲染
- `build.mjs`：把源文件复制到 `dist/`

## 构建

```bash
npm --prefix dashboard run build
```

生产服务读取 `dashboard/dist`。没有独立依赖，不需要 `npm install`。

## 已接真实 API

- 登录 / 登出：`/api/ts/auth/*`
- 配置与 revision：`/api/ts/config`
- IM 状态：`/api/ts/platforms`
- Agent 运行记录：`/api/ts/agent-records`
- 能力目录：`/api/ts/agent-capabilities`
- 工作区三区：`/api/ts/workspace`
- 环境：`/api/ts/environments`
- 人格列表：`/api/ts/personas`

## 已支持的操作

- 登录管理服务
- 查看六个 Tab
- 工作区文件浏览器：目录浏览、上传、下载、预览、新建文件夹、移动、删除
- 控制台对话：新建会话、发送消息、轮询回复
- Flow 模拟：按平台/会话/发送者模拟路由结果
- 保存 Agent 的显示名称、模型、连接、系统提示词、启用状态、工具开关、资源绑定、人格绑定、上下文压缩、委派、记忆提取和运行限制
- Agent 示例对话、技能 allowlist、语音提示、自定义错误回复
- Agent 模型测试：真实模型调用，不执行工具/不发送 IM
- 新建/删除 Agent
- IM 新增、编辑、删除和启停；Telegram / NapCat / 微信字段；消息路由规则、发送者授权、微信扫码登录
- 运行记录详情、停止运行、工具审批、进程列表/终止（活动运行）、导出运行记录和产物下载
- 资源页四个子页：Skill / MCP、人格、知识库、长期记忆
- 平台能力配置：所有插件入口；QQ 群文件/Markdown/Bangumi/本地回忆/回答剧本专用表单；B 站扫码登录链接/本地二维码和轮询、B 站/Bangumi 订阅
- 人格新建、编辑和删除
- 知识库/记忆库新建与删除
- 会话管理：搜索、查看消息、归档/取消归档、删除、导出
- 配置版本：恢复历史修订、导入配置 JSON
- 模型服务新增/编辑/删除；服务端密钥管理；管理审计
- 网络搜索设置；原生扩展列表/启停
- 知识库文档列表、导入、重建索引、删除和检索
- 长期记忆列表、新增、编辑和删除
- 导出当前配置
- 退出登录

## 说明

- 配置保存会创建新 revision；`workspace` 字段由新前端原样提交。
- 已提供 QQ 群文件、Markdown、Bangumi、本地回忆、回答剧本的专用设置表单；不需要拖拽式 Flow。
- 仍未解决：B 站上游扫码登录返回 400。
- 旧生产静态文件备份在 release 的 `dashboard.pre-new-20261117/`。
- 左上角使用 `dashboard/assets/priestess-icon.jpg`。
