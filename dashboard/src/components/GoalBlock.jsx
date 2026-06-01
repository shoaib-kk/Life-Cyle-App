import PropTypes from "prop-types";
import { formatGoalAmount } from "../utils.js";

export default function GoalBlock({ goal }) {
  const progress = Math.min(100, Math.round((goal.current / Math.max(goal.target, 1)) * 100));
  const isOnTrack = goal.status === "On track";
  const fillClass = isOnTrack ? "bg-focus" : "bg-drift";
  const textClass = isOnTrack ? "text-focus" : "text-drift";

  return (
    <div>
      <div className="text-[15px] font-medium text-zinc-900 dark:text-zinc-100">{goal.name}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded ${fillClass}`} style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-body text-zinc-500 dark:text-zinc-400">
        {formatGoalAmount(goal.current, goal.unit)} of {formatGoalAmount(goal.target, goal.unit)} today{" "}
        <span className="px-1">·</span> <span className={textClass}>{goal.status}</span>
      </p>
    </div>
  );
}

GoalBlock.propTypes = {
  goal: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    current: PropTypes.number.isRequired,
    target: PropTypes.number.isRequired,
    status: PropTypes.oneOf(["On track", "At risk", "Missed"]).isRequired,
    unit: PropTypes.string
  }).isRequired
};
