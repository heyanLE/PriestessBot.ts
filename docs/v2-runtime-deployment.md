> 此文记录旧版部署方式。当前 v3 请使用 [配置说明](configuration-v3.md) 与仓库根目录 `deploy-nas.sh`，不再从本地 BAT 生成 NAS 配置。

# v2 Runtime Deployment

## Local Docker

Create `deploy/config/config.json` and enable the Dashboard API:

```json
{
  "server": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 8080
  }
}
```

Run:

```bash
docker compose up --build -d
```

Health:

```bash
curl http://127.0.0.1:8080/health
```

## NAS

For the existing SSH-based NAS flow, generate a config with `server.enabled=true`, sync the Gradle distribution, then start with:

```bash
PRIESTESS_CONFIG_PATH=/home/heyanhub/apps/priestessbot/config/config.json \
  /home/heyanhub/apps/priestessbot/current/bin/astrbot.kt
```

Persist these directories:

- `/home/heyanhub/apps/priestessbot/config`
- `/home/heyanhub/apps/priestessbot/data`
- `/home/heyanhub/apps/priestessbot/logs`
- `/home/heyanhub/apps/priestessbot/plugins`

From a local Windows development checkout, deploy with:

```bat
deploy-nas.local.bat
```

The local launcher reads the same runtime values from `src/test/run-pipeline-manual.local.bat`, including NapCat host/ports, provider URL/key, model, prompt, prefix, and max step settings. It builds the Gradle distribution with the dashboard, uploads it to `heyanhub@192.168.31.24`, writes the generated NAS config, and restarts the app.
