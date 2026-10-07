import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

/**
 * What an agent can ask helloagents to do from its shell, with the `helloagents`
 * command: start new runs, and ship its own work (push, open a PR, merge).
 */
export type AgentAction = "new" | "commit" | "push" | "pr" | "merge";

export const AGENT_ACTIONS: readonly AgentAction[] = ["new", "commit", "push", "pr", "merge"];

export interface AgentRequest {
  action: AgentAction;
  /** For "new": the task. */
  text: string;
  /** For "new": another project, by name. */
  project?: string;
}

/** Answers a run's request with what to tell the agent; throws to report a failure. */
export type AgentHandler = (runId: string, request: AgentRequest) => Promise<string>;

export interface AgentApi {
  url: string;
  /** A secret for one run; the agent's requests carry it so helloagents knows which run asks. */
  tokenFor: (runId: string) => string;
  close: () => Promise<void>;
}

/** A small HTTP endpoint on 127.0.0.1 that the `helloagents` command talks to. */
export async function startAgentApi(handle: AgentHandler): Promise<AgentApi> {
  const runs = new Map<string, string>();
  const tokens = new Map<string, string>();
  const server = http.createServer((req, res) => {
    const reply = (status: number, text: string) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      res.end(text.endsWith("\n") ? text : `${text}\n`);
    };
    const runId = runs.get(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
    const action = (req.url ?? "").replace(/^\//, "").split("?")[0] as AgentAction;
    if (req.method !== "POST" || !runId) return reply(403, "Not allowed.");
    if (!AGENT_ACTIONS.includes(action)) return reply(404, `Unknown command "${action}".`);
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const project = req.headers["x-helloagents-project"];
      handle(runId, {
        action,
        text: body.trim(),
        ...(typeof project === "string" && project && { project }),
      }).then(
        (text) => reply(200, text),
        (e: unknown) => reply(400, e instanceof Error ? e.message : String(e)),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    tokenFor: (runId) => {
      let token = tokens.get(runId);
      if (!token) {
        token = randomUUID();
        tokens.set(runId, token);
        runs.set(token, runId);
      }
      return token;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** The `helloagents` command agents run. Plain sh and curl, both on every Mac. */
const HELPER = `#!/bin/sh
# Lets a coding agent ask helloagents (the app running it) to do things.
usage() {
  cat <<'EOF'
helloagents new [--project NAME] "<task>"   start a new run (its own branch and session)
helloagents commit                          commit everything on this run's branch
helloagents push                            commit and push this run's branch
helloagents pr                              commit, push and open a pull request
helloagents merge                           commit, merge into the base branch, push it
EOF
}
if [ -z "$HELLOAGENTS_API" ] || [ -z "$HELLOAGENTS_TOKEN" ]; then
  echo "helloagents: only works inside a helloagents run." >&2
  exit 1
fi
cmd="$1"
[ $# -gt 0 ] && shift
project=""
if [ "$cmd" = "new" ] && [ "$1" = "--project" ]; then
  project="$2"
  shift 2
fi
case "$cmd" in
  new|commit|push|pr|merge) ;;
  *) usage; exit 2 ;;
esac
if [ "$cmd" = "new" ] && [ $# -eq 0 ] && [ ! -t 0 ]; then
  body=$(cat)
else
  body="$*"
fi
out=$(printf '%s' "$body" | curl -sS -X POST \\
  -H "Authorization: Bearer $HELLOAGENTS_TOKEN" \\
  -H "X-Helloagents-Project: $project" \\
  -w '\\n%{http_code}' --data-binary @- "$HELLOAGENTS_API/$cmd") || exit 1
code=$(printf '%s' "$out" | tail -n 1)
printf '%s\\n' "$out" | sed '$d'
[ "$code" = "200" ]
`;

/** Writes the `helloagents` command into `binDir` and returns its folder. */
export async function writeAgentHelper(binDir: string): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const file = path.join(binDir, "helloagents");
  await writeFile(file, HELPER);
  await chmod(file, 0o755);
  return binDir;
}
