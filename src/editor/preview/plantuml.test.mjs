import { encodePlantuml, encodePlantumlBytes, plantumlSvgUrl } from "./plantuml.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const encoded = await encodePlantuml("Alice -> Bob: hello");
assert(/^[0-9A-Za-z_-]+$/.test(encoded), "plantuml alphabet");
assert(!encoded.includes("+") && !encoded.includes("/"), "not standard base64");
assert((await encodePlantuml("Alice -> Bob: hello")) === encoded, "stable");
assert(plantumlSvgUrl(encoded) === `https://www.plantuml.com/plantuml/svg/~1${encoded}`, "server url");
assert(encodePlantumlBytes(new Uint8Array([0, 1, 2, 3])) === "00420m00", "three-byte groups");

console.log("plantuml ok");
