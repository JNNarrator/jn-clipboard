<p align="center">
  <img src="docs/images/logo.png" width="96" alt="jn-clipboard" />
</p>

<h1 align="center">jn-clipboard</h1>

<p align="center"><b>你复制的东西，跟着你到每一台设备。</b></p>

<p align="center">
  <a href="https://github.com/JNNarrator/jn-clipboard/releases"><img src="https://img.shields.io/github/v/release/JNNarrator/jn-clipboard?label=VERSION&style=for-the-badge&color=2196F3" alt="版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/LICENSE-GPL--3.0-FF9800?style=for-the-badge" alt="许可" /></a>
  <img src="https://img.shields.io/badge/PLATFORM-macOS%20%7C%20Windows%20%7C%20Web-43A047?style=for-the-badge" alt="macOS、Windows 与网页" />
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

---

`jn-clipboard` 把你复制过的东西——文字、富文本、图片、文件路径——存进本地数据库，需要时
再交回剪贴板。它是一个程序的三种形态：macOS 上的菜单栏应用、Windows 上的托盘应用、
以及一个可以装到手机主屏的网页应用。

三者共用同一套界面；接入自建后端后，还共用同一份历史——电脑上复制，手机上粘贴，
通常在你切过去之前就已经到了。

---

## 为什么是它

- **图片也跨端同步。** 截图按内容摘要只存一份，哪台设备打开就流向哪台；置顶、打标签
  这类小改动不会把图片字节重新传一遍。
- **删除就是删除。** 删除以墓碑形式落库，且「删除赢过并发编辑」——你删掉的条目不会
  因为某台旧设备的补拉而复活。
- **重复自己收敛。** 两台设备各复制的同一句话，按一套所有设备都独立得出同样结论的
  规则合并成一条，不需要互相商量。
- **近乎实时的同步。** 桌面端与服务器保持一条变更流，网页端用「只问一个数字」的轻量
  探测——同步延迟是一次网络往返，而不是一个轮询周期。
- **本地优先，隐私为本。** 数据库是你磁盘上的 SQLite / IndexedDB；不登录你自己部署的
  服务器，任何数据都不出设备；敏感条目在每台设备上都是加密落盘的。

---

## 功能

| | |
| :--- | :--- |
| **采集** | 自动记录文字、富文本（HTML）、图片与文件路径。重复内容合并为一条；可以为某个应用单独设定规则，让它被忽略、或改写它贡献的内容。 |
| **查找** | 全文搜索，命中位置直接在预览里标出；并按内容类型、来源应用、标签与日期筛选。置顶条目始终排在最前。设置页也有自己的搜索框。 |
| **粘贴** | 一次按键直接粘贴回你原来的应用；也可以只复制不粘贴、以纯文本粘贴，或把若干条排队后按顺序粘贴。 |
| **整理** | 多色标签、可手动排序的置顶，以及给任意条目写备注。Cmd/Ctrl 或 Shift 点击可多选，批量打标签或删除（删除有短暂撤销窗口）；代码条目在列表与详情里都有轻量语法着色（JSON 的键与字符串一眼可辨）。 |
| **观感** | 三款原生材质主题——Windows 上是云母与亚克力，macOS 上是系统毛玻璃——均含亮色与暗色。支持贴边收纳、紧凑预览窗口与面板宽度调节。 |
| **隐私** | 预览时自动遮蔽身份证号、手机号与邮箱；敏感条目用设备本地密钥加密存放。默认不向任何地方发送数据。 |
| **同步** | 用 JNClub 账号对接你自部署的后端：历史、标签、备注、置顶——以及图片——在 macOS、Windows 与网页之间保持一致。 |
| **更新** | 启动时与设置页手动触发时查询新版本；更新源自带兜底镜像，GitHub 连不上也能正常更新。 |

---

## 安装

