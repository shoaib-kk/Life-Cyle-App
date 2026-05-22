"use strict";

(function () {
  const HOST_ID = "lifecycle-overlay-host";
  const DISMISSAL_STORAGE_KEY = "overlayDismissals";
  const DISMISS_MS = 30 * 60 * 1000;
  const AUTO_HIDE_MS = 12 * 1000;

  let dismissedUntil = 0;

  function hostKey() {
    return location.hostname.toLowerCase().replace(/^www\./, "");
  }

  async function loadDismissal() {
    try {
      const { [DISMISSAL_STORAGE_KEY]: dismissals = {} } = await chrome.storage.local.get({
        [DISMISSAL_STORAGE_KEY]: {}
      });
      dismissedUntil = Number(dismissals[hostKey()] || 0);
    } catch (_error) {
      dismissedUntil = 0;
    }
  }

  async function saveDismissal(until) {
    dismissedUntil = until;

    try {
      const { [DISMISSAL_STORAGE_KEY]: dismissals = {} } = await chrome.storage.local.get({
        [DISMISSAL_STORAGE_KEY]: {}
      });
      await chrome.storage.local.set({
        [DISMISSAL_STORAGE_KEY]: {
          ...dismissals,
          [hostKey()]: until
        }
      });
    } catch (_error) {
      // The in-memory value still suppresses repeated banners on this page.
    }
  }

  function ensureBanner() {
    let host = document.getElementById(HOST_ID);

    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      Object.assign(host.style, {
        all: "initial",
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "2147483647",
        display: "none",
        pointerEvents: "auto"
      });
      document.documentElement.appendChild(host);
    }

    if (!host.shadowRoot) {
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          :host {
            all: initial;
          }

          .banner {
            width: 260px;
            box-sizing: border-box;
            padding: 10px 12px 10px 14px;
            border-radius: 10px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            font-size: 12px;
            line-height: 1.45;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
            display: flex;
            align-items: flex-start;
            gap: 10px;
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 0.25s ease, transform 0.25s ease;
            cursor: default;
          }

          .icon {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
            margin-top: 1px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 11px;
          }

          .copy {
            flex: 1;
            min-width: 0;
          }

          .label {
            font-weight: 600;
            margin-bottom: 2px;
          }

          .body {
            opacity: 0.85;
          }

          button {
            border: 0;
            background: transparent;
            color: inherit;
            cursor: pointer;
            padding: 0;
            font: inherit;
            font-size: 14px;
            line-height: 1;
            opacity: 0.5;
            flex-shrink: 0;
            margin-top: 1px;
          }

          button:hover {
            opacity: 0.9;
          }
        </style>
        <div class="banner" part="banner">
          <div class="icon" aria-hidden="true">!</div>
          <div class="copy">
            <div class="label">LifeCycle</div>
            <div class="body"></div>
          </div>
          <button type="button" title="Dismiss" aria-label="Dismiss">x</button>
        </div>
      `;
      root.querySelector("button").addEventListener("click", () => hideBanner(true));
    }

    return {
      host,
      banner: host.shadowRoot.querySelector(".banner"),
      body: host.shadowRoot.querySelector(".body"),
      icon: host.shadowRoot.querySelector(".icon")
    };
  }

  async function showBanner({ line1, line2, level } = {}) {
    if (!dismissedUntil) {
      await loadDismissal();
    }

    if (Date.now() < dismissedUntil) {
      return;
    }

    const { host, banner, body, icon } = ensureBanner();
    const palette = {
      warn: {
        bg: "#faeeda",
        text: "#854f0b",
        border: "1px solid rgba(186, 117, 23, 0.3)",
        iconColor: "#ba7517"
      },
      danger: {
        bg: "#fcebeb",
        text: "#a32d2d",
        border: "1px solid rgba(226, 75, 74, 0.3)",
        iconColor: "#e24b4a"
      }
    };
    const colors = palette[level] || palette.warn;
    const lines = [line1, line2].filter(Boolean);

    banner.style.background = colors.bg;
    banner.style.color = colors.text;
    banner.style.border = colors.border;
    icon.style.color = colors.iconColor;
    body.textContent = lines.join(" - ");
    host.style.display = "block";

    requestAnimationFrame(() => {
      banner.style.opacity = "1";
      banner.style.transform = "translateY(0)";
    });

    clearTimeout(host._autoHide);
    host._autoHide = setTimeout(() => hideBanner(false), AUTO_HIDE_MS);
  }

  function hideBanner(manual = false) {
    const host = document.getElementById(HOST_ID);
    const banner = host?.shadowRoot?.querySelector(".banner");

    if (!host || !banner) {
      return;
    }

    banner.style.opacity = "0";
    banner.style.transform = "translateY(8px)";
    setTimeout(() => {
      if (host) {
        host.style.display = "none";
      }
    }, 280);

    if (manual) {
      saveDismissal(Date.now() + DISMISS_MS);
    }
  }

  loadDismissal();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "LIFECYCLE_OVERLAY_SHOW") {
      showBanner(message.payload);
    } else if (message?.type === "LIFECYCLE_OVERLAY_HIDE") {
      hideBanner(false);
    }
  });
})();
