# buggy-stats

A tiny library with three bugs and tests that catch them. Use it to try the harness without touching a real project:

```sh
pnpm agent --dir examples/buggy-stats --copy "The tests fail. Fix the bugs in src/stats.js so npm test passes. Don't change the tests."
```
