/* Whole-page refresh. Only WeCom gets a custom gesture; Safari keeps its own. */
(function () {
  "use strict";
  let initialized = false;

  window.PageRefresh = {
    init({ hasUnsavedChanges = () => false } = {}) {
      if (initialized) return;
      initialized = true;
      if (!/wxwork/i.test(navigator.userAgent)) return;
      const indicator = document.getElementById("pullRefreshStatus");
      const label = document.getElementById("pullRefreshLabel");
      if (!indicator || !label) return;
      const root = document.documentElement;
      let settleTimer = null;
      const edited = new Map();
      let refreshing = false;
      let gesture = null;
      const threshold = 90;

      function valueOf(el) {
        if (el.isContentEditable) return el.textContent;
        if (el.type === "checkbox" || el.type === "radio") return el.checked;
        return el.value;
      }
      function isDraftControl(el) {
        return el instanceof Element && el.matches("input, textarea, select, [contenteditable='true']") &&
          !el.matches("[type='hidden'], [type='submit'], [type='button']") &&
          (el.matches("textarea, [contenteditable='true']") || !!el.closest("form, .field"));
      }
      // Capture before editing, including forms outside the spending module.
      document.addEventListener("focusin", (event) => {
        if (isDraftControl(event.target) && !edited.has(event.target)) {
          edited.set(event.target, valueOf(event.target));
        }
      });
      function trackChange(event) {
        const el = event.target;
        if (!isDraftControl(el) || edited.has(el)) return;
        const initial = el.type === "checkbox" || el.type === "radio" ? el.defaultChecked :
          el.tagName === "SELECT" ? undefined : el.defaultValue;
        edited.set(el, initial);
      }
      document.addEventListener("input", trackChange);
      document.addEventListener("change", trackChange);
      document.addEventListener("reset", (event) => {
        // reset fires before the browser restores control values.
        setTimeout(() => {
          for (const el of edited.keys()) {
            if (event.target.contains(el)) edited.delete(el);
          }
        }, 0);
      });
      function hasDraft() {
        if (hasUnsavedChanges()) return true;
        for (const [el, initial] of edited) {
          if (!el.isConnected) { edited.delete(el); continue; }
          if (el.getClientRects().length && valueOf(el) !== initial) return true;
        }
        return false;
      }
      function showPull(distance, loading = false) {
        clearTimeout(settleTimer);
        root.classList.remove("pull-refresh-settling");
        root.classList.add("pull-refresh-active");
        // Increasing resistance keeps even a long drag below 100px of travel.
        const offset = loading ? 56 : 100 * (1 - Math.exp(-distance / 125));
        root.style.setProperty("--pull-refresh-offset", offset + "px");
        root.style.setProperty("--pull-refresh-opacity", String(Math.min(1, distance / threshold)));
        root.style.setProperty("--pull-refresh-angle", Math.min(360, distance / threshold * 270) + "deg");
        const text = loading ? "正在刷新" : distance >= threshold ? "松开刷新" : "下拉刷新";
        if (label.textContent !== text) label.textContent = text;
      }
      function hideIndicator() {
        clearTimeout(settleTimer);
        root.classList.add("pull-refresh-settling");
        root.style.setProperty("--pull-refresh-offset", "0px");
        root.style.setProperty("--pull-refresh-opacity", "0");
        label.textContent = "";
        settleTimer = setTimeout(() => {
          root.classList.remove("pull-refresh-active", "pull-refresh-settling", "pull-refresh-loading");
        }, 260);
      }
      function refresh() {
        if (refreshing) return;
        if (hasDraft() && !window.confirm("页面中有修改过的输入或未保存内容，刷新可能丢失这些内容。确定刷新整个网页吗？")) {
          hideIndicator();
          return;
        }
        refreshing = true;
        showPull(threshold, true);
        root.classList.add("pull-refresh-settling", "pull-refresh-loading");
        // Allow the spinner and settling animation to paint before navigating.
        setTimeout(() => window.location.reload(), 240);
      }
      document.documentElement.classList.add("wecom-pull-refresh");
      function atTop() {
        return (document.scrollingElement || document.documentElement).scrollTop <= 0;
      }
      function cancelGesture() {
        gesture = null;
        if (!refreshing) hideIndicator();
      }
      function isGestureSurface(el) {
        if (!(el instanceof Element)) return false;
        if (el.closest("input, textarea, select, button, a, [contenteditable], [role='dialog'], .travel-map-wrap")) return false;
        // Nested lists, tables, chat panels and maps retain their own scrolling.
        for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
          const style = window.getComputedStyle(node);
          if (/(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflowX)) return false;
        }
        return true;
      }
      document.addEventListener("touchstart", (event) => {
        cancelGesture();
        if (refreshing || event.touches.length !== 1 || !atTop() || !isGestureSurface(event.target)) return;
        const touch = event.touches[0];
        gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, distance: 0 };
      }, { passive: true });
      document.addEventListener("touchmove", (event) => {
        if (!gesture) return;
        if (event.touches.length !== 1 || !atTop()) { cancelGesture(); return; }
        const touch = event.touches[0];
        if (touch.identifier !== gesture.id) { cancelGesture(); return; }
        const dy = touch.clientY - gesture.y;
        const dx = Math.abs(touch.clientX - gesture.x);
        if (dy < 0 || dx > 20 && dx > dy) { cancelGesture(); return; }
        gesture.distance = dy;
        if (dy < 12) { hideIndicator(); return; }
        if (!event.cancelable) { cancelGesture(); return; }
        event.preventDefault();
        showPull(dy);
      }, { passive: false });
      document.addEventListener("touchend", (event) => {
        if (!gesture) return;
        const completed = event.touches.length === 0 &&
          Array.from(event.changedTouches).some((touch) => touch.identifier === gesture.id);
        const ready = completed && gesture.distance >= threshold && atTop();
        if (ready) { gesture = null; refresh(); }
        else cancelGesture();
      }, { passive: true });
      document.addEventListener("touchcancel", cancelGesture, { passive: true });
      window.addEventListener("pagehide", cancelGesture);
    },
  };
})();
