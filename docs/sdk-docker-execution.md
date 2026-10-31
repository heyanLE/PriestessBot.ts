# SDK Docker 执行环境

`sdk_docker` 使用 OpenAI Agents SDK 的 `DockerSandboxClient` 管理容器、运行命令和读写文件。现有 Agent、三种运行态、工具授权和审批流程继续生效。

## 配置

在 Dashboard 的「执行环境」中选择「SDK Docker」，填写服务端工作根目录和容器镜像，再到 Agent 设置中绑定该环境。现有环境可以保留 ID，以免改变 Agent 和授权中的引用。

```json
{
  "id": "assistant-execution",
  "type": "sdk_docker",
  "root": "/home/heyanhub/apps/priestess/data/workspace",
  "image": "priestess-execution:20261028",
  "networkEnabled": true
}
```

`image` 省略时使用 `python:3.14-slim`。上例的 `priestess-execution:20261028` 是需要在服务器提前构建的应用镜像，包含 Python、Node.js、curl 和 GNU 工具，并非公开镜像。默认 Python 镜像不保证包含 curl、Node.js 等任务依赖。

从仓库构建专用镜像：

```sh
docker build -f deploy/Dockerfile.execution -t priestess-execution:20261028 deploy
```

发布包内文件为 `deploy/Dockerfile.execution`。如果服务器无法连接 Debian 官方源，可以添加 `--build-arg DEBIAN_MIRROR=http://mirrors.tuna.tsinghua.edu.cn`；APT 仍执行仓库签名验证。镜像还预装了 Git、zip/unzip、jq 和 PDF 文本提取工具。

服务器需要安装 Docker Engine 和 `docker` CLI。运行机器人服务的非 root 用户必须能执行 `docker info`，并可读写 `root` 目录。Docker 访问权限本身具有较高主机权限，应该仅授予受信任的服务账户。镜像需要 `/bin/sh`、GNU 文件工具（包括 `realpath`）和 Python；不建议直接使用只有 BusyBox 工具的 Alpine 镜像。SDK 的终端辅助功能也依赖 Python。

| 后端 | 网络 | 容器文件系统 |
| --- | --- | --- |
| `local` | 使用主机网络；不受 `networkEnabled` 控制 | 命令在主机运行 |
| `docker` | 固定禁网 | 保留原有只读根目录、cap-drop 等限制 |
| `sdk_docker` | `true` 使用 Docker 默认桥接网络；`false` 使用 `none` | SDK 默认可写根目录；工作文件使用持久目录 |

允许网络表示启用容器网络，不能保证目标网站可达。排查下载失败时，应以实际命令退出码、标准输出和错误输出为准。

## 文件和进程

- 命令默认在 `/workspace/files` 中通过 `/bin/sh` 执行。`read_file`、`write_file`、文件列表和补丁操作使用相对该目录的路径，经 SDK 在容器内完成。
- 持久目录沿用平台、群聊/私聊、会话、发送者、Agent 和会话代次的隔离规则。容器再按本次任务、运行态和授权版本区分，不复用其他用户的执行进程。
- `exec_command` 的参数为 `cmd`；执行未结束时返回会话 ID。`process_poll` 等待输出，`write_stdin` 接收 `session_id` 和 `chars`。`yield_time_ms` 控制本次等待时间，不是命令最长运行时间。
- 长输出在工具回复中截取头尾；使用 `process_read_output` 和返回的 `nextOffset` 读取保留部分。每个进程保留最多 16 MiB 日志；SDK 缓冲或应用日志发生丢弃时会报告截断，不能承诺无限完整输出。
- SDK 当前没有独立进程的强制终止接口，`process_kill` 会关闭该任务的容器，因此也会停止同一任务在该容器内运行的其他命令。任务取消、超时和服务停止也会清理容器；空闲容器会被回收。关闭容器会保留绑定的工作文件，容器根目录里的临时文件不会保留。

## 隔离边界与检查

应用会在把容器交给模型执行命令前，将资源限制设置为 512 MiB 内存、1 个 CPU、64 个进程，并校验非 root 身份、网络模式和挂载目录。初始化检查失败即返回启动错误，不会退回主机执行。

SDK 的公开创建接口目前没有提供旧 `docker` 后端全部加固参数。`sdk_docker` 使用 SDK 默认的可写容器根目录和 capability 设置，不能等同于原有的只读根目录、全部 capability 移除模式。它不挂载 Docker socket，也不向命令注入机器人服务的密钥环境变量。

启用前建议验证：短命令退出码、长命令轮询、标准输入、取消、文件读写、容器关闭后文件仍在，以及禁网/联网两种策略。Dashboard 的可用状态检查 Docker 服务是否可访问；具体镜像和初始化条件仍以首次执行结果为准。
