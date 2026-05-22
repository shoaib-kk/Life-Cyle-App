# LifeCycle Deployment Checklist

Before submitting to the Chrome Web Store:

- Deploy `backend.main:app` to a real HTTPS URL.
- Replace `https://yourdomain.com` in `extension/background.js` and `extension/manifest.json`.
- Set `LIFECYCLE_ENV=production`.
- Set `LIFECYCLE_AUTH_SECRET` to a strong random secret.
- Set `LIFECYCLE_ALLOWED_ORIGINS` to the deployed web origin, for example `https://yourdomain.com`.
- Set `LIFECYCLE_DB_PATH` to a writable persistent path for the server.
- Host `PRIVACY_POLICY.md` at a public URL and add it to the Chrome Web Store listing.
- Test install, sign up, sync, token expiry, and sign out in a clean Chrome profile.

Local development defaults:

- Backend URL: `http://127.0.0.1:8000` can be used by setting `backendUrl` in `chrome.storage.local`.
- Allowed CORS origins default to `http://127.0.0.1:8000,http://localhost:8000`.
- A dev auth secret is used only when `LIFECYCLE_ENV` is not `production`.
