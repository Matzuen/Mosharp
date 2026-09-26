# Mosharp

面向 10 万行仍可编辑的 Markdown 编辑器。当前是第 1 期内核：CodeMirror 6 虚拟化缓冲、Markdown 高亮、打开 / 保存，以及 10 万行基准。

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
- `Ctrl+F` 查找
