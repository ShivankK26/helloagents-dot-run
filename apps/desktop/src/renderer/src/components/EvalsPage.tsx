import { Icon } from "./Icons";

/** Not built yet: says plainly what evals will do, so the section isn't a dead end. */
export function EvalsPage() {
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title-row">
          <h1>Evals</h1>
          <span className="pill live">coming next</span>
        </div>
        <p className="muted">
          Find out whether a change actually makes your agents better, with numbers instead of a
          hunch.
        </p>
      </header>
      <ol className="eval-steps">
        <li>
          <span className="eval-num">1</span>
          <div>
            <b>Pick a set of tasks</b>
            <p className="muted">Real bugs and features with hidden tests the agent never sees.</p>
          </div>
        </li>
        <li>
          <span className="eval-num">2</span>
          <div>
            <b>Run each setup a few times</b>
            <p className="muted">
              For example Claude Code lean vs. full, or one agent vs. several. Agents vary run to
              run, so each task runs more than once.
            </p>
          </div>
        </li>
        <li>
          <span className="eval-num">3</span>
          <div>
            <b>Compare the results</b>
            <p className="muted">
              Pass rate, how often every attempt passes, time, tokens and cost, side by side. Each
              attempt links to its trace.
            </p>
          </div>
        </li>
      </ol>
      <div className="page-empty">
        <Icon name="gauge" size={22} />
        <p>
          Evals are the next thing being built. Runs and traces you make now are already recorded in
          the same format.
        </p>
      </div>
    </div>
  );
}
