# Mosharp

面向 10 万行仍可编辑的 Markdown 编辑器。实时预览只装饰当前视口：标记默认隐藏，光标正在输入的那一段符号会露出来，方便确认。整行仍保持排版。表格在单元格里修改，复选框点一下只切换勾选。打开、保存和 10 万行基准走同一条 CodeMirror 缓冲。

## 运行

```bash
cd mosharp
npm install
npm run tauri dev
```

只看界面、不访问本机文件时，可以运行 `npm run dev`，用浏览器打开 Vite 地址。打开和保存需要桌面窗口。

## 快捷键

- `Ctrl+N` 新建
- `Ctrl+O` 打开
- `Ctrl+S` 保存
- `Ctrl+Shift+S` 另存为
- `Ctrl+F` 查找（面板里可开全字匹配）
- `Ctrl+B` / `Ctrl+I` / `Ctrl+E` 加粗、斜体、行内代码
- `Ctrl+K` 链接，`Ctrl+Enter` 勾选任务
- `Ctrl+/` 进入源码模式，再按一次回到预览
- 文内链接和网址要按住 `Ctrl` 再点才会跳转
- 行首 `/` 插入标题、列表、表格、代码块
