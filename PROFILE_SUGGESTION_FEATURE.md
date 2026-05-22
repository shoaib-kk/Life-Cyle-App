# LifeCycle Profile Suggestion Feature

## Overview

The extension is now **proactive** and suggests task profiles based on detected user activity. Instead of manually selecting profiles, users see suggestions like:

> "Looks like you're coding. Start Coding profile?"

## How It Works

### Phase 1: Domain Heuristics (Current Implementation)

The system analyzes open browser tabs to detect what activity the user is engaged in:

1. **Activity Detection**
   - Scans all open tabs in the focused browser window
   - Extracts domain names and tab titles
   - Matches against predefined domain rules

2. **Profile Scoring**
   - Each profile is scored based on how well it matches detected activity:
     - **+10 points** for each allowed domain found in open tabs
     - **+5 points** for tab title pattern matches
     - **+5 points** for domain pattern matches
   - Threshold: Only suggests if confidence ≥ 50%

3. **Smart Notifications**
   - Shows browser notification with personalized message
   - "Start" button to activate the profile immediately
   - "Dismiss" button to skip the suggestion
   - 1-hour cooldown per profile (no spam)

### When Suggestions Trigger

1. **On Tab Activation**: When user switches to a tab
2. **Periodic Check**: Every 5 minutes (background check)
3. **Not During Active Task**: Won't suggest if already tracking a profile

## Example Scenarios

### Scenario 1: User opens GitHub
```
Open Tab: github.com
Detected: "Coding" profile matches
Message: "Looks like you're coding. Start Coding profile?"
```

### Scenario 2: Multiple Development Tabs
```
Open Tabs: 
  - github.com
  - stackoverflow.com
  - developer.mozilla.org
  
Detected: "Coding" profile with high confidence
Message: "Looks like you're coding. Start Coding profile?"
```

### Scenario 3: Study Session Tabs
```
Open Tabs:
  - lms.unimelb.edu.au
  - overleaf.com
  - chatgpt.com

Detected: "Study" profile
Message: "Looks like you're studying. Start Study profile?"
```

## Predefined Profile Groups

The system recognizes these predefined profile groups:

| Profile | Domains | Patterns |
|---------|---------|----------|
| **Coding** | github.com, stackoverflow.com, developer.mozilla.org, docs.python.org | code, coding, github, program, debug |
| **Study** | lms.unimelb.edu.au, canvas.lms.unimelb.edu.au, edstem.org, overleaf.com, docs.google.com | study, assignment, mast\d+, unimelb, lecture, exam |
| **Job Search** | linkedin.com, seek.com.au, indeed.com, docs.google.com | job, career, resume, linkedin, interview |

## Code Implementation

### Location: `extension/background.js`

#### Key Functions

**1. `detectActivityFromTabs()` (Lines ~2055-2130)**
```javascript
async function detectActivityFromTabs()
// Returns: { detectedGroup, matchingProfile, confidence, matchedDomains }
// - Analyzes open tabs
// - Returns best matching profile with confidence score
```

**2. `maybeSuggestProfile()` (Lines ~2135-2210)**
```javascript
async function maybeSuggestProfile()
// - Detects activity and creates suggestion notification
// - Enforces cooldowns to prevent spam
// - Only suggests if confidence threshold is met
```

#### Event Integration

**Tab Activation** (Line ~2963):
```javascript
chrome.tabs.onActivated.addListener(({ tabId }) => {
  // ... existing code ...
  enqueue(async () => {
    await refreshActiveContext();
    await maybeSuggestProfile();  // NEW: Suggest profile
  });
});
```

**Periodic Check** (Lines ~2935, 2946):
```javascript
// Every 5 minutes via alarm
chrome.alarms.create("lifecycle-suggest-profile", { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "lifecycle-suggest-profile") {
    enqueue(maybeSuggestProfile);
  }
});
```

