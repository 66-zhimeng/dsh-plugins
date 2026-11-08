# DSH plugins

个人使用的 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 插件集合。每个子目录都是一个可独立安装的 bundle：Host 半侧跑在 Node 进程里，Client 半侧通过插槽注册进 Web 界面，样式全部走宿主主题 token。

Personal collection of DeepSeek Harness plugins. Every subdirectory is a self-contained bundle: a Host half in the Node process and a Client half registered into the Web UI through slots.

## 插件列表

| 目录 | 包名 | 作用 |
|---|---|---|
| [`branch-tree/`](branch-tree) | `@local/dsh-git-graph-watermark` | 在对话右侧空白处画出当前分支与相邻分支的分叉树，悬停查看最新提交时间与短哈希。 |

## 安装

插件是本地 bundle，用 Harness 的插件管理器按目录安装即可：

```text
plugin_manager install_bundle  target=/absolute/path/to/dsh-plugins/branch-tree
```

或者手动写进 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: git-graph-watermark
      name: '@local/dsh-git-graph-watermark'
```

安装后刷新页面；Host 半侧改动需要重启 DSH。

## branch-tree

右侧白边里的一棵彩色分支树：

- **位置**：按对话内容列的真实宽度算右侧留白（`clamp(680px, 64%, 920px)` 之外），只画在空白里，不压正文；留白不足 104px（窗口太窄或右侧面板展开）时自动隐藏。
- **结构**：中间提交全部跳过，每条分支只画「分叉点 → 最新提交」，中段用虚线表示被省略的历史。
- **交互**：圆点是独立 HTML 命中层（`z-index` 高于滚动内容），悬停显示 `本地/远端 · 提交时间 · 7 位短哈希`。
- **本地/远端**：同一个提交只保留一条，本地分支优先；实心圆 = 本地分支，空心圆环 = 只有远端（`origin/*`）。主干顶端的朱砂点是当前分支的 HEAD。
- **配色**：水墨丹青（朱砂 / 花青 / 三绿 / 藤黄 / 胭脂 / 赭石 / 黛 / 苍青），按 `color-mix(… 84%, var(--dsw-alias-label-primary))` 与主题墨色调和，浅色压深、深色提亮。
- **数据**：`rev-parse`、`for-each-ref`、`merge-base`、`rev-list --count`、`log -1`，全部只读；每个仓库快照缓存 15 秒，页面切回、每 90 秒、每轮回答结束各刷新一次。
- **接口**：Host 在 `/api/plugin/git-graph-watermark` 注册同源 GET 路由（仅本机 owner peer 可达），返回 2KB 左右的渲染就绪 JSON。

## 目录约定

```text
dsh-plugins/
└── branch-tree/
    ├── package.json        # dsh.bundle.patch + dsh.client 声明
    ├── cordis.patch.yml    # 插入的 Loader 行
    ├── index.js            # Host 半侧
    ├── client.js           # Client 半侧（window.__ModuleLoader__）
    ├── locale/{zh,en}.json # 插件管理器里的标题与描述
    └── icon.svg
```
