import { BookOpen, Code2, Home, Play, Settings, Target, TrendingUp } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const mainNav = [
  { to: "/", label: "Today", icon: Home, end: true },
  { to: "/week", label: "My Week", icon: TrendingUp },
  { to: "/goals", label: "Goals", icon: Target }
];

const profiles = [
  { to: "/profiles/coding", label: "Coding", icon: Code2 },
  { to: "/profiles/studying", label: "Studying", icon: BookOpen },
  { to: "/profiles/entertainment", label: "Entertainment", icon: Play }
];

function navClass({ isActive }) {
  return [
    "flex w-full items-center gap-3 px-4 py-2 text-[13px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
    isActive ? "font-medium text-zinc-900 dark:text-zinc-100" : ""
  ].join(" ");
}

export default function Layout() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <aside className="fixed inset-y-0 left-0 flex w-[180px] flex-col border-r border-zinc-200 bg-white px-3 py-5 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="px-4">
          <div className="text-value text-zinc-900 dark:text-zinc-100">LifeCycle</div>
          <div className="mt-1 text-micro text-zinc-400">Your day at a glance</div>
        </div>

        <nav className="mt-8" aria-label="Main navigation">
          {mainNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-8 px-4 text-label uppercase tracking-widest text-zinc-400">
          Profiles
        </div>
        <nav className="mt-2" aria-label="Profile navigation">
          {profiles.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className={navClass}>
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <button
          type="button"
          className="mt-auto flex w-full items-center gap-3 px-4 py-2 text-[13px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <Settings size={16} aria-hidden="true" />
          Settings
        </button>
      </aside>

      <main className="ml-[180px] min-h-screen px-10 py-8">
        <div className="max-w-screen-sm">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
