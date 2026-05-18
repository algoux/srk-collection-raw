/**
 * 移动端（≤768px，与 sidebarlayout.css 一致）：侧栏打开时提供遮罩 + 明显关闭钮（类 offcanvas），
 * 与顶栏汉堡 .cpc-nav-toggle 共用 #sidebar_div.sidebar 的 .show 状态。
 */
(function () {
    function isMobileSidebarLayout() {
        return window.matchMedia("(max-width: 768px)").matches;
    }

    const NAV_TOP_PX = 56; /* 与 sidebarlayout 移动端 .cpc-navbar height 3.5rem 一致 */

    /** 与 Bootstrap collapse 同步：优先触发顶栏汉堡的点击逻辑 */
    function closeMobileSidebarFromChrome() {
        const sb = document.getElementById("sidebar_div");
        const navBtn = document.querySelector(".cpc-nav-toggle");
        if (!sb || !sb.classList.contains("show")) return;
        if (navBtn) {
            navBtn.click();
        } else {
            sb.classList.remove("show");
            layoutMobileSidebarChrome();
        }
    }

    function layoutMobileSidebarChrome() {
        const edge = document.getElementById("csg_sidebar_mobile_edge");
        const backdrop = document.getElementById("csg_sidebar_mobile_backdrop");
        const sb = document.getElementById("sidebar_div");
        if (!edge || !sb) return;

        if (!isMobileSidebarLayout()) {
            edge.setAttribute("hidden", "");
            if (backdrop) {
                backdrop.setAttribute("hidden", "");
                backdrop.setAttribute("aria-hidden", "true");
            }
            edge.style.removeProperty("top");
            edge.style.removeProperty("left");
            return;
        }

        const open = sb.classList.contains("show");
        if (!open) {
            edge.setAttribute("hidden", "");
            if (backdrop) {
                backdrop.setAttribute("hidden", "");
                backdrop.setAttribute("aria-hidden", "true");
            }
            edge.style.removeProperty("top");
            edge.style.removeProperty("left");
            return;
        }

        if (backdrop) {
            backdrop.removeAttribute("hidden");
            backdrop.setAttribute("aria-hidden", "false");
        }
        edge.removeAttribute("hidden");

        const r = sb.getBoundingClientRect();
        const fab = 44;
        const top = NAV_TOP_PX + 10;
        edge.style.top = top + "px";
        const rightEdge = r.width > 8 ? r.right : Math.min(window.innerWidth * 0.88, 320);
        edge.style.left = Math.max(8, Math.round(rightEdge - fab / 2)) + "px";
    }

    function onBackdropOrFabActivate(ev) {
        const sb = document.getElementById("sidebar_div");
        if (!sb || !isMobileSidebarLayout() || !sb.classList.contains("show")) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        closeMobileSidebarFromChrome();
    }

    function mountChromeToBody() {
        ["csg_sidebar_mobile_backdrop", "csg_sidebar_mobile_edge"].forEach(
            function (id) {
                const el = document.getElementById(id);
                if (el && el.parentNode !== document.body) {
                    document.body.appendChild(el);
                }
            }
        );
    }

    function init() {
        mountChromeToBody();
        const edge = document.getElementById("csg_sidebar_mobile_edge");
        const backdrop = document.getElementById("csg_sidebar_mobile_backdrop");
        const sb = document.getElementById("sidebar_div");
        if (!edge || !sb) return;

        edge.addEventListener("click", onBackdropOrFabActivate);
        if (backdrop) {
            backdrop.addEventListener("click", onBackdropOrFabActivate);
        }

        const navBtn = document.querySelector(".cpc-nav-toggle");
        if (navBtn) {
            navBtn.addEventListener("click", () => {
                setTimeout(layoutMobileSidebarChrome, 0);
                setTimeout(layoutMobileSidebarChrome, 200);
            });
        }
        const mo = new MutationObserver(() => layoutMobileSidebarChrome());
        mo.observe(sb, { attributes: true, attributeFilter: ["class"] });
        window.addEventListener("resize", layoutMobileSidebarChrome);
        window.addEventListener("scroll", layoutMobileSidebarChrome, { passive: true });
        layoutMobileSidebarChrome();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
