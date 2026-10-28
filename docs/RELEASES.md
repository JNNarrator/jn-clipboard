# jn-clipboard 客户端发布流程

`versions.json` 是客户端版本号的唯一来源，分别记录：

- `stable.windows` / `stable.macos`：正式版
- `beta.windows` / `beta.macos`：群测试版

构建脚本会把目标版本同步到 `package.json`、`src-tauri/Cargo.toml` 和
`src-tauri/tauri.conf.json`，并校验更新接口、发布渠道与 Git 标签。

## 群测试版

测试版必须使用 SemVer 预发布后缀，例如：

```json
{
  "beta": {
    "windows": "1.0.0-beta.1",
    "macos": "1.0.0-beta.1"
  }
}
```

推荐用 GitHub Actions 构建（两个平台都会签名，macOS 还会公证）：

1. 开一个只改 `versions.json` 的 PR，CI 通过后合并到 `master`。
2. 从 `master` 触发两个测试版工作流：

   ```bash
   gh workflow run release-beta-macos.yml --ref master -f git_ref=master
   gh workflow run release-beta-windows.yml --ref master -f git_ref=master
   ```

3. 产物是 GitHub 上的**草稿**预发布版（`beta-mac-v…`、`beta-v…`），只有维护者能看到。

不再为每个测试版单独建 `beta/…` 分支。

测试分两个阶段：

- **群测**：草稿保持不公开，维护者下载安装包发到测试群。
- **公测**：群里的问题处理完后，把草稿发布为预发布版（不要设为 Latest）。

也可以在对应系统上本地构建：

```bash
npm ci
npm run release:beta:win
# 或
npm run release:beta:mac
```

构建结束后脚本会恢复 package、Cargo 和 Tauri 配置，只保留
`versions.json` 中由维护者明确修改的版本号，避免误提交 beta 生成状态。

本仓库不附带自动更新：安装包不生成 updater 制品，也没有检查更新的界面。
发版只需要把安装包交给用户手动替换。

构建完成后：

1. 将安装包发送给测试群。
2. 测试通过后，把不带预发布后缀的版本写入 `stable`，再走正式发布。

## 正式版

更新 `stable` 版本后，在对应系统构建：

```bash
npm run release:stable:win
# 或
npm run release:stable:mac
```

GitHub Actions 正式发布标签：

- Windows：`v1.0.0`
- macOS：`mac-v1.0.0`

工作流会阻止标签、平台版本、Cargo、Tauri 配置或更新通道不一致的构建。

## 便携版

Windows 便携版没有安装器。用户需要下载新的便携包并替换程序文件，
原有 `data` 目录会继续保留。
