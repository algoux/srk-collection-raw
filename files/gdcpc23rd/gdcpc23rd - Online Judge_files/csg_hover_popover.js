/**
 * CsgHoverPopover — 全局可复用悬停弹层（非 title / 非 Bootstrap Tooltip）
 * 样式：__STATIC__/css/csg_hover_popover.css（由 global_css 引入）
 *
 * 触发器：data-csg-hover-popover="list-json" + data-csg-popover-json='["a","b"]'（JSON 数组字符串）
 * 可选：data-csg-popover-heading="单行说明"（会显示在列表上方，仍走本弹层而非 Tooltip）
 * 可选：data-csg-popover-placement="bottom" | "top" | "auto"（默认 auto）
 */
(function (window, $) {
    "use strict";

    var LAYER_ID = "csg-hover-popover-layer";
    var hideTimer = null;
    var activeTrigger = null;
    var $layer = null;
    var repositionScheduled = false;
    var docListenersBound = false;
    var layerHoverBound = false;

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function ensureLayer() {
        if ($layer && $layer.length) {
            return $layer;
        }
        var el = document.getElementById(LAYER_ID);
        if (!el) {
            el = document.createElement("div");
            el.id = LAYER_ID;
            el.className = "csg-hover-popover-layer";
            el.setAttribute("role", "tooltip");
            el.hidden = true;
            document.body.appendChild(el);
        }
        $layer = $(el);
        if (!layerHoverBound) {
            layerHoverBound = true;
            $layer.on("mouseenter", function () {
                clearTimeout(hideTimer);
            });
            $layer.on("mouseleave", function () {
                scheduleHide();
            });
        }
        return $layer;
    }

    function scheduleHide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 120);
    }

    function hide() {
        clearTimeout(hideTimer);
        if ($layer && $layer.length) {
            $layer.removeClass("csg-hover-popover-layer--visible");
            $layer.attr("hidden", "hidden");
            $layer.empty();
        }
        activeTrigger = null;
    }

    function parseListJson(raw) {
        if (!raw || !String(raw).trim()) {
            return null;
        }
        try {
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : null;
        } catch (e) {
            return null;
        }
    }

    function buildHtml(trigger) {
        var items = parseListJson(trigger.getAttribute("data-csg-popover-json"));
        if (!items || !items.length) {
            return null;
        }
        var heading = trigger.getAttribute("data-csg-popover-heading");
        var parts = [];
        if (heading) {
            parts.push(
                '<div class="csg-hover-popover-heading">' +
                    escapeHtml(heading) +
                    "</div>"
            );
        }
        parts.push(
            '<ul class="csg-hover-popover-list">' +
                items
                    .map(function (x) {
                        return "<li>" + escapeHtml(String(x)) + "</li>";
                    })
                    .join("") +
                "</ul>"
        );
        return parts.join("");
    }

    function positionLayer(triggerEl, layerEl) {
        var trigger = triggerEl.getBoundingClientRect();
        var margin = 8;
        var placement = (
            triggerEl.getAttribute("data-csg-popover-placement") || "auto"
        ).toLowerCase();

        layerEl.style.visibility = "hidden";
        layerEl.classList.remove("csg-hover-popover-layer--visible");
        var lr = layerEl.getBoundingClientRect();
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        var top;
        if (placement === "top") {
            top = trigger.top - lr.height - margin;
        } else if (placement === "bottom") {
            top = trigger.bottom + margin;
        } else {
            top = trigger.bottom + margin;
            if (top + lr.height > vh - margin) {
                top = trigger.top - lr.height - margin;
            }
        }
        top = Math.max(margin, Math.min(top, vh - lr.height - margin));

        var left = trigger.left + trigger.width / 2 - lr.width / 2;
        left = Math.max(margin, Math.min(left, vw - lr.width - margin));

        layerEl.style.left = left + "px";
        layerEl.style.top = top + "px";
        layerEl.style.visibility = "";
        layerEl.classList.add("csg-hover-popover-layer--visible");
    }

    function show(triggerEl) {
        if (!triggerEl || !triggerEl.getAttribute) {
            return;
        }
        clearTimeout(hideTimer);
        var html = buildHtml(triggerEl);
        if (!html) {
            hide();
            return;
        }
        var $L = ensureLayer();
        activeTrigger = triggerEl;
        $L[0].removeAttribute("hidden");
        $L.html(html);
        positionLayer(triggerEl, $L[0]);
    }

    function requestReposition() {
        if (!activeTrigger || !$layer || !$layer.length || $layer[0].hidden) {
            return;
        }
        if (repositionScheduled) {
            return;
        }
        repositionScheduled = true;
        window.requestAnimationFrame(function () {
            repositionScheduled = false;
            if (activeTrigger && $layer && $layer[0] && !$layer[0].hidden) {
                positionLayer(activeTrigger, $layer[0]);
            }
        });
    }

    function onDocKeydown(e) {
        if (e.key === "Escape") {
            hide();
        }
    }

    function init() {
        if (!window.jQuery) {
            return;
        }
        ensureLayer();

        $(document)
            .off(".csgHoverPopover")
            .on("mouseenter.csgHoverPopover", '[data-csg-hover-popover="list-json"]', function () {
                show(this);
            })
            .on("mouseleave.csgHoverPopover", '[data-csg-hover-popover="list-json"]', function (e) {
                var to = e.relatedTarget;
                if ($layer && $layer.length && to && $layer[0].contains(to)) {
                    return;
                }
                scheduleHide();
            })
            .on("focusin.csgHoverPopover", '[data-csg-hover-popover="list-json"]', function () {
                show(this);
            })
            .on("focusout.csgHoverPopover", '[data-csg-hover-popover="list-json"]', function () {
                setTimeout(function () {
                    var ae = document.activeElement;
                    if ($layer && $layer.length && ae && $layer[0].contains(ae)) {
                        return;
                    }
                    if (ae && activeTrigger && activeTrigger.contains(ae)) {
                        return;
                    }
                    hide();
                }, 0);
            });

        $(window)
            .off(".csgHoverPopover")
            .on("scroll.csgHoverPopover resize.csgHoverPopover", requestReposition);
        if (!docListenersBound) {
            docListenersBound = true;
            document.addEventListener("scroll", requestReposition, true);
            document.addEventListener("keydown", onDocKeydown);
        }
    }

    window.CsgHoverPopover = {
        init: init,
        hide: hide,
        /** 动态更新 JSON 后刷新当前层（若该元素正展开） */
        refreshFor: function (el) {
            if (activeTrigger === el) {
                show(el);
            }
        },
    };

    $(function () {
        init();
    });
})(window, window.jQuery);
