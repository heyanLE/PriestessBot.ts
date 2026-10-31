# plugin-system — 插件系统

实现完整的插件生命周期管理，支持第三方扩展。

## 核心能力

- `Plugin`：插件接口，定义生命周期方法 `onLoad()` / `onEnable()` / `onDisable()` / `onUnload()`
- `PluginManifest`：插件清单（YAML/JSON），声明名称、版本、依赖、入口类
- `PluginClassLoader`：独立 ClassLoader 隔离每个插件，避免类冲突，支持安全的卸载
- `PluginManager`：管理插件的加载、启用、禁用、卸载、重载全生命周期
- `PluginRegistry`：插件发现和注册，扫描本地插件目录

## 扩展点

插件可注册的能力：
- 自定义 `Platform` 适配器
- 自定义 `Provider` 适配器
- 自定义 `FunctionTool`
- 自定义 `Skill`
- 自定义 Pipeline `Stage`
- 自定义 `AgentRunner`

## 插件市场

- `MarketplaceClient`：连接远程插件市场，浏览、搜索、下载插件
- 插件元数据索引和版本管理
- 一键安装和自动依赖解析
