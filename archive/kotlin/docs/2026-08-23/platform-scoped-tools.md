# Platform-scoped tools

Platform adapters can contribute tools without registering executable instances in the global tool controller. `PlatformRegistry` exposes their schemas to strict configuration compilation, while `Platform.platformTools()` contributes executables only to the Agent run handling the current message. Workspace, Agent, risk, and sender-permission filters still apply before a tool is advertised or executed.

## NapCat 4.18.6 tools

| Tool ID | Purpose | Risk | Default | Permission |
| --- | --- | --- | --- | --- |
| `napcat_reply_message` | Reply to the current inbound message | `SESSION_ACTION` | enabled | operator |
| `napcat_mention_user` | Mention a user in the current group | `SESSION_ACTION` | enabled | operator |
| `napcat_received_files` | Inspect files attached to the current message | `SAFE_READ` | enabled | ordinary operator (`OPERATOR`) |
| `napcat_list_group_files` | List files in the current group | `EXTERNAL_READ` | enabled | ordinary operator (`OPERATOR`) |
| `napcat_get_group_file_url` | Resolve a current-group file URL | `EXTERNAL_READ` | enabled | ordinary operator (`OPERATOR`) |
| `napcat_send_file` | Upload an HTTP(S) URL to the current session | `HIGH_RISK` | disabled | senior operator (`ADMIN`) |
| `napcat_delete_group_file` | Delete a file in the current group | `HIGH_RISK` | disabled | senior operator (`ADMIN`) |
| `napcat_create_group_folder` | Create a folder in the current group | `HIGH_RISK` | disabled | senior operator (`ADMIN`) |
| `napcat_delete_group_folder` | Delete a folder in the current group | `HIGH_RISK` | disabled | senior operator (`ADMIN`) |

Targets are always derived from the current message session. Model arguments cannot provide another group or user target. The adapter owns the NapCat token and applies it internally; tool arguments and results never contain that credential.

## Workspace policy

If `toolPolicy.allow` is empty, the five default-enabled tools are eligible and the four high-risk tools remain absent. If the Workspace already has an explicit allowlist, append the desired IDs to it; replacing the list would disable every omitted existing tool.

To enable reply and read-only group-file operations in an explicit allowlist:

```yaml
toolPolicy:
  allow:
    - napcat_reply_message
    - napcat_mention_user
    - napcat_received_files
    - napcat_list_group_files
    - napcat_get_group_file_url
```

Group-file reads are available to ordinary operators. To enable a write, add its exact ID and keep `HIGH_RISK` in both the Workspace and Agent `allowedRiskLevels`. The sender must resolve to senior operator (`ADMIN`) or `SUPER_ADMIN`. Enabling a high-risk tool does not make it available on Telegram, Weixin, private sessions for group-only actions, or to ordinary operators.

## NAS rollout and rollback

1. Back up the active global and Workspace configuration files and record the current release target.
2. Install the new distribution into a new immutable release directory; do not overwrite the active release.
3. Start a canary with copied configuration/data and a different Dashboard port. Verify health, configuration compilation, and one NapCat private message without enabling high-risk IDs.
4. Append the five safe IDs when the Workspace uses an explicit allowlist, activate the release symlink, and restart the service.
5. Verify a reply, a group mention, group-file listing, and a Telegram/Weixin message that has no NapCat tool advertisement.
6. Enable high-risk IDs individually only after the safe set is stable. Verify each action in a disposable QQ group/folder.

Rollback is configuration-first: remove the new tool IDs and reload/restart. If the binary itself is unhealthy, point the active release symlink back to the recorded previous release and restart. The change adds no required persisted fields, so the previous binary can reuse the original backed-up configuration.
