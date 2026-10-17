# Mosharp 1.0.0

面向 10 万行仍可编辑的 Markdown 编辑器。

实时预览只装饰当前视口：标记默认隐藏，光标正在输入的那一段符号会露出来，方便确认；整行仍保持排版。公式、代码高亮、图片和图表只在滚进视口时挂上，滚出就卸掉。表格在单元格里修改，复选框点一下只切换勾选。打开、保存、导出和 10 万行基准走同一条 CodeMirror 缓冲。

Tauri 2 + SolidJS + CodeMirror 6。Windows 桌面应用（WebView2）。

---

## 特性

**编辑内核**

- 实时预览与源码模式共用同一份缓冲，`Ctrl+/` 只开关装饰，不重新排版全文
- 只装饰视口，重型块按可见性挂载/卸载；文档规模不影响输入路径
- 打字机模式、专注模式、正文栏宽三档（640 / 780 / 1080）
- 撤销 / 重做，查找替换（大小写、全字、正则）
- 内置 10 万行基准：帮助 → 10 万行基准

**写作**

- CommonMark + GFM：标题、列表、任务列表、引用、代码块、表格、分隔线
- `==高亮==`、上下标、脚注、emoji（`:` 触发选择器）、参考式链接
- 选中文字出现浮动格式条；行首 `/` 打开插入菜单；段落左侧 `⋮` 菜单
- 富文本复制，粘贴到邮件或聊天工具时保留格式
- 标题锚点跳转，中文标题可用（按住 `Ctrl` 再点）

**视口内的重块**

- KaTeX 行内公式与公式块
- 代码块语法高亮 + 语言选择
- 本地图片显示与拉伸、剪贴板粘贴图片（存为 `assets/` 相对路径）
- Mermaid、Vega / Vega-Lite、PlantUML，同样只渲染视口内的块

**文件与会话**

- 原子保存：先写同目录临时文件再替换，写失败不留半截
- 编码识别与回写：UTF-8 / UTF-8 BOM / UTF-16 LE / UTF-16 BE / GBK；超过 64 MB 拒绝打开
- CRLF 文件保存后仍是 CRLF；YAML frontmatter 原样写回
- 外部程序改写文件后自动重载；有未保存修改时提示冲突而不是覆盖
- 多标签，各自保留内容、脏状态、撤销历史、滚动位置、编码与行尾
- 启动恢复上次会话；关闭/丢弃未保存内容前写入恢复副本
- **双击 `.md` 直接打开该文件**（文件关联 + 单实例：已运行时并入现有窗口）

**外观与语言**

- 15 套主题：8 套浅色（纸色、浅色、雅致、简白、作家、熊红、羊皮纸、Cadmium Light）、7 套深色（深色、午夜、夜航、极地、暖木、德古拉、Material Dark）
- 编辑器可指定字体与字号，优先于主题默认
- 7 种界面语言：简体中文、繁體中文、English、日本語、Deutsch、Français、Español
- Windows 自带拼写检查，语言可切换，可维护自定义词表

**导出**

- 带主题背景的 PDF（页边距跟随主题底色）
- 独立 HTML
- Word（.docx）
- 按阅读宽度的连续长图 PNG，超长自动编号分页
- 幻灯片：一条 `---` 一页，全屏放映，从光标所在页开始；可导出 16:9 幻灯片 PDF

---

## 开发

```bash
cd Mosharp                      # 仓库根目录（含 package.json 的那一层）
npm install
npm run tauri dev               # 桌面窗口，首次会编译 Rust
```

只调界面、不访问本机文件时：

```bash
npm run dev                     # 浏览器打开 http://localhost:1420
```

打开、保存、文件监听、导出 PDF 只在桌面窗口下可用。

**校验**

```bash
npm run check                                            # tsc --noEmit
npm test                                                 # 前端测试
cargo test --manifest-path src-tauri/Cargo.toml --lib     # Rust 测试
```

`npm run tauri dev` 同时只允许一个实例运行——第二个会聚焦第一个窗口，这是单实例插件的预期行为。

## 打包

```bash
npm run tauri build
```

会依次执行 `npm run build`（前端）→ release 编译 Rust → 生成安装包。产物：

| 路径 | 说明 |
| :--- | :--- |
| `src-tauri/target/release/mosharp.exe` | 免安装可执行文件 |
| `src-tauri/target/release/bundle/nsis/Mosharp_1.0.0_x64-setup.exe` | NSIS 安装包（推荐，文件关联由它注册） |
| `src-tauri/target/release/bundle/msi/Mosharp_1.0.0_x64_en-US.msi` | MSI 安装包（需联网让 Tauri 下载 WiX） |

