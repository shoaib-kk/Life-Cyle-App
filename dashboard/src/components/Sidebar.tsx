import {
  Activity,
  BarChart3,
  CalendarRange,
  Crosshair,
  Gauge,
  LayoutDashboard,
  MousePointerClick,
  Target
} from "lucide-react";

export type PageKey =
  | "overview"
  | "trends"
  | "breakdown"
  | "profiles"
  | "focus"
  | "distractions"
  | "goals";

const navItems = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "trends", label: "Trends", icon: CalendarRange },
  { key: "breakdown", label: "Breakdown", icon: BarChart3 },
  { key: "profiles", label: "Profiles", icon: Crosshair },
  { key: "focus", label: "Focus", icon: Gauge },
  { key: "distractions", label: "Distractions", icon: MousePointerClick },
  { key: "goals", label: "Goals", icon: Target }
] satisfies Array<{ key: PageKey; label: string; icon: typeof Activity }>;

type SidebarProps = {
  activePage: PageKey;
  onChange: (page: PageKey) => void;
};

export function Sidebar({ activePage, onChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">LC</div>
        <div>
          <strong>LifeCycle</strong>
          <span>Analytics</span>
        </div>
      </div>

      <nav aria-label="Dashboard navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={activePage === item.key ? "active" : ""}
              type="button"
              onClick={() => onChange(item.key)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
