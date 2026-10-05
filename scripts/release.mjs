#!/usr/bin/env node
// Ships a new version of the desktop app, end to end:
//   pnpm release 0.2.14 "approvals, push to GitHub" [--notes "- one\n- two"]
// Bumps the version, rebuilds the website demo, builds the Mac .dmg, puts the
// version and headline on the landing page, commits and pushes (which deploys the
// site), publishes the GitHub release, and installs the app in /Applications.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [version, headline, ...rest] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !headline) {
  console.error('Usage: pnpm release <x.y.z> "<short headline>" [--notes "<markdown>"]');
  process.exit(1);
}
const notesAt = rest.indexOf("--notes");
const notes =
  notesAt >= 0 ? rest[notesAt + 1] : `- ${headline[0].toUpperCase()}${headline.slice(1)}.`;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, "utf8")));

// 1. Version.
edit("apps/desktop/package.json", (s) =>
  s.replace(/"version": "[^"]+"/, `"version": "${version}"`),
);

// 2. Landing page badge.
edit("apps/web/public/index.html", (s) =>
  s
    .replace(/<span data-version>[^<]*<\/span>/, `<span data-version>${version}</span>`)
    .replace(/<span data-headline>[^<]*<\/span>/, `<span data-headline>· ${headline}</span>`),
);

// 3. Build: the website's live demo and the Mac app.
run("pnpm", ["--filter", "@helloagents/desktop", "demo"]);
run("pnpm", ["--filter", "@helloagents/desktop", "dist"]);

// 4. Commit and push (the website deploys from main).
run("git", ["add", "-A"]);
run("git", ["commit", "-qm", `Release ${version}: ${headline}`]);
run("git", ["push", "-q"]);

// 5. The GitHub release with the .dmg.
run("gh", [
  "release",
  "create",
  `v${version}`,
  "apps/desktop/dist/helloagents-mac.dmg",
  "--title",
  `helloagents ${version}`,
  "--notes",
  notes,
]);

// 6. Install it on this Mac.
try {
  execFileSync("osascript", ["-e", 'quit app "helloagents"'], { stdio: "ignore" });
} catch {
  // not running
}
const mount = execFileSync("hdiutil", [
  "attach",
  "-nobrowse",
  "apps/desktop/dist/helloagents-mac.dmg",
])
  .toString()
  .trim()
  .split("\n")
  .at(-1)
  .split("\t")
  .at(-1);
run("rm", ["-rf", "/Applications/helloagents.app"]);
run("ditto", [`${mount}/helloagents.app`, "/Applications/helloagents.app"]);
run("hdiutil", ["detach", "-quiet", mount]);
run("open", ["-a", "/Applications/helloagents.app"]);
console.log(`\nReleased ${version}.`);
