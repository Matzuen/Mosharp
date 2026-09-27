export const EDITOR_FONTS = [
  { family: '"Segoe UI", sans-serif', label: "Segoe UI" },
  { family: '"Microsoft YaHei", "Microsoft YaHei UI", sans-serif', label: "微软雅黑" },
  { family: 'SimSun, "Songti SC", serif', label: "宋体" },
  { family: 'KaiTi, "Kaiti SC", serif', label: "楷体" },
  { family: 'SimHei, "Heiti SC", sans-serif', label: "黑体" },
  { family: 'Georgia, "Noto Serif SC", serif', label: "Georgia" },
  { family: 'Consolas, "Cascadia Mono", monospace', label: "Consolas" },
] as const;

export const EDITOR_SIZES = [14, 15, 16, 17, 18, 20, 22] as const;

export type EditorSize = (typeof EDITOR_SIZES)[number];

export function isEditorFont(value: string): boolean {
  return EDITOR_FONTS.some((item) => item.family === value);
}

export function isEditorSize(value: number): value is EditorSize {
  return (EDITOR_SIZES as readonly number[]).includes(value);
}
