# `@deepseek-ai/dsh-tavern`

[English](README.md) | 中文

可选的 dsh Web profile patch layer。它使用 `DSH_WEB_HOST` 和 `DSH_WEB_PORT` 配置 Web 服务绑定地址（默认 `0.0.0.0:3080`），并把 [`ui-tavern`](../../client/ui-tavern/README.md) 加入浏览器插件列表。该 bundle 同时加载 Tavern Host service，用于保存导入资源、记录会话选择，并把当前 persona 与 World Info 投影到后续请求。

在完成构建的源码仓库中运行：

```sh
corepack pnpm run tavern
```

Web 参数可以通过 `--` 继续传入，例如 `corepack pnpm run tavern -- --port 3081`。等价的显式命令是 `corepack pnpm dsh web --patch packages/bundle/tavern/cordis.patch.yml`。

使用本地角色卡和世界书 JSON 验证构建产物时，运行 `DSH_TAVERN_CHARACTER_JSON=... DSH_TAVERN_WORLD_INFO_JSON=... corepack pnpm test:tavern:release`（PowerShell 使用 `$env:DSH_TAVERN_CHARACTER_JSON=...` 和 `$env:DSH_TAVERN_WORLD_INFO_JSON=...`）。该检查使用本地 mock 模型，不需要 Docker 或真实 API key。

在仓库根目录构建并运行首个可部署容器：

```sh
docker build -f Dockerfile.tavern -t dsh-tavern .
docker run --rm -p 3080:3080 -v dsh-tavern-data:/data/.dsh dsh-tavern
```

Web 服务启动后访问 `http://127.0.0.1:3080/`。

这个 layer 选择专用的 `tavern` agent preset，以完整 persona 启动直接角色扮演会话，并且不加载编码工具行。工作台支持导入 JSON 角色卡和 World Info，将选择保存到当前 Session，并提供 Memory、规范的位置/时间 Story State、候选 Swipe 选择、在子 Session 中重新生成以及最近一次已记录的 system prompt。通用 fork、群聊和场景编排仍属于独立能力。

## 模型体验

浏览器插件本身不增加模型可见文本；选择角色卡或 World Info 后，Host runtime 会通过会话投影改变后续请求。

#### KV Cache 影响

无。这个 patch 不改变 provider 请求。

## 已知限制与后续工作

- **开发版 bundle**：当前从源码仓库运行，尚未作为独立 Tavern 发行包发布。
- **环境配置**：默认绑定所有网卡，适合容器或受信任的本地网络；只允许本机访问时设置 `DSH_WEB_HOST=127.0.0.1`。
