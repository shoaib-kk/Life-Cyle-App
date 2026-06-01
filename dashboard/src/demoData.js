export const demoData = {
  intention: null,
  today: {
    dateLabel: "Tuesday, 26 May",
    currentMode: {
      label: "Focused work",
      activeSince: "9:04am",
      isOnTrack: true
    },
    arc: {
      focusedMinutes: 270,
      distractedMinutes: 45,
      segments: [
        { id: "github-morning", kind: "focus", domain: "github.com", minutes: 120, left: 0, width: 25 },
        { id: "idle-morning", kind: "idle", domain: "away", minutes: 20, left: 25, width: 4.2 },
        { id: "docs-midday", kind: "focus", domain: "docs.google.com", minutes: 100, left: 29.2, width: 20.8 },
        { id: "youtube-lunch", kind: "drift", domain: "youtube.com", minutes: 45, left: 50, width: 9.4 },
        { id: "github-afternoon", kind: "focus", domain: "github.com", minutes: 90, left: 62.5, width: 18.8 }
      ]
    },
    nudge: "You did your cleanest work before lunch — protect that first block tomorrow.",
    sites: [
      { domain: "github.com", tag: "productive", minutes: 162 },
      { domain: "docs.google.com", tag: "productive", minutes: 72 },
      { domain: "chatgpt.com", tag: "productive", minutes: 36 },
      { domain: "youtube.com", tag: "distracting", minutes: 45 },
      { domain: "gmail.com", tag: "neutral", minutes: 18 }
    ],
    split: { focused: 75, distracted: 13, idle: 12 },
    insight: "Your longest blocks both started before 10am — tomorrow, lead with the hard stuff."
  },
  profiles: {
    coding: {
      currentMode: {
        label: "Coding",
        activeSince: "9:04am",
        isOnTrack: true
      },
      arc: {
        focusedMinutes: 202,
        distractedMinutes: 16,
        segments: [
          { id: "coding-github", kind: "focus", domain: "github.com", minutes: 118, left: 0, width: 42 },
          { id: "coding-docs", kind: "focus", domain: "developer.mozilla.org", minutes: 54, left: 44, width: 19 },
          { id: "coding-drift", kind: "drift", domain: "youtube.com", minutes: 16, left: 65, width: 6 },
          { id: "coding-more", kind: "focus", domain: "stackoverflow.com", minutes: 30, left: 73, width: 11 }
        ]
      },
      nudge: "Coding stayed mostly on-task today — the short drift happened right after lunch.",
      sites: [
        { domain: "github.com", tag: "productive", minutes: 118 },
        { domain: "developer.mozilla.org", tag: "productive", minutes: 54 },
        { domain: "stackoverflow.com", tag: "productive", minutes: 30 },
        { domain: "youtube.com", tag: "distracting", minutes: 16 }
      ],
      split: { focused: 84, distracted: 7, idle: 9 },
      insight: "Your coding blocks were strongest when GitHub and docs were the only tabs open."
    },
    studying: {
      currentMode: {
        label: "Learning",
        activeSince: "11:20am",
        isOnTrack: false
      },
      arc: {
        focusedMinutes: 146,
        distractedMinutes: 38,
        segments: [
          { id: "study-canvas", kind: "focus", domain: "canvas.lms.unimelb.edu.au", minutes: 66, left: 0, width: 26 },
          { id: "study-idle", kind: "idle", domain: "away", minutes: 16, left: 28, width: 6 },
          { id: "study-docs", kind: "focus", domain: "docs.google.com", minutes: 80, left: 35, width: 31 },
          { id: "study-drift", kind: "drift", domain: "youtube.com", minutes: 38, left: 68, width: 15 }
        ]
      },
      nudge: "Study drifted when video tabs opened — keep the reading list tighter next time.",
      sites: [
        { domain: "canvas.lms.unimelb.edu.au", tag: "productive", minutes: 66 },
        { domain: "docs.google.com", tag: "productive", minutes: 80 },
        { domain: "youtube.com", tag: "distracting", minutes: 38 },
        { domain: "gmail.com", tag: "neutral", minutes: 12 }
      ],
      split: { focused: 66, distracted: 17, idle: 17 },
      insight: "Learning went best before the video tab appeared — start with readings first."
    },
    entertainment: {
      currentMode: {
        label: "Just browsing",
        activeSince: "1:00pm",
        isOnTrack: true
      },
      arc: {
        focusedMinutes: 38,
        distractedMinutes: 96,
        segments: [
          { id: "entertainment-video", kind: "drift", domain: "youtube.com", minutes: 54, left: 0, width: 33 },
          { id: "entertainment-idle", kind: "idle", domain: "away", minutes: 14, left: 36, width: 8 },
          { id: "entertainment-reddit", kind: "drift", domain: "reddit.com", minutes: 42, left: 46, width: 26 },
          { id: "entertainment-docs", kind: "focus", domain: "docs.google.com", minutes: 38, left: 76, width: 23 }
        ]
      },
      nudge: "Browsing stayed contained today — it did not crowd out your morning focus.",
      sites: [
        { domain: "youtube.com", tag: "distracting", minutes: 54 },
        { domain: "reddit.com", tag: "distracting", minutes: 42 },
        { domain: "docs.google.com", tag: "productive", minutes: 38 }
      ],
      split: { focused: 25, distracted: 63, idle: 12 },
      insight: "Entertainment was mostly separate from your focused blocks, which kept the day balanced."
    }
  },
  week: {
    range: "20–26 May",
    averageMinutes: 150,
    days: [
      { day: "M", label: "Monday", focus: 132, isToday: false },
      { day: "T", label: "Tuesday", focus: 270, isToday: true },
      { day: "W", label: "Wednesday", focus: 118, isToday: false },
      { day: "T", label: "Thursday", focus: 162, isToday: false },
      { day: "F", label: "Friday", focus: 196, isToday: false },
      { day: "S", label: "Saturday", focus: 72, isToday: false },
      { day: "S", label: "Sunday", focus: 84, isToday: false }
    ],
    stats: {
      total: "11h 4m",
      bestDay: "Friday",
      goalsHit: "2 of 3"
    },
    sites: [
      { domain: "github.com", tag: "productive", minutes: 312 },
      { domain: "docs.google.com", tag: "productive", minutes: 220 },
      { domain: "linkedin.com", tag: "productive", minutes: 96 },
      { domain: "youtube.com", tag: "distracting", minutes: 118 },
      { domain: "reddit.com", tag: "distracting", minutes: 62 }
    ]
  },
  goals: [
    { id: "focus-week", name: "Ten focused hours this week", current: 664, target: 600, status: "On track" },
    { id: "drift-cap", name: "Keep distracting time under four hours", current: 190, target: 240, status: "On track" },
    { id: "study-blocks", name: "Three study blocks", current: 1, target: 3, status: "At risk", unit: "blocks" }
  ]
};
