import PropTypes from "prop-types";
import { formatMinutes } from "../utils.js";

const dotClass = {
  productive: "bg-focus",
  distracting: "bg-drift",
  neutral: "bg-zinc-400"
};

const tagClass = {
  productive: "bg-green-50 text-green-800 dark:bg-zinc-700 dark:text-green-200",
  distracting: "bg-red-50 text-red-800 dark:bg-zinc-700 dark:text-red-200",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
};

export default function SiteList({ sites }) {
  return (
    <div className="space-y-3">
      {sites.map((site) => (
        <div key={`${site.domain}-${site.tag}`} className="flex items-center gap-2 text-body">
          <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dotClass[site.tag]}`} />
          <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">{site.domain}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${tagClass[site.tag]}`}>{site.tag}</span>
          <span className="w-14 text-right text-zinc-500 dark:text-zinc-400">{formatMinutes(site.minutes)}</span>
        </div>
      ))}
    </div>
  );
}

SiteList.propTypes = {
  sites: PropTypes.arrayOf(
    PropTypes.shape({
      domain: PropTypes.string.isRequired,
      tag: PropTypes.oneOf(["productive", "distracting", "neutral"]).isRequired,
      minutes: PropTypes.number.isRequired
    })
  ).isRequired
};
