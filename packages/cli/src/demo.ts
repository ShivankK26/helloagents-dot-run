import { reply, ScriptedModel } from "@helloagents/engine";

// What a model might plausibly do to fix examples/buggy-stats, replayed
// without calling any API. The tools run for real: the files really change
// and `npm test` really runs. The usage numbers are made up; the model name
// isn't a real one, so cost comes out as $0.
const MODEL = "scripted-demo";
const r = (opts: Parameters<typeof reply>[0]) => reply({ model: MODEL, ...opts });

export const DEMO_TASK =
  "The tests fail. Fix the bugs in src/stats.js so npm test passes. Don't change the tests.";

export function demoModel(): ScriptedModel {
  return new ScriptedModel(
    [
      r({
        text: "I'll look at the project and run the tests to see what's failing.",
        tools: [{ name: "list_files", input: {} }],
      }),
      r({ tools: [{ name: "run_command", input: { command: "npm", args: ["test"] } }] }),
      r({
        tools: [
          { name: "read_file", input: { path: "src/stats.js" } },
          { name: "read_file", input: { path: "test/stats.test.js" } },
        ],
      }),
      r({
        text: "There are three bugs: mean subtracts 1, median never sorts its input, and range passes the array itself to Math.min. Fixing each one.",
        tools: [
          {
            name: "edit_file",
            input: {
              path: "src/stats.js",
              old_text: "/ values.length - 1;",
              new_text: "/ values.length;",
            },
          },
        ],
      }),
      r({
        tools: [
          {
            name: "edit_file",
            input: {
              path: "src/stats.js",
              old_text:
                "  const mid = Math.floor(values.length / 2);\n  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;",
              new_text:
                "  const sorted = [...values].sort((a, b) => a - b);\n  const mid = Math.floor(sorted.length / 2);\n  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;",
            },
          },
        ],
      }),
      r({
        tools: [
          {
            name: "edit_file",
            input: {
              path: "src/stats.js",
              old_text: "Math.min(values)",
              new_text: "Math.min(...values)",
            },
          },
        ],
      }),
      r({ tools: [{ name: "run_command", input: { command: "npm", args: ["test"] } }] }),
      r({
        tools: [
          {
            name: "finish",
            input: {
              summary:
                "Fixed three bugs in src/stats.js: mean no longer subtracts 1, median sorts a copy of the input before picking the middle, and range spreads the array into Math.min. npm test now passes (3 of 3).",
            },
          },
        ],
      }),
    ],
    MODEL,
  );
}
