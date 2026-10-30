<p align="center">
  <img src="docs/images/logo.png" width="96" alt="jn-clipboard" />
</p>

<h1 align="center">jn-clipboard</h1>

<p align="center"><b>你复制的东西，跟着你到每一台设备。</b></p>

<p align="center">
  <a href="https://github.com/JNNarrator/jn-clipboard/releases"><img src="https://img.shields.io/github/v/release/JNNarrator/jn-clipboard?label=VERSION&style=for-the-badge&color=2196F3" alt="版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/LICENSE-GPL--3.0-FF9800?style=for-the-badge" alt="许可" /></a>
  <img src="https://img.shields.io/badge/PLATFORM-macOS%20%7C%20Windows%20%7C%20Web-f44336?style=for-the-badge" alt="macOS、Windows 与网页" />
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

---

`jn-clipboard` 把你复制过的东西——文字、富文本、图片、文件路径——存进本地数据库，
需要时再交回剪贴板。它是一个程序的三种形态：macOS 上的菜单栏应用、Windows 上的
托盘应用、以及一个可以装到手机主屏的网页应用。

桌面版与网页版共用同一套界面；接入自建服务后，它们还共用同一份历史——电脑上复制，
手机上粘贴。

---

## 功能

|  |  |
| :--- | :--- |
| **采集** | 自动记录文字、富文本（HTML）、图片与文件路径。重复内容合并为一条；可以为某个应用单独设定规则，让它被忽略、或改写它贡献的内容。 |
| **查找** | 全文搜索，并按内容类型、来源应用、标签与日期筛选。置顶条目始终排在最前。 |
| **粘贴** | 一次按键直接粘贴回你原来的应用；也可以只复制不粘贴、以纯文本粘贴，或把若干条排队后按顺序粘贴。 |
| **整理** | 多色标签、可手动排序的置顶，以及给任意条目写备注。 |
| **观感** | 三款原生材质主题——Windows 上是云母与亚克力，macOS 上是系统毛玻璃——均含亮色与暗色。支持贴边收纳、紧凑预览窗口与面板宽度调节。 |
| **隐私** | 预览时自动遮蔽身份证号、手机号与邮箱；保存凭据的设置项在本机加密存放。默认不向任何地方发送数据。 |
| **同步** | 对接自己拥有的 WebDAV 服务，或用 JNClub 账号对接你自己部署的后端。 |
| **更新** | 启动时与在设置页手动触发时，向本仓库的 GitHub Releases 查询新版本。不做静默自动更新。 |

---

## 安装

