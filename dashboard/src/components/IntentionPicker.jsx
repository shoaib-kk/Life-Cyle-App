import PropTypes from "prop-types";
import { useState } from "react";

const choices = ["Focused work", "Learning", "Just browsing"];

export default function IntentionPicker({ initialIntention }) {
  const [intention, setIntention] = useState(initialIntention);
  const [skipped, setSkipped] = useState(false);

  if (skipped) {
    return null;
  }

  if (intention) {
    return <p className="mt-2 text-body text-zinc-500 dark:text-zinc-400">{intention} today.</p>;
  }

  return (
    <div className="mt-2 text-body text-zinc-500 dark:text-zinc-400">
      <span>What&apos;s the plan?</span>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => setIntention(choice)}
            className="rounded-full border border-zinc-300 bg-transparent px-3 py-1 text-micro text-zinc-500 hover:border-zinc-900 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
          >
            {choice}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSkipped(true)}
          className="text-micro text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          skip
        </button>
      </div>
    </div>
  );
}

IntentionPicker.propTypes = {
  initialIntention: PropTypes.string
};

IntentionPicker.defaultProps = {
  initialIntention: null
};
