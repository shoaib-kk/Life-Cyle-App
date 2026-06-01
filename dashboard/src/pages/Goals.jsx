import PropTypes from "prop-types";
import { useState } from "react";
import GoalBlock from "../components/GoalBlock.jsx";

export default function Goals({ goals: initialGoals, demoMode }) {
  const [goals, setGoals] = useState(initialGoals);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", target: "" });

  function addGoal(event) {
    event.preventDefault();
    const target = Number(draft.target || 0);

    if (!draft.name.trim() || target <= 0) {
      return;
    }

    setGoals([
      ...goals,
      {
        id: `goal-${Date.now()}`,
        name: draft.name.trim(),
        current: 0,
        target,
        status: "At risk"
      }
    ]);
    setDraft({ name: "", target: "" });
    setFormOpen(false);
  }

  if (!demoMode && goals.length === 0) {
    return (
      <div className="space-y-10">
        <p className="text-body text-zinc-500 dark:text-zinc-400">
          No goals yet — add one small thing to aim for.{" "}
          <button type="button" onClick={() => setFormOpen(true)} className="text-link hover:underline">
            + add a goal
          </button>
        </p>
        {formOpen ? (
          <form onSubmit={addGoal} className="flex flex-wrap items-end gap-4">
            <label className="flex-1 text-label uppercase tracking-widest text-zinc-400">
              goal
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Read before YouTube"
                className="mt-1 w-full bg-transparent text-body normal-case tracking-normal text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
            </label>
            <label className="w-32 text-label uppercase tracking-widest text-zinc-400">
              minutes
              <input
                value={draft.target}
                onChange={(event) => setDraft({ ...draft, target: event.target.value })}
                type="number"
                min="1"
                placeholder="120"
                className="mt-1 w-full bg-transparent text-body normal-case tracking-normal text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
            </label>
            <button type="submit" className="text-[13px] text-link hover:underline">
              save
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-page text-zinc-900 dark:text-zinc-100">Goals</h1>
        <p className="mt-1 text-body text-zinc-400">{goals.length} active</p>
      </section>

      <section className="space-y-10">
        {goals.map((goal) => (
          <GoalBlock key={goal.id} goal={goal} />
        ))}
      </section>

      <section>
        <button
          type="button"
          onClick={() => setFormOpen((value) => !value)}
          className="text-[13px] text-link hover:underline"
        >
          + add a goal
        </button>

        {formOpen ? (
          <form onSubmit={addGoal} className="mt-4 flex flex-wrap items-end gap-4">
            <label className="flex-1 text-label uppercase tracking-widest text-zinc-400">
              goal
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Read before YouTube"
                className="mt-1 w-full bg-transparent text-body normal-case tracking-normal text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
            </label>
            <label className="w-32 text-label uppercase tracking-widest text-zinc-400">
              minutes
              <input
                value={draft.target}
                onChange={(event) => setDraft({ ...draft, target: event.target.value })}
                type="number"
                min="1"
                placeholder="120"
                className="mt-1 w-full bg-transparent text-body normal-case tracking-normal text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
            </label>
            <button type="submit" className="text-[13px] text-link hover:underline">
              save
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

Goals.propTypes = {
  goals: PropTypes.arrayOf(GoalBlock.propTypes.goal).isRequired,
  demoMode: PropTypes.bool.isRequired
};