| 平台 | 运行要求 | 获取方式 |
| :--- | :--- | :--- |
| **macOS** | 10.15 及以上，Apple Silicon 或 Intel | `.dmg` / `.app` |
| **Windows** | Windows 10 及以上，x64 | `.exe` 安装器、`.msi`，或便携版 `.zip` |
| **浏览器** | 任意现代浏览器，可作为 PWA 安装 | [jiangnan.88933.vip/clipboard](https://jiangnan.88933.vip/clipboard/) |

[**前往 Releases 下载最新版本 →**](https://github.com/JNNarrator/jn-clipboard/releases)

### 首次启动

安装包使用 ad-hoc 签名，没有经过 Apple 与微软的公证——背后没有付费的开发者证书，
所以两个系统在第一次都会拦下它。

**macOS** 会提示无法验证开发者：打开**系统设置 → 隐私与安全性**，向下滚动并点
**仍要打开**。1.0.2 之前的版本会直接报「已损坏」，就地修复：

```bash
xattr -dr com.apple.quarantine /Applications/jn-clipboard.app
codesign --force --deep --sign - /Applications/jn-clipboard.app
```

**Windows** 的 SmartScreen 会给出警告：**更多信息 → 仍要运行**。

随后 macOS 会请求**辅助功能**权限，它是「替你粘贴到前台应用」这一步的前提。
如果开关本来就是开着的、粘贴却仍然没有发生，说明系统里那条授权属于更早的一份构建：
在辅助功能列表里删掉 `jn-clipboard`，让程序重新添加自己即可。没有这项权限也能用，
只是需要你自己按 ⌘V。

### 网页版

网页版用同一套界面，数据存在 IndexedDB 里。网页无法监听系统剪贴板，所以它有一条
收录栏：粘贴或输入内容，按 ⌘/Ctrl+Enter 收下。其余功能——搜索、标签、置顶、备注——
与桌面版一致；登录 JNClub 账号后，看到的就是与桌面相同的历史。

---

## 主题

只带三款主题，没有别的：它们用的是系统自己的材质，而不是刷上去的皮肤。主题只改变
窗口的通透感与强调色表现，所以在一个主题里熟悉的布局，换到另一个还是一样。

本 fork 的早期版本还有六款纯外观主题（纸张、便签、复古、终端、收据、墨水）。它们
被删掉了——选哪一款全凭个人喜好，而保留它们意味着为一个对可用性毫无贡献的功能维护
六份样式表。升级后，如果配置文件里还留着其中某一款，会自动回落到平台默认主题。

---

## 同步

两条路线都是可选的，配置之前不启用。

**WebDAV** —— 指向一个你自己掌控的 WebDAV 目录。历史、附件与设置会以普通文件的
形式写进去，你可以用任何工具查看或备份。已经跑着 Nextcloud、ownCloud 或原生
WebDAV 服务时，用这条。

**JNClub** —— 用 JNClub 账号登录，桌面版与网页版通过你部署的后端共用一份历史。
登录流程会打开系统浏览器，令牌回传到程序临时监听的本机端口，且只接受这一个请求。
文字、标签、备注与置顶状态会同步；图片仍留在采集它的那台设备上。

服务端是 [JNClub](https://github.com/JNNarrator) 的一个模块
`jnclub-module-clipboard`，需要让每一台要同步的设备都能通过 HTTPS 访问到。

---

## 从源码构建

依赖：Node 20 及以上（CI 用 22）、stable 版 Rust 工具链，以及各平台常规工具链——
macOS 上的 Xcode 命令行工具，Windows 上的 MSVC 与 WebView2。

```bash
npm ci

npm run tauri:dev     # 桌面应用，热重载
npm run tauri:build   # 打桌面安装包
npm run build         # 只构建桌面界面  -> dist/web
npm run build:pwa     # 构建网页版      -> dist/pwa（基础路径 /clipboard/）
```

检查：

```bash
npm test              # vitest：前端单元测试
npm run lint          # eslint
npm run lint:styles   # 样式表的设计系统规则
npm run test:rust     # cargo test，含 Rust 单元与集成测试
npm run test:e2e      # 浏览器端到端用例（需先在 e2e/ 里单独 npm ci）
```

`npm run build:pwa` 假定文件由 `/clipboard/` 提供，且与同步 API 同源——因为 Service
Worker、会话 Cookie 与 API 三者必须对同一个源达成一致。API 在别处时，用
`VITE_JNCLUB_BASE_URL` 指过去；要换基础路径则用 `VITE_BASE_PATH`。

发布流程见 [docs/RELEASES.md](docs/RELEASES.md)，样式表遵循的设计系统见
[docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)。

---

## 目录结构

```
src/                 React 界面，桌面版与网页版共用
  features/          剪贴板列表、设置、标签管理
  shared/            hooks、平台抽象、设计令牌
  web/               仅网页版：IndexedDB 存储、同步引擎、Service Worker
src-tauri/           Rust 核心与 Tauri 外壳
  src/services/      剪贴板采集、WebDAV 同步、JNClub 同步客户端
  src/infrastructure/ 平台 API（macOS 面板、Windows 钩子、存储）
e2e/                 Playwright 用例，在真实浏览器里驱动界面
```

构建目标决定界面连到哪一侧：`VITE_TARGET=web` 时，`@tauri-apps/*` 会解析到
`src/web/shims/` 下的实现，把命令派发到 IndexedDB 后端而不是 Rust 后端。

---

## 隐私

没有统计、没有遥测、不向外发送任何标识。唯一的外部请求是你自己开启的那些——
WebDAV、JNClub——以及启动时和手动触发时的 GitHub 版本查询。

---

## 致谢与许可

`jn-clipboard` 由 jimuzhe 的
[tiez-clipboard](https://github.com/jimuzhe/tiez-clipboard) 派生而来，原项目以
[GNU GPL-3.0](LICENSE) 授权。它的设计与相当一部分实现属于上游项目；本 fork 沿用
同一许可，并保留上游版权声明。

本仓库所做的改动：移除 AI 动作、MQTT 码同步、局域网互传、第三方导入与表情面板，
删去六款纯外观主题，摘掉内置更新器与对上游公告、主题商店服务的调用，改为向本仓库
的 GitHub Releases 查询更新，并新增网页 / PWA 版本与一套自建同步后端。

如果想支持原项目，请到[上游仓库](https://github.com/jimuzhe/tiez-clipboard)。
