// Runs before the app: gives the window a pretend backend instead of Electron's.
import { demoApi, startDemo } from "./mockApi";
import "./demo.css";

try {
  // The demo opens in dark unless the visitor picked a theme before.
  if (!localStorage.getItem("helloagents.theme")) localStorage.setItem("helloagents.theme", "dark");
} catch {
  // storage blocked: the app falls back to the system theme
}
// Embedded on the website, the demo shows just the app, like the screenshot it replaces.
if (new URLSearchParams(location.search).has("embed"))
  document.documentElement.classList.add("embed");
window.helloagents = demoApi;
startDemo();
