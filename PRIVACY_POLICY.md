# LifeCycle Privacy Policy

Last updated: May 22, 2026

LifeCycle tracks active browser tab time so it can show personal usage insights, session baselines, and optional reminders.

## Data We Collect

LifeCycle may collect:

- Website domains you visit, such as `example.com`
- Time spent on each tracked domain
- Session timing metadata used to calculate typical session length
- Account email address if you sign in

LifeCycle does not collect full page URLs, page contents, form inputs, passwords, keystrokes, or browsing activity from excluded domains.

## How Data Is Used

Data is used to:

- Show daily usage summaries in the extension popup
- Compare current usage with your historical baseline
- Sync usage history across your signed-in devices
- Show optional notifications or in-page reminders

## Storage And Sync

When signed out, usage data is stored locally in Chrome extension storage.

When signed in, usage summaries are sent to the LifeCycle backend over HTTPS and associated with your account. The backend stores per-domain daily totals, not full URLs.

## Data Sharing

LifeCycle does not sell browsing data or share it with advertisers. Data is only used to provide the extension's stated functionality.

## Account And Deletion

Users can sign out from the extension popup. A production deployment should provide an account deletion or data deletion contact before publication.

## Security

Authentication tokens are stored in Chrome extension local storage. Production deployments must set a unique server-side `LIFECYCLE_AUTH_SECRET` and serve the backend only over HTTPS.

## Contact

For privacy requests, publish a contact email or support URL here before submitting to the Chrome Web Store.
