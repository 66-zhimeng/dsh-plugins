# 插件市场索引

`index.json` 是这个仓库提供的插件市场索引，格式为 DSH 的 **format 1**（`@deepseek-ai/dsh-plugin-market-index`）。

- 索引地址：`https://raw.githubusercontent.com/66-zhimeng/dsh-plugins/main/market/index.json`
- 在 DSH 里加一次即可：设置 → 插件 → 发现 → 添加索引源，填上面的 URL；或直接写进 profile 的 `cordis.patch.yml`：

```yaml
- id: plugin-market
  config:
    indexes:
      - https://raw.githubusercontent.com/66-zhimeng/dsh-plugins/main/market/index.json
```

## 收录规则

每个插件一条 `plugins[]`，`versions[]` 按 SemVer 从高到低排列。`source` 二选一：

| 类型 | 例子 | 说明 |
| --- | --- | --- |
| `npm` | `{"type":"npm"}` | 从 npm 装；发过的包用这个最简单 |
| `git` | `{"type":"git","url":"https://github.com/…/repo","commit":"<40位SHA>","path":"subdir"}` | 从 Git 装，**必须固定到 40 位 commit**；`path` 是包所在子目录，仓库根可省略 |

注意：

- `commit` 必须是完整 40 位 SHA，短哈希会被拒。
- 索引只声明「能装什么」，实际内容以被安装包的 `package.json` 为准。
- 更新插件 = 改 `versions[]`（新增一条，`publishTimestamp` 用 Unix 秒）+ 换 `commit`，然后提交。

## 校验

提交前跑一遍格式校验（本机 DSH 安装里就有校验器）：

```powershell
node -e "const fs=require('fs');import('file:///D:/Tools/PiAgent/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js').then(m=>{const j=JSON.parse(fs.readFileSync('market/index.json','utf8'));m.parseMarketIndex(j,'https://raw.githubusercontent.com/66-zhimeng/dsh-plugins/main/market/index.json');console.log('VALID',j.plugins.length,'plugins')})"
```
