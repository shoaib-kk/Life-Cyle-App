import PropTypes from "prop-types";
import { useState } from "react";

export default function Nudge({ text }) {
  const [dismissed, setDismissed] = useState(false);

  if (!text || dismissed) {
    return null;
  }

  return (
    <p className="border-l-2 border-nudge pl-3 text-body text-zinc-700 dark:text-zinc-200">
      {text}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-2 cursor-pointer text-body text-zinc-400"
        aria-label="Dismiss nudge"
      >
        ×
      </button>
    </p>
  );
}

Nudge.propTypes = {
  text: PropTypes.string
};

Nudge.defaultProps = {
  text: ""
};