| 平台 | 运行要求 | 获取方式 |
| :--- | :--- | :--- |
| **macOS** | 10.13 及以上，Apple Silicon 或 Intel | `.dmg` / `.app` |
| **Windows** | Windows 10 及以上，x64 | `.exe` 安装器、`.msi`，或便携版 `.zip` |
| **浏览器** | 任意现代浏览器，可作为 PWA 安装 | [jiangnan.88933.vip/clipboard](https://jiangnan.88933.vip/clipboard/) |

[**前往 Releases 下载最新版本 →**](https://github.com/JNNarrator/jn-clipboard/releases)

### 首次启动

全新安装首次打开时，会有一张可随时跳过的四步引导卡——点击即粘贴、键盘流、搜索语法与批量整理。它每台设备只出现一次，已有历史记录的用户不会看到。

安装包使用 ad-hoc 签名，没有经过 Apple 与微软的公证——背后没有付费的开发者证书，
所以两个系统在第一次都会拦下它。

**macOS** 会提示无法验证开发者：打开**系统设置 → 隐私与安全性**，向下滚动并点
**仍要打开**。1.0.2 之前的版本会直接报「已损坏」，就地修复：

```bash
xattr -dr com.apple.quarantine /Applications/jn-clipboard.app
codesign --force --deep --sign - /Applications/jn-clipboard.app
```

**Windows** 的 SmartScreen 会给出警告：**更多信息 → 仍要运行**。

随后 macOS 会请求**辅助功能**权限，它是「替你粘贴到前台应用」这一步的前提。如果开关
本来就是开着的、粘贴却仍然没有发生，说明系统里那条授权属于更早的一份构建：在辅助
功能列表里删掉 `jn-clipboard`，让程序重新添加自己即可。没有这项权限也能用，只是需要
你自己按 ⌘V。

### 网页版

网页版用同一套界面，数据存在 IndexedDB 里。网页无法监听系统剪贴板，所以它有一条
收录栏：粘贴或输入内容，按 ⌘/Ctrl+Enter 收下。其余功能——搜索、标签、置顶、备注——
与桌面版一致；登录 JNClub 账号后，看到的就是与桌面相同的历史，图片也在其中。

---

## 主题

只带三款主题，没有别的：它们用的是系统自己的材质，而不是刷上去的皮肤。主题只改变
窗口的通透感与强调色表现，所以在一个主题里熟悉的布局，换到另一个还是一样。

本 fork 的早期版本还有六款纯外观主题（纸张、便签、复古、终端、收据、墨水）。它们被
删掉了——选哪一款全凭个人喜好，而保留它们意味着为一个对可用性毫无贡献的功能维护
六份样式表。升级后，如果配置文件里还留着其中某一款，会自动回落到平台默认主题。

---

## 同步

同步是可选的，登录之前不启用。启用后走的是 **JNClub**——用 JNClub 账号登录，桌面版
与网页版通过你部署的后端共用一份历史。登录流程会打开系统浏览器，令牌回传到程序临时
监听的本机端口，且只接受这一个请求。

协议给出的保证：

- **服务端分配的序号**驱动增量拉取；游标不会跳过其他设备的写入，每条记录带修订号做
  乐观锁。
- **删除即墓碑，删除赢**：与并发编辑竞争时删除获胜，「删掉的条目」在所有设备上都是
  终局的。
- **重复副本能确定性合并**——最早收录者胜、平手比条目标识，败者的身份作为墓碑发
  出——所有设备无需协商就收敛到同一条。
- **附件按 SHA-256 内容寻址**并带引用计数；每夜巡检只清理「引用归零满一周」的存储。
- **设备私有设置绝不外传。** 窗口尺寸、游标与令牌留在所属机器上；使用计数是本地的，
  粘贴一次不会产生网络流量。
- **敏感条目**（打了敏感标签的）经 HTTPS 明文传输到你自己的服务器，在每台设备上各自
  加密落盘。

服务端是 [JNClub](https://github.com/JNNarrator) 的一个模块 `jnclub-module-clipboard`，
需要让每一台要同步的设备都能通过 HTTPS 访问到。旧版 WebDAV 引擎已在 1.0.8 退役；
构建开关（`VITE_WEBDAV_SYNC=1`）仍能调出它做一次性迁移，但默认界面只保留 JNClub
同步。

### 从 ≤ 1.0.7 升级须知

旧版本存在一个游标缺陷，可能把离线期间其他设备写入的记录永久跳过。升级可以阻止它
再次发生；若某台设备上已经有条目缺失，在应用退出的状态下把本地数据库的同步游标
（`jnclub.sync_last_seq`）重置为 `0`，下次同步会全量重拉一遍——重复的合并、已知的跳过，
不会丢东西。

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

⚠️ 部署网页版用 `build:pwa`（带 `/clipboard/` 基础路径），不要用 `build:web`——后者
产出根路径引用，部署到子路径会全量 404 白屏。

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
  src/services/      剪贴板采集、JNClub 同步客户端
  src/infrastructure/ 平台 API（macOS 面板、Windows 钩子、存储）
e2e/                 Playwright 用例，在真实浏览器里驱动界面
```

构建目标决定界面连到哪一侧：`VITE_TARGET=web` 时，`@tauri-apps/*` 会解析到
`src/web/shims/` 下的实现，把命令派发到 IndexedDB 后端而不是 Rust 后端。

---

## 隐私

没有统计、没有遥测、不向外发送任何标识。唯一的外部请求是你自己开启的 JNClub 同步，
以及启动时和手动触发时的版本查询——GitHub 不可达时自动回落到自托管镜像。

---

## 致谢与许可

`jn-clipboard` 由 jimuzhe 的 [tiez-clipboard](https://github.com/jimuzhe/tiez-clipboard)
派生而来，原项目以 [GNU GPL-3.0](LICENSE) 授权。它的设计与相当一部分实现属于上游
项目；本 fork 沿用同一许可，并保留上游版权声明。

本仓库所做的改动：移除 AI 动作、MQTT 码同步、局域网互传、第三方导入与表情面板，删去
六款纯外观主题，摘掉内置更新器与对上游公告、主题商店服务的调用，改为向本仓库的
GitHub Releases 查询更新；新增网页 / PWA 版本与一套自建同步后端——后续又以删除即
墓碑、确定性去重、内容寻址附件与实时变更流进一步加固。界面层陆续加入搜索命中高亮、
设置搜索、多选批量与删除撤销、代码着色、无障碍补齐与首启引导。

如果想支持原项目，请到[上游仓库](https://github.com/jimuzhe/tiez-clipboard)。
