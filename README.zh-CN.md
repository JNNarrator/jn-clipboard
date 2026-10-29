<p align="left">
  <img src="docs/images/logo.png" width="32" vertical-align="middle" />
  <b>让碎片化信息轻松流转的剪贴板工具</b>
</p>

---

> **这是一个 fork。** `jn-clipboard` 派生自 jimuzhe 的
> [tiez-clipboard](https://github.com/jimuzhe/tiez-clipboard)，遵循 GNU GPL-3.0
> 使用与分发。程序本身的设计与实现归功于上游项目。
>
> 本 fork 的改动：移除 AI、MQTT 同步、局域网互传、第三方导入与表情功能，删去六款
> 纯皮肤主题，去掉自动更新与上游公告/主题商店请求（应用不再主动向外发包），并新增
> 与桌面共用同一套界面的 Web/PWA 版本（数据存 IndexedDB）。

> 维护者发布正式版或群测试版时，请参阅 [客户端发布流程](docs/RELEASES.md)。

<div align="center">
  <img src="docs/images/logo.png" alt="jn-clipboard Hero Logo" width="300" />

  ### **STAY FAST. STAY SYNCED.**

  | STARS | VERSION | LICENSE | PLATFORM |
  | :--- | :--- | :--- | :--- |
  | [![Version](https://img.shields.io/github/v/release/JNNarrator/jn-clipboard?label=VERSION&style=for-the-badge&color=2196F3)](https://github.com/JNNarrator/jn-clipboard/releases) | [![License](https://img.shields.io/badge/LICENSE-GPL--3.0-FF9800?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0) | [![Platform](https://img.shields.io/badge/PLATFORM-macOS%20%7C%20Windows%20%7C%20Web%20%2FPWA-f44336?style=for-the-badge)](https://github.com/JNNarrator/jn-clipboard) |

  [English](./README.md) | [简体中文](./README.zh-CN.md)
</div>

---

<div align="center">

## 主题展示 (Theme Gallery)

保留 3 款原生材质主题——Windows 上为云母 / 亚克力，macOS 上为系统毛玻璃材质，
均含亮色与暗色两种模式：

截图待补——旧截图里还是上游应用的名字。

---

## 为什么选择 jn-clipboard?

| 极速性能 | 深度工作流 | 本地隐私 | 云端流畅 |
| :--- | :--- | :--- | :--- |
| **瞬间响应**<br>Rust 核心层与原生监听器，只为追求毫秒级响应。 | **全能管理**<br>支持富文本、多色标签与灵活的检索筛选。 | **本地安全**<br>数据完全本地化存储，支持对各类敏感信息的预览自动脱敏。 | **多端无感同步**<br>基于 WebDAV 协议，让剪贴板在设备间流动。 |

---

## 核心功能

### 基础体验
- **原生效率**：基于 Tauri 2 和 Rust 构建，极致的内存占用与流畅度。
- **智能采集**：自动记录文字、富文本 (HTML)、图片、文件和目录路径。
- **现代美学**：完美支持 云母/亚克力 背景效果及暗黑模式，内置 **3 款原生材质主题样式**。
- **贴边收纳**：支持自动停靠在屏幕边缘，节省桌面空间且随时呼出。

### 管理与增强
- **标签系统**：通过自定义的多色标签对记录进行分类和整理。
- **高级设置**：精细化控制清理规则、全局快捷键映射及各种核心逻辑。
- **隐私脱敏**：智能识别身份证、手机号、邮箱等隐私信息，预览时自动脱敏。

### 网络与传输
- **WebDAV 同步**：数据由你掌控，实现完美的跨设备历史同步。

### 效率提速
- **全局搜索**：支持按内容、所属应用、标签或日期进行全文检索。
- **顺序粘贴**：为高频办公场景设计的顺序拷贝/顺序粘贴工作流程。

---

## 系统要求

### 平台支持
| 平台 | 运行环境要求 | 获取格式 |
| :--- | :--- | :--- |
| **macOS** | macOS 10.15+ <br>(Apple Silicon / Intel) | `.dmg` / `.app` |

[**前往 Releases 下载最新版本 →**](https://github.com/JNNarrator/jn-clipboard/releases)

---

## 致谢与许可

`jn-clipboard` 派生自 [jimuzhe/tiez-clipboard](https://github.com/jimuzhe/tiez-clipboard)，
原项目以 [GNU GPL-3.0](LICENSE) 授权。本 fork 沿用同一许可并保留上游版权声明，
上文列出的改动同样受其约束。

如果想支持原项目，请到[上游仓库](https://github.com/jimuzhe/tiez-clipboard)，而不是这里。

---

<div align="center">
  为每一位讲效率的开发者打造。
</div>
