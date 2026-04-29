/* ─────────────────────────────────────────────
   LifeCycle content.js — in-page overlay banner
   Injected into every http/https page.
   Listens for messages from background.js and
   shows a non-intrusive banner at the bottom-right.
───────────────────────────────────────────── */

"use strict";

(function () {
  const BANNER_ID = "lifecycle-overlay-banner";

  /* ── Build the banner DOM (once) ────────── */
  function ensureBanner() {
    let el = document.getElementById(BANNER_ID);
    if (el) return el;

    el = document.createElement("div");
    el.id = BANNER_ID;

    Object.assign(el.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      zIndex: "2147483647",
      width: "260px",
      padding: "10px 12px 10px 14px",
      borderRadius: "10px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      fontSize: "12px",
      lineHeight: "1.45",
      boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
      display: "flex",
      alignItems: "flex-start",
      gap: "10px",
      transition: "opacity 0.25s ease, transform 0.25s ease",
      opacity: "0",
      transform: "translateY(8px)",
      pointerEvents: "auto",
      cursor: "default",
    });

    // Icon
    const icon = document.createElement("div");
    Object.assign(icon.style, {
      width: "18px",
      height: "18px",
      flexShrink: "0",
      marginTop: "1px",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: "700",
      fontSize: "11px",
    });
    icon.textContent = "⏱";
    el.appendChild(icon);

    // Text container
    const textWrap = document.createElement("div");
    textWrap.style.flex = "1";
    textWrap.style.minWidth = "0";

    const label = document.createElement("div");
    label.id = BANNER_ID + "-label";
    label.style.fontWeight = "600";
    label.style.marginBottom = "2px";
    label.textContent = "LifeCycle";

    const body = document.createElement("div");
    body.id = BANNER_ID + "-body";
    body.style.opacity = "0.85";

    textWrap.appendChild(label);
    textWrap.appendChild(body);
    el.appendChild(textWrap);

    // Dismiss button
    const dismiss = document.createElement("button");
    Object.assign(dismiss.style, {
      border: "none",
      background: "transparent",
      cursor: "pointer",
      padding: "0",
      fontSize: "14px",
      lineHeight: "1",
      opacity: "0.5",
      flexShrink: "0",
      marginTop: "1px",
    });
    dismiss.textContent = "✕";
    dismiss.title = "Dismiss";
    dismiss.addEventListener("click", () => hideBanner(true));
    el.appendChild(dismiss);

    document.documentElement.appendChild(el);
    return el;
  }

  let dismissedUntil = 0;  // timestamp — user manually dismissed

  function showBanner({ line1, line2, level }) {
    if (Date.now() < dismissedUntil) return;  // respect manual dismissal

    const el = ensureBanner();
    const bodyEl = document.getElementById(BANNER_ID + "-body");

    // Colours per level
    const palette = {
      warn: {
        bg: "#faeeda",
        text: "#854f0b",
        border: "1px solid rgba(186,117,23,0.3)",
        iconColor: "#ba7517",
      },
      danger: {
        bg: "#fcebeb",
        text: "#a32d2d",
        border: "1px solid rgba(226,75,74,0.3)",
        iconColor: "#e24b4a",
      },
    };

    const p = palette[level] || palette.warn;
    el.style.background = p.bg;
    el.style.color = p.text;
    el.style.border = p.border;

    const iconEl = el.querySelector("div");
    if (iconEl) iconEl.style.color = p.iconColor;

    const lines = [line1, line2].filter(Boolean);
    if (bodyEl) bodyEl.textContent = lines.join(" · ");

    // Animate in
    el.style.display = "flex";
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });

    // Auto-hide after 12 s
    clearTimeout(el._autoHide);
    el._autoHide = setTimeout(() => hideBanner(false), 12000);
  }

  function hideBanner(manual = false) {
    const el = document.getElementById(BANNER_ID);
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => { if (el) el.style.display = "none"; }, 280);

    if (manual) {
      // Suppress re-showing for 30 minutes after a manual dismiss
      dismissedUntil = Date.now() + 30 * 60 * 1000;
    }
  }

  /* ── Listen for messages from background ── */
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "LIFECYCLE_OVERLAY_SHOW") {
      showBanner(message.payload);
    } else if (message?.type === "LIFECYCLE_OVERLAY_HIDE") {
      hideBanner(false);
    }
  });
})();
