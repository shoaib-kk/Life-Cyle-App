import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import SiteList from "./SiteList.jsx";

export default function AnalyticsDrawer({ sites, split, insight }) {
  return (
    <div className="rounded-xl bg-zinc-100 px-6 py-5 dark:bg-zinc-800">
      <div>
        <div className="text-label uppercase tracking-widest text-zinc-400">where your time went</div>
        <div className="mt-2.5">
          <SiteList sites={sites} />
        </div>
      </div>

      <div className="mt-6">
        <div className="text-label uppercase tracking-widest text-zinc-400">today&apos;s split</div>
        <div className="mt-2.5 flex h-2 overflow-hidden rounded bg-zinc-300 dark:bg-zinc-700">
          <div className="bg-focus" style={{ width: `${split.focused}%` }} />
          <div className="bg-drift" style={{ width: `${split.distracted}%` }} />
          <div className="bg-idle dark:bg-zinc-500" style={{ width: `${split.idle}%` }} />
        </div>
        <p className="mt-2 text-micro text-zinc-500 dark:text-zinc-400">
          {Math.round(split.focused)}% focused <span className="px-1">·</span>{" "}
          {Math.round(split.distracted)}% distracted <span className="px-1">·</span>{" "}
          {Math.round(split.idle)}% idle
        </p>
      </div>

      {insight ? <p className="mt-6 text-body text-zinc-600 dark:text-zinc-300">{insight}</p> : null}

      <Link to="/week" className="mt-6 inline-block text-[13px] text-link hover:underline">
        See your full week →
      </Link>
    </div>
  );
}

AnalyticsDrawer.propTypes = {
  sites: SiteList.propTypes.sites,
  split: PropTypes.shape({
    focused: PropTypes.number.isRequired,
    distracted: PropTypes.number.isRequired,
    idle: PropTypes.number.isRequired
  }).isRequired,
  insight: PropTypes.string
};

AnalyticsDrawer.defaultProps = {
  insight: ""
};
