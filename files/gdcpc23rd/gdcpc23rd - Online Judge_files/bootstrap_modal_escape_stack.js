/**
 * Bootstrap 5 多 Modal 层叠时，Esc 默认按「焦点所在 modal」冒泡处理，会导致先关掉下层。
 * 本脚本在 bootstrap.bundle 之前注册 document 捕获阶段监听：仅当同时存在多个 .modal.show 时，
 * 按 z-index + 包含关系 + 文档顺序选出最上层可键盘关闭的 modal，统一 hide，并阻止事件继续传递。
 *
 * 依赖：运行到 keydown 时 window.bootstrap.Modal 已存在（脚本仅先于 bundle 解析，用户按键时 bundle 已加载）。
 */
(function () {
    if (window.__csgBootstrapModalEscapeStack) {
        return;
    }
    window.__csgBootstrapModalEscapeStack = true;

    function numericZIndex(el) {
        const z = parseInt(window.getComputedStyle(el).zIndex, 10);
        return Number.isFinite(z) ? z : 0;
    }

    /** x 是否比 y 更靠近用户（应先于 y 被 Esc 关闭） */
    function isStackAbove(x, y) {
        const zx = numericZIndex(x);
        const zy = numericZIndex(y);
        if (zx !== zy) {
            return zx > zy;
        }
        if (x !== y && x.contains(y)) {
            return false;
        }
        if (x !== y && y.contains(x)) {
            return true;
        }
        const pos = x.compareDocumentPosition(y);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
            return false;
        }
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
            return true;
        }
        return false;
    }

    function isKeyboardDismissible(modalEl) {
        if (modalEl.getAttribute('data-csg-modal-skip-global-esc') === 'true') {
            return false;
        }
        if (modalEl.getAttribute('data-bs-keyboard') === 'false') {
            return false;
        }
        if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
            return true;
        }
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst && inst._config && inst._config.keyboard === false) {
            return false;
        }
        return true;
    }

    function pickTopmostModal(modalElements) {
        const list = Array.prototype.filter.call(modalElements, isKeyboardDismissible);
        if (list.length === 0) {
            return null;
        }
        return list.reduce(function (top, cur) {
            return isStackAbove(cur, top) ? cur : top;
        });
    }

    document.addEventListener(
        'keydown',
        function (ev) {
            if (ev.key !== 'Escape') {
                return;
            }
            if (ev.defaultPrevented) {
                return;
            }

            const shown = document.querySelectorAll('.modal.show');
            if (shown.length < 2) {
                return;
            }

            if (document.querySelector('.dropdown-menu.show')) {
                return;
            }

            const top = pickTopmostModal(shown);
            if (!top) {
                return;
            }

            if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
                return;
            }

            const inst = bootstrap.Modal.getInstance(top);
            if (!inst) {
                return;
            }

            ev.preventDefault();
            ev.stopImmediatePropagation();
            inst.hide();
        },
        true
    );
})();
