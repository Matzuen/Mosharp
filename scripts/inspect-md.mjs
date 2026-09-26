import { parser, GFM } from "@lezer/markdown";

const p = parser.configure(GFM);
const samples = [
  "`code`",
  "~~x~~",
  "> q",
  "```js\n1\n```",
  "|a|b|\n|-|-|\n|1|2|",
  "a\nb",
  "a  \nb",
];

function walk(n, i = 0) {
  console.log(" ".repeat(i) + n.name + ` ${n.from}-${n.to}`);
  for (let c = n.firstChild; c; c = c.nextSibling) walk(c, i + 1);
}

for (const s of samples) {
  console.log("---", JSON.stringify(s));
  walk(p.parse(s).topNode);
}
