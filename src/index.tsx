/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { loadPreferences } from "./shell/preferences";
import { applyAppearance } from "./themes/apply";
import "./themes/styles";

applyAppearance(loadPreferences());

render(() => <App />, document.getElementById("root") as HTMLElement);
