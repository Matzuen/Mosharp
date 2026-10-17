# 编写主题
一套主题一个 CSS 文件。文件名就是主题 id，例如 `elegant.css`。选择器必须是 `html[data-theme="主题 id"]`，只改这一组变量，不要写组件选择器。

新增一套时做三件事：
1. 复制一份现有 CSS，改 id 和颜色。
2. 在 `catalog.ts` 的 `THEMES` 里登记 id、浅色或深色、中文名、英文名和色块（色块等于 `--paper`）。
3. 在 `styles.ts` 里加上这行 CSS 的 import。

## 变量

| 变量 | 作用 |
| --- | --- |
| `color-scheme` | `light` 或 `dark`，表单和系统控件跟着走 |
| `--paper` | 编辑区和窗口底色 |
| `--ink` | 正文和按钮图标，含最小化、最大化、关闭 |
| `--muted` | 次要文字 |
| `--faint` | 更弱的文字、行号 |
| `--line` | 边框和分隔线 |
| `--bar` | 菜单行、状态栏 |
| `--chrome` | 标题栏 |
| `--side` | 侧栏 |
| `--menu` | 菜单、对话框、浮层 |
| `--hover` | 悬停底色 |
| `--accent` | 强调色。焦点框用它，不用系统强调色 |
| `--link` | 链接 |
| `--code-bg` / `--code-ink` | 行内代码 |
| `--code-block` / `--code-block-ink` | 代码块 |
| `--quote` / `--quote-border` | 引用 |
| `--highlight` | `==高亮==` |
| `--selection` | 选区 |
| `--danger` / `--on-danger` | 关闭按钮悬停 |
| `--h1` … `--h4` | 一到六级标题颜色。四级及以下共用 `--h4` |
| `--h1-size` … `--h4-size` | 标题字号，相对正文字号 |
| `--table-border` | 表格线 |
| `--table-head` / `--table-head-ink` | 表头底色和文字 |
| `--table-stripe` | 表格隔行底色 |
| `--math` / `--math-bg` | 公式文字，以及公式块底色 |
| `--rule` | 分隔线 |
| `--marker` | 列表标记 |
| `--strong` / `--em` | 加粗和斜体 |
| `--syn-keyword` / `--syn-string` / `--syn-number` / `--syn-comment` | 代码里的关键字、字符串、数字、注释 |

`--editor-font` 和 `--editor-size` 是这套主题的默认字体和字号。用户在偏好里另选系统字体或字号时，会写入 `--user-font` 和 `--user-size`。编辑器实际使用 `--active-font` 和 `--active-size`，它们先取用户的值，没有再回落到主题默认。

界面颜色都读这些变量，包括 Windows 窗口按钮。焦点框是 `2px solid var(--accent)`。
