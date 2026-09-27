import { processIo } from "./io.js";
import { run } from "./run.js";

run(process.argv.slice(2), processIo()).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
