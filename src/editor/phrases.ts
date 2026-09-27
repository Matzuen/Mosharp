export type EditorLocale = "zh-CN" | "en";

/** CodeMirror search panel labels. Chinese UI names the whole-word toggle explicitly. */
export function searchPhrases(locale: EditorLocale): Record<string, string> {
  if (locale === "en") return {};
  return {
    Find: "查找",
    Replace: "替换",
    next: "下一个",
    previous: "上一个",
    all: "全部",
    "match case": "区分大小写",
    regexp: "正则",
    "by word": "全字匹配",
    replace: "替换",
    "replace all": "全部替换",
    close: "关闭",
    "Go to line": "跳到行",
    go: "跳转",
  };
}
