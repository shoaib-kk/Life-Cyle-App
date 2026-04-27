function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function render(summary) {
  const domainLabel = summary.domain || "No domain tracked yet";

  setText("domain", domainLabel);
  setText("today", `${summary.todayMinutes} min`);
  setText("average", `${summary.averageMinutes} min`);
  setText("status", summary.status);
  setText("prediction", summary.prediction);
  setText("recommendation", summary.recommendation);
}

chrome.runtime.sendMessage({ type: "GET_USAGE_SUMMARY" }, (summary) => {
  if (chrome.runtime.lastError || !summary) {
    render({
      domain: null,
      todayMinutes: 0,
      averageMinutes: 0,
      status: "No usage yet",
      prediction: "~0 min today",
      recommendation: "No active usage recorded yet today"
    });
    return;
  }

  render(summary);
});
