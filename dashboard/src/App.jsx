import PropTypes from "prop-types";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./Layout.jsx";
import { demoData } from "./demoData.js";
import Goals from "./pages/Goals.jsx";
import Today from "./pages/Today.jsx";
import Week from "./pages/Week.jsx";
import { emptyDashboardData } from "./utils.js";

const profileLabels = {
  coding: "Coding",
  studying: "Studying",
  entertainment: "Entertainment"
};

function scopedToday(data, slug) {
  if (!slug) {
    return data.today;
  }

  const profile = data.profiles[slug];
  if (!profile) {
    return data.today;
  }

  return {
    ...profile,
    dateLabel: data.today.dateLabel
  };
}

export default function App({ demoMode, dashboardData }) {
  const data = demoMode ? demoData : dashboardData || emptyDashboardData();

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route
            index
            element={<Today data={data.today} intention={data.intention} demoMode={demoMode} />}
          />
          <Route path="week" element={<Week week={data.week} demoMode={demoMode} />} />
          <Route path="goals" element={<Goals goals={data.goals} demoMode={demoMode} />} />
          {Object.entries(profileLabels).map(([slug, label]) => (
            <Route
              key={slug}
              path={`profiles/${slug}`}
              element={
                <Today
                  data={scopedToday(data, slug)}
                  intention={label}
                  demoMode={demoMode}
                  profileName={label}
                />
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

App.propTypes = {
  demoMode: PropTypes.bool,
  dashboardData: PropTypes.object
};

App.defaultProps = {
  demoMode: true,
  dashboardData: null
};
