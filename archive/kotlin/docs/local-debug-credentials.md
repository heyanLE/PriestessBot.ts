# 本机调试凭据

在项目根目录的 `local.properties` 中设置本机凭据：

```properties
# 这里填写自己的值；该文件不会提交到 Git。
DEEPSEEK_API_KEY=your-deepseek-key
TELEGRAM_TEST_TOKEN=your-telegram-test-token
# 使用 CODEX 时填写支持 Responses API 的服务密钥；普通调试可不填。
CODEX_RESPONSES_API_KEY=your-responses-api-key
```

`run-server.sh` 和 `run-local-debug.sh` 使用同一个解析器。优先级为：已设置的环境变量 → `local.properties` → 兼容文件 `.env.local-debug`。显式设置为空的环境变量也不会被文件覆盖；本地调试脚本会提示缺少凭据。

仅加载上述三个键。支持空行、行首 `#` / `!` 注释、赋值周围空白、CRLF、末行无换行，以及可选成对引号。旧文件中的 `export KEY=value` 仍受支持。值按字面量读取，不执行命令、不展开变量、不解释反斜杠转义；行内 `#` 属于值。载入凭据时会关闭 shell 命令追踪，启动脚本不会打印值。

本地调试使用 `./run-local-debug.sh` 和 `config.local-debug.json`。它不会更改普通服务的配置文件，也不会把凭据写入应用 JSON。

解析器回归测试使用临时目录和假值，可运行：

```bash
bash scripts/test-local-properties.sh
```

## Telegram 本机代理

当前设备的 Telegram 网络需要通过本机 HTTP 代理。IM 的连接页可填写「HTTP 代理地址」，对应 `ims[].settings.proxyUrl`，例如 `http://127.0.0.1:7890`；留空直连。CIO 不会自动沿用 macOS 系统代理。代理地址保存在已忽略的本地调试配置中，凭据仍只从 `local.properties` 读取。

“运行中”表示适配器任务已启动。确认网络正常还应查看日志中的机器人身份验证、轮询连接成功和消息入站记录。轮询 401、409 或网络超时会记录经过脱敏的错误摘要。
