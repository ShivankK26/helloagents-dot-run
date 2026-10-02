import { execFile } from "node:child_process";

/**
 * Apps launched from Finder or the Dock get a minimal PATH (/usr/bin:/bin…),
 * so tools installed by the user, like `claude` in ~/.local/bin, look missing.
 * Ask the user's login shell for its PATH once and use that instead.
 */
export async function loadShellPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (platform === "win32") return undefined;
  const shell = env.SHELL || "/bin/zsh";
  const marker = "__HELLOAGENTS_PATH__";
  const stdout = await new Promise<string>((resolve) => {
    // -i -l: interactive login shell, so .zshrc/.bash_profile PATH edits apply.
    execFile(shell, ["-ilc", `echo ${marker}"$PATH"${marker}`], { timeout: 5000 }, (error, out) =>
      resolve(error ? "" : out),
    );
  });
  return parseShellPath(stdout, marker);
}

/** Pulls the PATH out from between markers, ignoring anything a shell rc file prints. */
export function parseShellPath(
  stdout: string,
  marker = "__HELLOAGENTS_PATH__",
): string | undefined {
  const match = new RegExp(`${marker}(.*?)${marker}`).exec(stdout);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}
