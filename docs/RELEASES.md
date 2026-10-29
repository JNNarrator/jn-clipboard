# jn-clipboard 客户端发布流程

`versions.json` 是客户端版本号的唯一来源：

- `stable.windows` / `stable.macos`：正式版
- `beta.windows` / `beta.macos`：预发布版

`scripts/apply-app-version.mjs <platform> <channel>` 会把目标版本同步到
`package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`；
`scripts/build-release.mjs` 在构建时自动调用它，并在结束后恢复这些文件，
只保留 `versions.json` 里由维护者改动的版本号。

## 发一个正式版

1. 改 `versions.json` 的 `stable.macos` 与 `stable.windows`（两者同步升版，
   因为 Windows PE 资源无法容纳超过 4 段的版本号），提交并推送 `master`。
   想本地同步这三个文件就运行 `node scripts/apply-app-version.mjs <平台> stable`，
   它也会顺带刷新 `src-tauri/Cargo.lock` 里的 crate 版本——CI 用 `--locked`
   跑测试，忘记刷新会直接编译失败。
2. 从 `master` 打标签并推送：

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   `scripts/validate-release.mjs` 接受 `vX.Y.Z`，也兼容早期只给 macOS 用的
   `mac-vX.Y.Z`。

3. `.github/workflows/release-desktop.yml` 在三个平台构建
   （`macos-14` arm64、`macos-15-intel` x64、`windows-latest` x64），
   下载产物后创建**草稿** Release，资产包括：

   - `jn-clipboard_X.Y.Z_aarch64.dmg`（Apple Silicon）
   - `jn-clipboard_X.Y.Z_x64.dmg`（Intel）
   - `jn-clipboard_X.Y.Z_x64-setup.exe`（NSIS 安装器）
   - `jn-clipboard_X.Y.Z_x64_en-US.msi`
   - `jn-clipboard-portable.zip`（Windows 便携版）

4. 检查产物后把草稿发布出来。**发布这一步就是上线**：应用里的「检查更新」
   查询 `releases/latest`，而 GitHub 只在发布（非草稿、非预发布）的 Release
   里挑最新一个。

日常构建（不发布）用 `.github/workflows/build-desktop.yml`：推送 `master`
或手动 `workflow_dispatch` 都跑，产物是 14 天保留期的 Actions artifact。

## 预发布版（群测试）

把版本写成带 SemVer 后缀的形式，例如 `1.0.0-rc.1`，改 `beta.*` 后推送
`master` 触发 `build-desktop.yml`，得到 artifact 发到测试群。要让它出现在
Release 页，同样打标签，然后在发布草稿时勾上「pre-release」——被标记为
pre-release 的版本不会被 `releases/latest` 返回，正式版用户不会收到提示。

## 签名与更新

- 安装包**未签名**：没有 Apple Developer ID，也没有 Windows 代码签名证书。
  macOS 首次运行需在「系统设置 → 隐私与安全性」里放行，Windows 会弹
  SmartScreen 警告。
- 不生成 updater 制品，也没有原地升级：`tauri-plugin-updater` 已移除。
- 更新检查只是查询 GitHub 的 `/releases/latest` 并与当前版本比较
  （见 `src-tauri/src/app/commands/update_cmd.rs`），发现新版本时给出跳转
  到 Release 页的按钮，安装仍需用户手动替换。

## 本地构建

也可以在对应系统上本地打包：

```bash
npm ci
npm run release:stable:mac   # 或 release:stable:win
```

构建结束后脚本会恢复 package、Cargo 和 Tauri 配置，只保留 `versions.json`
中明确修改的版本号，避免误提交构建状态。

## 便携版

Windows 便携版没有安装器：用户下载新的便携包替换程序文件即可，原有
`data` 目录继续保留。
