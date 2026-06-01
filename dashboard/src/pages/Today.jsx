import PropTypes from "prop-types";
import { useState } from "react";
import { Link } from "react-router-dom";
import AnalyticsDrawer from "../components/AnalyticsDrawer.jsx";
import DayArc from "../components/DayArc.jsx";
import IntentionPicker from "../components/IntentionPicker.jsx";
import Nudge from "../components/Nudge.jsx";
import { greetingFor } from "../utils.js";

export default function Today({ data, intention, demoMode, profileName }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!demoMode && data.sites.length === 0) {
    return (
      <p className="text-body text-zinc-500 dark:text-zinc-400">
        No data yet — check back after your first day of browsing.{" "}
        <Link to="/" className="text-link hover:underline">Open Today</Link>
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-page text-zinc-900 dark:text-zinc-100">
          {profileName ? profileName : `Good ${greetingFor()}`}
        </h1>
        <p className="mt-1 text-body text-zinc-400">{data.dateLabel}</p>
        {!profileName ? <IntentionPicker initialIntention={intention} /> : null}
      </section>

      <section>
        <DayArc arc={data.arc} />
      </section>

      {data.currentMode ? (
        <section>
          <p className="flex items-center gap-2 text-body text-zinc-600 dark:text-zinc-300">
            <span className={`h-[7px] w-[7px] rounded-full ${data.currentMode.isOnTrack ? "bg-focus" : "bg-drift"}`} />
            {data.currentMode.label} mode <span className="text-zinc-400">·</span> active since {data.currentMode.activeSince}
          </p>
        </section>
      ) : null}

      <Nudge text={data.nudge} />

      <section>
        <button
          type="button"
          className="text-[13px] text-link hover:underline"
          onClick={() => setDrawerOpen((value) => !value)}
        >
          {drawerOpen ? "hide ↑" : "See what you were doing ↓"}
        </button>
      </section>

      {drawerOpen ? (
        <AnalyticsDrawer sites={data.sites} split={data.split} insight={data.insight} />
      ) : null}
    </div>
  );
}

Today.propTypes = {
  data: PropTypes.shape({
    dateLabel: PropTypes.string.isRequired,
    currentMode: PropTypes.shape({
      label: PropTypes.string.isRequired,
      activeSince: PropTypes.string.isRequired,
      isOnTrack: PropTypes.bool.isRequired
    }),
    arc: DayArc.propTypes.arc,
    nudge: PropTypes.string,
    sites: AnalyticsDrawer.propTypes.sites,
    split: AnalyticsDrawer.propTypes.split,
    insight: PropTypes.string
  }).isRequired,
  intention: PropTypes.string,
  demoMode: PropTypes.bool.isRequired,
  profileName: PropTypes.string
};

Today.defaultProps = {
  intention: null,
  profileName: ""
};
