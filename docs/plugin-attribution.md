# Native plugin source references and attribution

Recorded on 2026-10-26. The implementation uses the pinned repositories below as feature and protocol references. It does not import their Python modules, install their requirements, or execute downloaded plugin code. The TypeScript implementations use the runtime's own Agent, authorization, lifecycle, artifacts and Dashboard interfaces.

The retained upstream license texts are unmodified. Attribution to a reference repository does not mean that all of its capabilities have been implemented; see [the capability matrix](native-plugin-capabilities.md). These notices do not replace the license of the main project or of npm dependencies.

| Native ID | Pinned source | Upstream license and retained copyright |
| --- | --- | --- |
| `qq_file` | [xkeyC/astrbot_plugin_qq_file @ 170469683bfca4a73d31f847b7428d71775f19be](https://github.com/xkeyC/astrbot_plugin_qq_file/tree/170469683bfca4a73d31f847b7428d71775f19be) | [MIT](licenses/qq_file.txt), Copyright (c) 2026 xkeyC (xkeyc@qq.com) |
| `markdown_killer` | [xkeyC/astrbot_plugin_markdown_killer @ 36d77c80225f72801281d465946547380d5ce4cd](https://github.com/xkeyC/astrbot_plugin_markdown_killer/tree/36d77c80225f72801281d465946547380d5ce4cd) | [MIT](licenses/markdown_killer.txt), Copyright (c) 2025 Alan Z |
| `bili_video` | [xkeyC/astrbot_plugin_biliVideo @ 34e5ddf00939636daf753fb1652dfa681f21942b](https://github.com/xkeyC/astrbot_plugin_biliVideo/tree/34e5ddf00939636daf753fb1652dfa681f21942b) | [MIT](licenses/bili_video.txt), Copyright (c) 2025 storyAura |
| `bangumi` | [xkeyC/astrbot_plugin_bangumi @ 0ebac71ed75b42cce431384aafeca928b0ade3e4](https://github.com/xkeyC/astrbot_plugin_bangumi/tree/0ebac71ed75b42cce431384aafeca928b0ade3e4) | [Apache License 2.0](licenses/bangumi.txt), source metadata credits xkeyC. The pinned tree contains `LICENSE-2.0` and no separate `NOTICE` file. |
| `local_reminiscence` | [xkeyC/astrbot_plugin_local_reminiscence @ ff2c8bf65036af8a868f598c61941ae285095204](https://github.com/xkeyC/astrbot_plugin_local_reminiscence/tree/ff2c8bf65036af8a868f598c61941ae285095204) | [GNU AGPL version 3](licenses/local_reminiscence.txt), source metadata credits olozhika. This reference has a different license from the MIT plugins; its license must not be represented as MIT. |

Every pinned tree contains a license file. No independent `NOTICE` or `COPYING` file was present in the inspected tracked files. License texts are copied for attribution and reference, not relicensed.

## Implementation references

- QQ file list, folder traversal, album cursor handling, group member roles and upload-template behavior: pinned QQ file `main.py` and configuration. Native uploads replace the old temporary HTTP upload server with the runtime's authorized artifact/workspace resolver and signed delivery URLs.
- Group announcements and typed OneBot actions: [official NapCat API documentation](https://napneko.github.io/onebot/api), including `_get_group_notice`, `_send_group_notice` and `_del_group_notice`. No arbitrary OneBot action dispatcher is exposed to the model.
- Markdown cleanup, preserved list/code boundaries, independent table/formula fallback and newline controls: pinned Markdown `main.py`, `_conf_schema.json` and utility behavior. The implementation uses local Marked/KaTeX and a network-disabled Chromium context; it does not reuse the upstream Python renderer.
- Bilibili, Bangumi and local reminiscence: pinned source configuration, commands, data flows and API normalization. Native feature coverage and account/model prerequisites are recorded in the capability matrix.

## Distribution

Keep this attribution file and the `licenses/` directory with source distributions and packaged documentation. Dependency licenses remain those provided by the locked npm packages. A future change that directly incorporates upstream source or assets must retain the corresponding source notices and review the applicable license rather than assuming all five repositories use the same terms.
