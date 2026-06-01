import PropTypes from "prop-types";
import { useState } from "react";
import { formatMinutes } from "../utils.js";

const segmentClass = {
  focus: "bg-focus",
  drift: "bg-drift",
  idle: "bg-idle dark:bg-zinc-500"
};

export default function DayArc({ arc }) {
  const [hovered, setHovered] = useState(null);

  return (
    <div>
      <div className="relative h-7 overflow-hidden rounded-[14px] bg-zinc-200 dark:bg-zinc-700">
        {arc.segments.map((segment) => (
          <div
            key={segment.id}
            className={`absolute inset-y-0 ${segmentClass[segment.kind]}`}
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
            onMouseEnter={() => setHovered(segment)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        {hovered ? (
          <div
            className="absolute -top-7 z-10 whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-micro text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            style={{ left: `${hovered.left}%` }}
          >
            {hovered.domain} · {formatMinutes(hovered.minutes)}
          </div>
        ) : null}
      </div>
      <div className="mt-2.5 text-[13px] text-zinc-500 dark:text-zinc-400">
        {formatMinutes(arc.focusedMinutes)} focused <span className="px-1">·</span>{" "}
        {formatMinutes(arc.distractedMinutes)} distracted
      </div>
    </div>
  );
}

DayArc.propTypes = {
  arc: PropTypes.shape({
    focusedMinutes: PropTypes.number.isRequired,
    distractedMinutes: PropTypes.number.isRequired,
    segments: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
        kind: PropTypes.oneOf(["focus", "drift", "idle"]).isRequired,
        domain: PropTypes.string.isRequired,
        minutes: PropTypes.number.isRequired,
        left: PropTypes.number.isRequired,
        width: PropTypes.number.isRequired
      })
    ).isRequired
  }).isRequired
};