**Notification Handlers** (Lines ~3003-3050):
```javascript
chrome.notifications.onClicked.addListener(...)
chrome.notifications.onButtonClicked.addListener(...)
```

### Storage

**In-Memory Tracking:**
```javascript
const profileSuggestionCooldowns = {};  // Line ~2046
// Tracks: { profileId: timestamp }
// Prevents same profile suggestion within 1 hour
```

**Chrome Storage:**
```javascript
await chrome.storage.local.set({ 
  pendingProfileSuggestions: {
    "lifecycle-profile-suggest-coding": {
      profileId: "coding",
      createdAt: timestamp
    }
  }
});
```

## User Interaction Flow

```
1. User opens browser tabs (e.g., GitHub, Stack Overflow)
           ↓
2. Extension detects activity on tab change OR periodic timer
           ↓
3. System analyzes open tabs and scores profiles
           ↓
4. If score ≥ 50% confidence:
           ↓
5. Browser notification appears with suggestion
           ↓
6. User clicks "Start" or "Dismiss"
           ├─ Start: Profile activates immediately
           └─ Dismiss: Notification dismissed, cooldown applied
```

## Customization

### Adding New Profile Groups

Edit `TASK_GROUP_RULES` in [background.js](extension/background.js):
```javascript
const TASK_GROUP_RULES = [
  {
    group: "your-activity",
    patterns: [/your-pattern/i, /another-pattern/i],
    domains: ["domain1.com", "domain2.com"]
  }
];
```

### Adjusting Thresholds

Modify these constants in `maybeSuggestProfile()`:
```javascript
// Confidence threshold (0-1)
if (confidence < 0.5) return;  // Change 0.5 to adjust sensitivity

// Cooldown between suggestions (milliseconds)
const COOLDOWN_MS = 60 * 60 * 1000;  // 1 hour
```

## Next Phase: Advanced Suggestions

Future enhancements planned:

1. **Sequence Modeling**
   - Learn which profiles are used at specific times
   - "Usually coding after 9 AM" → earlier suggestions

2. **Time-Based Patterns**
   - Track historical usage patterns
   - Suggest based on day/time (e.g., "Study on weekends")

3. **ML-Based Predictions**
   - Deep learning on user behavior
   - Context-aware suggestions beyond domain matching

## Testing

### Test Case 1: Basic Domain Detection
1. Open GitHub, Stack Overflow
2. Check browser notification appears
3. Verify "Coding" profile is suggested

### Test Case 2: Cooldown Prevention
1. Accept a suggestion (start profile)
2. Close profile after 30 seconds
3. Wait and re-open same tabs
4. Verify no duplicate suggestion within 1 hour

### Test Case 3: Confidence Threshold
1. Open random tabs not matching any profile
2. Verify no notification appears

### Test Case 4: Active Task Prevention
1. Start a profile manually
2. Open matching tabs
3. Verify no competing suggestion appears

## Troubleshooting

### Suggestions not appearing?
1. Check console for errors: Right-click popup → Inspect → Console
2. Verify "notifications" permission in manifest.json
3. Check browser notification settings (system → Chrome notifications)

### Wrong profile being suggested?
1. Check tab domains against TASK_GROUP_RULES
2. Verify domain is in correct profile's `allowedDomains`
3. Add patterns to TASK_GROUP_RULES if needed

### Too many/too few suggestions?
1. Adjust confidence threshold (lower = more suggestions)
2. Modify COOLDOWN_MS for different time between suggestions
3. Edit scoring multipliers (+10, +5 points) for sensitivity

## Files Modified

- [extension/background.js](extension/background.js): Core implementation
- [extension/manifest.json](extension/manifest.json): Already has "notifications" permission

## Related Code

- [TASK_GROUP_RULES](extension/background.js#L31): Domain classification patterns
- [DEFAULT_TASK_PROFILES](extension/background.js#L54): Default profile definitions
- [getTaskProfiles()](extension/background.js#L271): Profile management