只要 NSIS、不想等 MSI：

```bash
npm run tauri build -- --bundles nsis
```

安装包会注册 `.md` / `.markdown` / `.mdown` / `.mkd` 关联。如果之前手动用「打开方式 → 始终使用」指定过别的程序，Windows 的 `UserChoice` 会压过安装器，需要重新选一次 Mosharp。

---

## 快捷键

默认值如下，全部可在「帮助 → 偏好设置 → 快捷键」里改。

| 操作 | 快捷键 |
| :--- | :--- |
| 新建 | `Ctrl+T`（`Ctrl+N` 也可） |
| 打开 / 打开文件夹 | `Ctrl+O` / `Ctrl+Shift+O` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 关闭标签 | `Ctrl+W` |
| 查找 | `Ctrl+F`（面板内可开大小写、全字、正则） |
| 命令面板 | `Ctrl+Shift+P` |
| 偏好设置 | `Ctrl+,` |
| 侧栏 | `Ctrl+\` |
| 源码模式 | `Ctrl+/` |
| 加粗 / 斜体 / 行内代码 | `Ctrl+B` / `Ctrl+I` / `Ctrl+E` |
| 高亮 / 删除线 | `Ctrl+Shift+H` / `Ctrl+Shift+U` |
| 链接 / 勾选任务 | `Ctrl+K` / `Ctrl+Enter` |
| 窗口缩放 / 重置 | `Ctrl+=` `Ctrl+-` / `Ctrl+0` |

文内链接和网址要按住 `Ctrl` 再点才会跳转。行首 `/` 插入标题、列表、表格、代码块。缩放会记在偏好里，下次启动沿用。

## 数据位置

| 内容 | 位置 |
| :--- | :--- |
| 未保存内容的恢复副本 | `%USERPROFILE%\.mosharp\recovered`（帮助 → 打开恢复目录） |
| 未落盘文档的粘贴图片 | `%USERPROFILE%\.mosharp\assets` |
| 偏好、最近打开、会话 | WebView2 的 localStorage |
| 窗口大小与位置 | `tauri-plugin-window-state` 的持久化文件 |

有路径的文档，粘贴图片写到文档同目录的 `assets/`；保存时使用相对路径引用。

## 已知限制

诚实列一下，避免预期落差：

- **光标仍在 Markdown 源码坐标上**。标记被装饰隐藏后，方向键和点击仍会踩进 `# `、`**` 这些字符；中文输入法的候选框按源码坐标定位，偶有偏移。这是与 Typora 的主要差距。
- 表格单元格编辑会在「排版表格」和「管道符文本」之间切换，不是完全原生的单元格光标。
- 导出 HTML 的公式 CSS 链接自 CDN，离线打开时公式排版会退化；Mermaid/Vega 已内联。
- PlantUML 需要联网（走 plantuml.com），离线导出会缺图。
- 侧栏「搜索当前目录」只覆盖已展开的文件夹，不是全目录递归搜索。
- 15 套主题改的是颜色、字号与代码字体，排版骨架（段落间距、缩进）是固定的。
- 长图分页按像素高度切分，不保证避开行中与标题孤行。

## 技术栈

- [Tauri 2](https://tauri.app/) + WebView2（Rust 后端负责文件 IO、编码、监听、PDF 打印、单实例）
- [SolidJS](https://www.solidjs.com/)（界面）
- [CodeMirror 6](https://codemirror.net/)（编辑内核）
- [marked](https://marked.js.org/) + [KaTeX](https://katex.org/) + [Mermaid](https://mermaid.js.org/) + [Vega-Embed](https://vega.github.io/vega-lite/) + [html2canvas](https://html2canvas.hertzen.com/)（渲染与导出）

```
src/
  editor/        编辑内核：createEditor、装饰、实时预览、写作增强
  editor/preview/  视口内的重块与交互（公式、图表、图片、表格、菜单）
  export/        导出管线：article、docx、pages、slides、present、sanitize
  shell/         外壳：菜单、命令面板、设置、会话、偏好、i18n
  themes/        主题目录与 15 套 CSS
  api/           Tauri 调用封装
src-tauri/src/
  document.rs    读写、编码、原子保存、图片
  watch.rs       外部修改监听、恢复副本
  startup.rs     命令行文件（双击打开）
  close_gate.rs  关闭前的未保存握手
  export_pdf.rs  WebView2 打印
  workspace.rs   目录列举、资源管理器定位
```

## 文档

- [功能清单.md](功能清单.md) — 分期的功能与完成状态
- [优化标准.md](优化标准.md) — 与 Typora 的逐项对比和定位
- [themes/README.md](src/themes/README.md) — 主题编写说明

## 许可

MIT
