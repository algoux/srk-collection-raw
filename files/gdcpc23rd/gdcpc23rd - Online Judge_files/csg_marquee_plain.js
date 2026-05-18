/**
 * 纯文本横向跑马灯（与 rank_roll.js enableMarqueeIfNeeded 同源算法）：
 * 文案 + 分隔 + 文案，`translateX(0)` → `translateX(-(单段宽+分隔宽))`，循环一周即「开头再次对齐开头」。
 * 另提供 applyTwoLineClampOrMarquee：先 -webkit-line-clamp 多行，仍溢出再退回本跑马灯。
 * 直播 HUD / 独立页顶栏：applyMastheadHeadlineSlot → buildIntermittentTrack + startIntermittentMarqueeGroupFromHosts（间歇：滚一段 + 静止，非 needs-marquee 持续动画）。
 * CPC 队卡教练/选手：applyCpcCoachMemberSlot（内层 clamp，判定同源）。
 */
(function (global) {
    /**
     * @param {string} seg
     * @param {CSSStyleDeclaration} computedStyle
     * @returns {number}
     */
    function measureSegPlain(seg, computedStyle) {
        const t = document.createElement('span');
        t.style.visibility = 'hidden';
        t.style.position = 'absolute';
        t.style.whiteSpace = 'nowrap';
        t.style.fontSize = computedStyle.fontSize;
        t.style.fontWeight = computedStyle.fontWeight;
        t.style.fontFamily = computedStyle.fontFamily;
        t.style.letterSpacing = computedStyle.letterSpacing;
        t.style.fontStyle = computedStyle.fontStyle;
        const wkSh = computedStyle.webkitTextStroke;
        if (wkSh && wkSh !== 'none' && String(wkSh).trim() !== '') {
            t.style.webkitTextStroke = wkSh;
        } else {
            const wkStrokeW = computedStyle.webkitTextStrokeWidth;
            if (wkStrokeW && wkStrokeW !== '0px') {
                t.style.webkitTextStrokeWidth = wkStrokeW;
                t.style.webkitTextStrokeColor = computedStyle.webkitTextStrokeColor || 'transparent';
            }
        }
        const ts = computedStyle.textShadow;
        if (ts && ts !== 'none') {
            t.style.textShadow = ts;
        }
        const po = computedStyle.paintOrder;
        if (po) {
            t.style.paintOrder = po;
        }
        t.textContent = seg;
        document.body.appendChild(t);
        const w = t.offsetWidth;
        document.body.removeChild(t);
        return w;
    }

    /**
     * @param {HTMLElement} element
     * @param {string} text
     * @param {{ htmlWhenFit?: string, marqueeAggressive?: boolean, overflowSlackRatio?: number }} [options]
     */
    function enableMarqueeIfNeeded(element, text, options) {
        options = options || {};
        const htmlWhenFit = options.htmlWhenFit;
        const hasText = text != null && String(text).trim() !== '';

        if (!element) {
            return;
        }

        if (!hasText) {
            element.classList.remove('needs-marquee', 'csg-mq-slot--twoline');
            const clearWrap = element.querySelector('.marquee-wrapper');
            if (clearWrap) {
                clearWrap.remove();
            }
            const innerClear = element.querySelector('.csg-mq-slot__inner');
            if (innerClear) {
                innerClear.remove();
            }
            element.innerHTML = '';
            element.style.removeProperty('--marquee-duration');
            element.style.removeProperty('--marquee-translate');
            element.style.removeProperty('-webkit-line-clamp');
            return;
        }

        const textNorm = String(text).trim();
        if (element.hasAttribute('data-mq-plain')) {
            const attrPlain = String(element.getAttribute('data-mq-plain') || '').trim();
            if (
                attrPlain === textNorm &&
                element.classList.contains('needs-marquee') &&
                element.querySelector('.marquee-wrapper')
            ) {
                return;
            }
        }

        element.classList.remove('needs-marquee', 'csg-mq-slot--twoline');
        const oldWrapper = element.querySelector('.marquee-wrapper');
        if (oldWrapper) {
            oldWrapper.remove();
        }
        const oldInner = element.querySelector('.csg-mq-slot__inner');
        if (oldInner) {
            oldInner.remove();
        }

        element.textContent = String(text);

        const minDur = options.marqueeAggressive ? 1.2 : 4;
        const baseSpeed = options.marqueeAggressive ? 155 : 80;

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (!element.parentNode) {
                    return;
                }
                const computedStyle = window.getComputedStyle(element);
                const containerWidth = element.clientWidth;
                if (containerWidth <= 0) {
                    return;
                }
                const slackRatio =
                    options.overflowSlackRatio != null && Number.isFinite(Number(options.overflowSlackRatio))
                        ? Number(options.overflowSlackRatio)
                        : 0.01;
                const slack = Math.max(2, Math.round(containerWidth * slackRatio));
                const intrinsic = measureSegPlain(String(text), computedStyle);
                const isOverflowing = intrinsic > containerWidth + slack;

                if (isOverflowing) {
                    const separator = '    　    ';
                    const singleTextWidth = intrinsic;
                    element.textContent = '';
                    const probe = document.createElement('span');
                    probe.className = 'marquee-wrapper';
                    probe.setAttribute('aria-hidden', 'true');
                    probe.style.cssText =
                        'visibility:hidden;position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;width:auto;height:auto;';
                    probe.textContent = text + separator;
                    element.appendChild(probe);
                    let translateDistance = probe.offsetWidth;
                    if (!translateDistance || translateDistance < 1) {
                        const sepW = measureSegPlain(separator, computedStyle);
                        translateDistance = Math.max(1, Math.ceil(singleTextWidth + sepW));
                    }
                    element.removeChild(probe);
                    const duration = Math.max(minDur, translateDistance / baseSpeed);
                    element.style.setProperty('--marquee-duration', duration + 's');
                    element.style.setProperty('--marquee-translate', -translateDistance + 'px');

                    const wrapper = document.createElement('span');
                    wrapper.className = 'marquee-wrapper';
                    wrapper.textContent = text + separator + text;
                    element.appendChild(wrapper);
                    element.classList.add('needs-marquee');
                } else {
                    element.classList.remove('needs-marquee');
                    if (htmlWhenFit) {
                        element.innerHTML = htmlWhenFit;
                    }
                }
            });
        });
    }

    /**
     * 先按多行（默认 2 行）排版；竖直或水平仍溢出则改为 rank_roll 同源单行跑马灯。
     * @param {HTMLElement} element
     * @param {string} text
     * @param {{ marqueeAggressive?: boolean, overflowSlackRatio?: number, lineClamp?: number }} [options]
     */
    function applyTwoLineClampOrMarquee(element, text, options) {
        options = options || {};
        const lineClamp = options.lineClamp != null && Number.isFinite(Number(options.lineClamp)) ? Math.max(1, Math.floor(Number(options.lineClamp))) : 2;
        if (!element) {
            return;
        }
        const raw = text != null ? String(text).trim() : '';
        if (!raw) {
            element.classList.remove('needs-marquee', 'csg-mq-slot--twoline');
            const w0 = element.querySelector('.marquee-wrapper');
            if (w0) {
                w0.remove();
            }
            element.innerHTML = '';
            element.style.removeProperty('--marquee-duration');
            element.style.removeProperty('--marquee-translate');
            element.style.removeProperty('-webkit-line-clamp');
            return;
        }

        element.classList.remove('needs-marquee');
        const oldWrapper = element.querySelector('.marquee-wrapper');
        if (oldWrapper) {
            oldWrapper.remove();
        }
        element.style.removeProperty('--marquee-duration');
        element.style.removeProperty('--marquee-translate');
        element.classList.remove('csg-mq-slot--twoline');
        element.innerHTML = '';
        element.style.setProperty('-webkit-line-clamp', String(lineClamp));

        const inner = document.createElement('span');
        inner.className = 'csg-mq-slot__inner';
        inner.textContent = raw;
        element.appendChild(inner);
        element.classList.add('csg-mq-slot--twoline');

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (!element.parentNode) {
                    return;
                }
                const slack = Math.max(
                    2,
                    Math.round((element.clientWidth || 0) * (options.overflowSlackRatio != null ? Number(options.overflowSlackRatio) : 0.01))
                );
                const vOverflow = element.scrollHeight - element.clientHeight > 1;
                const hOverflow = element.scrollWidth - element.clientWidth > slack;
                if (!vOverflow && !hOverflow) {
                    return;
                }
                element.classList.remove('csg-mq-slot--twoline');
                element.style.removeProperty('-webkit-line-clamp');
                element.innerHTML = '';
                enableMarqueeIfNeeded(element, raw, options);
            });
        });
    }

    function clearHudHeadlineMarqueePreflight(host) {
        if (!host || !host.style) {
            return;
        }
        host.style.removeProperty('white-space');
        host.style.removeProperty('overflow');
    }

    /** 顶栏/副标题禁止持续跑马（needs-marquee + CSS infinite），仅允许间歇轨道。 */
    function stripContinuousMarquee(host) {
        if (!host) {
            return;
        }
        host.classList.remove('needs-marquee');
        host.style.removeProperty('--marquee-duration');
        host.style.removeProperty('--marquee-translate');
        var mw = host.querySelector('.marquee-wrapper');
        if (mw) {
            mw.remove();
        }
    }

    function mastheadPlainOneLine(plain) {
        return String(plain != null ? plain : '')
            .trim()
            .replace(/\s+/g, ' ');
    }

    /** 顶栏间歇轨道已就绪且文案未变：跳过重算，避免滚完一轮前被 refresh 重置 anchor。 */
    function mastheadInterHostIsCurrent(host, raw) {
        if (!host || !host.isConnected || host.getAttribute('data-csg-mq-inter') !== '1') {
            return false;
        }
        var one = mastheadPlainOneLine(raw);
        if (!one) {
            return false;
        }
        var savedRaw = host.getAttribute('data-csg-mq-raw');
        if (savedRaw !== one) {
            return false;
        }
        var stored = readHeadlinePlainAttr(host);
        if (stored !== one && stored !== String(raw != null ? raw : '').trim()) {
            return false;
        }
        var track = host.querySelector('.csg-mq-inter-track');
        var seg = track && track.querySelector('.csg-mq-inter-seg');
        return !!(track && seg);
    }

    function clearInnerHudLineClamp(inner) {
        if (!inner || !inner.style) {
            return;
        }
        inner.style.removeProperty('-webkit-line-clamp');
        inner.style.removeProperty('-webkit-box-orient');
        inner.style.overflow = '';
        inner.style.display = '';
    }

    function applyInnerHudTwoLineClamp(inner) {
        if (!inner || !inner.style) {
            return;
        }
        inner.style.whiteSpace = 'normal';
        inner.style.display = '-webkit-box';
        inner.style.setProperty('-webkit-box-orient', 'vertical');
        inner.style.overflow = 'hidden';
        inner.style.setProperty('-webkit-line-clamp', '2');
    }

    function measureHudWrappedTextHeight(text, widthPx, computedStyle) {
        var d = document.createElement('div');
        d.textContent = text != null ? String(text) : '';
        d.style.cssText =
            'position:absolute;left:-99999px;top:0;visibility:hidden;display:block;' +
            'width:' +
            widthPx +
            'px;white-space:normal;word-break:break-word;overflow-wrap:anywhere;' +
            'box-sizing:border-box;';
        d.style.fontSize = computedStyle.fontSize;
        d.style.fontFamily = computedStyle.fontFamily;
        d.style.fontWeight = computedStyle.fontWeight;
        d.style.fontStyle = computedStyle.fontStyle;
        d.style.letterSpacing = computedStyle.letterSpacing;
        d.style.lineHeight = computedStyle.lineHeight;
        document.body.appendChild(d);
        var h = d.scrollHeight;
        document.body.removeChild(d);
        return h;
    }

    function readHeadlinePlainAttr(host) {
        if (!host) {
            return '';
        }
        var a = host.getAttribute('data-csg-mq-plain');
        if (a != null && String(a).trim() !== '') {
            return String(a).trim();
        }
        a = host.getAttribute('data-mq-plain');
        if (a != null && String(a).trim() !== '') {
            return String(a).trim();
        }
        return readCpcSlotPlainAttr(host);
    }

    /**
     * 综合 HUD 队列/过题条 .contestlive-hud-mq-line：与 team_display 队名槽同源间歇跑马（禁止 enableMarqueeIfNeeded 持续动画）。
     * @param {HTMLElement} root 通常为 #contestlive_display_root（勿与 #contestlive_hud_masthead 混用同一 root）
     */
    function applyHudMqLineIntermittentGroup(root, options) {
        options = options || {};
        if (!root || typeof root.querySelectorAll !== 'function') {
            return;
        }
        if (typeof stopIntermittentMarqueeGroup === 'function') {
            stopIntermittentMarqueeGroup(root);
        }
        var nodes = root.querySelectorAll('.contestlive-hud-mq-line[data-mq-plain]');
        var interHosts = [];
        var needRetry = false;
        var slotOpts = {
            overflowSlackRatio:
                options.overflowSlackRatio != null && Number.isFinite(Number(options.overflowSlackRatio))
                    ? Number(options.overflowSlackRatio)
                    : 0.02
        };
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (!n.parentNode) {
                continue;
            }
            stripContinuousMarquee(n);
            var plain = n.getAttribute('data-mq-plain');
            var mode = applyCpcPlainLineIntermittentSlot(n, plain != null ? plain : '', slotOpts);
            if (mode === 'inter') {
                interHosts.push(n);
            } else if (mode === 'pending') {
                needRetry = true;
            }
        }
        if (needRetry) {
            requestAnimationFrame(function () {
                applyHudMqLineIntermittentGroup(root, options);
            });
            return;
        }
        if (interHosts.length) {
            startIntermittentMarqueeGroupFromHosts(root, interHosts, options);
        }
    }

    function clearMastheadHeadlineSlotState(host) {
        if (!host) {
            return;
        }
        host.classList.remove(
            'csg-mq-masthead-pending',
            'contestlive-hud-headline-slot--single',
            'csg-mq-slot--twoline'
        );
        host.style.removeProperty('-webkit-line-clamp');
        host.removeAttribute('data-csg-mq-ready');
        stripContinuousMarquee(host);
        clearHudHeadlineMarqueePreflight(host);
    }

    /**
     * 直播顶栏标题槽终态 DOM（host 级两行 clamp，与 contestlive.css 首帧一致；勿用 inner -webkit-box）。
     * @param {'single'|'double'} mode
     */
    function renderMastheadHeadlineInner(host, raw, mode) {
        host.innerHTML = '';
        host.classList.remove(
            'csg-mq-masthead-pending',
            'contestlive-hud-headline-slot--single',
            'csg-mq-slot--twoline'
        );
        host.style.removeProperty('-webkit-line-clamp');
        host.removeAttribute('data-csg-mq-inter');
        host.removeAttribute('data-csg-mq-raw');
        stripContinuousMarquee(host);
        clearHudHeadlineMarqueePreflight(host);
        var inner = document.createElement('span');
        inner.className = 'csg-mq-slot__inner';
        inner.textContent = raw;
        host.appendChild(inner);
        if (mode === 'single') {
            host.classList.add('contestlive-hud-headline-slot--single');
            inner.style.whiteSpace = 'nowrap';
            inner.style.display = 'block';
            inner.style.overflow = 'hidden';
            return;
        }
        host.classList.add('csg-mq-slot--twoline');
        host.style.setProperty('-webkit-line-clamp', '2');
        inner.style.whiteSpace = 'normal';
        inner.style.display = 'block';
    }

    /**
     * 直播顶栏标题/副标题槽：与 team_display 教练/选手完全同源（applyCpcCoachMemberSlot · 间歇轨道）。
     * @returns {'empty'|'single'|'double'|'inter'|'pending'}
     */
    function applyMastheadHeadlineSlot(host, plain, options) {
        options = options || {};
        if (!host) {
            return 'empty';
        }
        var raw = plain != null ? String(plain).trim() : '';
        if (!raw) {
            clearMastheadHeadlineSlotState(host);
            host.innerHTML = '';
            host.removeAttribute('data-csg-mq-plain');
            host.removeAttribute('data-cpc-val-plain');
            return 'empty';
        }
        host.setAttribute('data-csg-mq-plain', raw);
        if (mastheadInterHostIsCurrent(host, raw)) {
            return 'inter';
        }
        stripContinuousMarquee(host);
        return applyCpcCoachMemberSlot(host, raw, options);
    }

    /**
     * HUD / 独立页顶栏 .contestlive-hud__titles：与 CpcTeamCardsRefreshArticleHudSlots 同流程（间歇，非持续跑马）。
     */
    function applyHudMastheadHeadlines(mastheadRoot, entries, options) {
        options = options || {};
        if (!mastheadRoot) {
            return;
        }
        var list = entries || [];
        var slackRatio =
            options.overflowSlackRatio != null && Number.isFinite(Number(options.overflowSlackRatio))
                ? Number(options.overflowSlackRatio)
                : 0.02;
        var slotOpts = { overflowSlackRatio: slackRatio };
        var pending = [];
        var interHosts = [];
        var dirty = [];

        for (var si = 0; si < list.length; si++) {
            var ent0 = list[si];
            if (!ent0 || !ent0.el) {
                continue;
            }
            var raw0 = ent0.raw != null ? String(ent0.raw).trim() : '';
            if (!raw0) {
                dirty.push(ent0);
                continue;
            }
            if (mastheadInterHostIsCurrent(ent0.el, raw0)) {
                interHosts.push(ent0.el);
            } else {
                dirty.push(ent0);
            }
        }

        var prevState = intermittentState.byRoot.get(mastheadRoot);
        if (!dirty.length && interHosts.length && prevState && prevState.items && prevState.items.length) {
            ensureIntermittentRaf();
            return;
        }

        stopIntermittentMarqueeGroup(mastheadRoot);
        interHosts = [];

        function runBatch(batch) {
            for (var i = 0; i < batch.length; i++) {
                var ent = batch[i];
                if (!ent || !ent.el) {
                    continue;
                }
                var mode = applyMastheadHeadlineSlot(ent.el, ent.raw != null ? ent.raw : '', slotOpts);
                if (mode === 'pending') {
                    pending.push(ent);
                } else if (mode === 'inter') {
                    interHosts.push(ent.el);
                }
            }
        }

        runBatch(dirty.length ? dirty : list);

        function finishInter() {
            if (!interHosts.length || !mastheadRoot.isConnected) {
                return;
            }
            var interOpts = Object.assign(
                {
                    speedPxPerSec: 72,
                    pauseMs: 2600,
                    minScrollMs: 1800,
                    maxScrollMs: 32000,
                    overflowSlackRatio: slackRatio
                },
                options
            );
            startIntermittentMarqueeGroupFromHosts(mastheadRoot, interHosts, interOpts);
        }

        if (pending.length) {
            requestAnimationFrame(function () {
                if (!mastheadRoot.isConnected) {
                    return;
                }
                interHosts = [];
                runBatch(pending);
                finishInter();
            });
            return;
        }
        finishInter();
    }

    /**
     * 同步间歇横向跑马灯：同一 root 下多条共用「滚动阶段 + 静止间隙」时间轴，全局单 rAF 驱动。
     * 一轮 = translate 从 0 线性到各格自身位移上限（与首字再次对齐），随后统一 pauseMs 静止，再进入下一轮。
     * @param {HTMLElement} root
     * @param {string} [selector]
     * @param {{
     *   speedPxPerSec?: number,
     *   pauseMs?: number,
     *   minScrollMs?: number,
     *   maxScrollMs?: number,
     *   overflowSlackRatio?: number
     * }} [options]
     */
    var intermittentState = {
        byRoot: new Map(),
        rafId: null,
        resizeWired: false,
        resizeTimer: null
    };

    function restoreIntermittentHost(host) {
        var raw = host.getAttribute('data-csg-mq-raw');
        host.removeAttribute('data-csg-mq-raw');
        host.removeAttribute('data-csg-mq-inter');
        clearHudHeadlineMarqueePreflight(host);
        host.innerHTML = '';
        host.textContent = raw != null ? raw : '';
    }

    function buildIntermittentTrack(host, plainText) {
        stripContinuousMarquee(host);
        clearHudHeadlineMarqueePreflight(host);
        host.innerHTML = '';
        var clip = document.createElement('span');
        clip.className = 'csg-mq-inter-clip';
        var track = document.createElement('span');
        track.className = 'csg-mq-inter-track';
        var seg1 = document.createElement('span');
        seg1.className = 'csg-mq-inter-seg';
        seg1.textContent = plainText;
        var sepEl = document.createElement('span');
        sepEl.className = 'csg-mq-inter-sep';
        sepEl.textContent = '    　    ';
        var seg2 = document.createElement('span');
        seg2.className = 'csg-mq-inter-seg';
        seg2.textContent = plainText;
        seg2.setAttribute('aria-hidden', 'true');
        track.appendChild(seg1);
        track.appendChild(sepEl);
        track.appendChild(seg2);
        clip.appendChild(track);
        host.appendChild(clip);
        var cw = host.clientWidth || 0;
        var slack = Math.max(2, Math.round(cw * 0.02));
        var csTrack = window.getComputedStyle(host);
        var segW1 = seg1.offsetWidth;
        var sepW = sepEl.offsetWidth;
        var segW2 = seg2.offsetWidth;
        if (segW1 < 1) {
            segW1 = measureSegPlain(plainText, csTrack);
        }
        if (sepW < 1) {
            sepW = measureSegPlain(sepEl.textContent, csTrack);
        }
        var d = segW1 + sepW;
        /* 整段轨道若完全落在槽宽内，静止时会同时看见两段文案；offsetWidth 为 0 时须用离屏测量，勿误判 */
        if (cw > 0 && segW1 > 0 && segW1 + sepW + segW2 <= cw + slack) {
            host.innerHTML = '';
            host.removeAttribute('data-csg-mq-inter');
            host.removeAttribute('data-csg-mq-raw');
            return null;
        }
        host.setAttribute('data-csg-mq-inter', '1');
        host.setAttribute('data-csg-mq-raw', plainText);
        return { track: track, d: d };
    }

    function hudLineHeightPx(computedStyle) {
        var lhNum = parseFloat(computedStyle.lineHeight);
        if (!Number.isFinite(lhNum) || lhNum < 2) {
            lhNum = parseFloat(computedStyle.fontSize) * 1.35;
        }
        return lhNum;
    }

    function renderCoachMemberInner(host, raw, mode) {
        host.innerHTML = '';
        host.classList.remove('csg-mq-slot--twoline', 'contestlive-hud-headline-slot--single', 'needs-marquee');
        host.style.removeProperty('-webkit-line-clamp');
        host.removeAttribute('data-csg-mq-inter');
        host.removeAttribute('data-csg-mq-raw');
        clearHudHeadlineMarqueePreflight(host);
        var inner = document.createElement('span');
        inner.className = 'csg-mq-slot__inner';
        inner.textContent = raw;
        host.appendChild(inner);
        if (mode === 'single') {
            host.classList.add('contestlive-hud-headline-slot--single');
            clearInnerHudLineClamp(inner);
            inner.style.whiteSpace = 'nowrap';
            inner.style.display = 'block';
            inner.style.overflow = 'hidden';
            return;
        }
        host.classList.add('csg-mq-slot--twoline');
        applyInnerHudTwoLineClamp(inner);
    }

    /**
     * CPC 队伍卡片教练/选手：单次测量、单次写 DOM（不用 HUD 双 rAF）。
     * ≤2 行：内层 clamp；>2 行且 nowrap 宽于槽：间歇跑马（仅此时双段轨道）。
     * @returns {'single'|'double'|'inter'|'pending'}
     */
    function applyCpcCoachMemberSlot(host, plain, options) {
        options = options || {};
        if (!host) {
            return 'empty';
        }
        var raw = plain != null ? String(plain).trim() : '';
        if (!raw) {
            host.innerHTML = '';
            host.classList.remove('cpc-hud-mq-pending');
            host.removeAttribute('data-cpc-mq-ready');
            host.removeAttribute('data-cpc-val-plain');
            return 'empty';
        }
        host.setAttribute('data-cpc-val-plain', raw);
        if (host.getAttribute('data-csg-mq-inter') === '1') {
            restoreIntermittentHost(host);
        }
        var cw = host.clientWidth || 0;
        if (cw <= 0) {
            host.classList.add('cpc-hud-mq-pending');
            return 'pending';
        }
        var cs = window.getComputedStyle(host);
        var lh = hudLineHeightPx(cs);
        var slackV = 2;
        var slackRatio =
            options.overflowSlackRatio != null && Number.isFinite(Number(options.overflowSlackRatio))
                ? Number(options.overflowSlackRatio)
                : 0.02;
        var slackW = Math.max(2, Math.round(cw * slackRatio));
        var natH = measureHudWrappedTextHeight(raw, cw, cs);
        var oneLine = raw.replace(/\s+/g, ' ');
        var intr = measureSegPlain(oneLine, cs);

        host.classList.remove('cpc-hud-mq-pending');

        if (natH > 2 * lh + slackV && intr > cw + slackW) {
            host.classList.remove('csg-mq-slot--twoline', 'contestlive-hud-headline-slot--single');
            var built = buildIntermittentTrack(host, oneLine);
            if (!built && intr > cw + slackW) {
                host.innerHTML = '';
                host.style.setProperty('white-space', 'nowrap');
                host.style.setProperty('overflow', 'hidden');
                host.textContent = oneLine;
                built = buildIntermittentTrack(host, oneLine);
            }
            if (built) {
                host.setAttribute('data-cpc-mq-ready', '1');
                return 'inter';
            }
        }

        if (natH <= lh + slackV && intr <= cw + slackW) {
            renderCoachMemberInner(host, raw, 'single');
        } else {
            renderCoachMemberInner(host, raw, 'double');
        }
        host.setAttribute('data-cpc-mq-ready', '1');
        return natH > 2 * lh + slackV ? 'double' : intr <= cw + slackW ? 'single' : 'double';
    }

    function readCpcSlotPlainAttr(host) {
        if (!host) {
            return '';
        }
        var a = host.getAttribute('data-cpc-val-plain');
        if (a != null && String(a).trim() !== '') {
            return String(a).trim();
        }
        a = host.getAttribute('data-cpc-mq-plain');
        if (a != null && String(a).trim() !== '') {
            return String(a).trim();
        }
        return '';
    }

    function clearCpcContinuousMarquee(host) {
        if (!host) {
            return;
        }
        host.classList.remove('needs-marquee');
        host.style.removeProperty('--marquee-duration');
        host.style.removeProperty('--marquee-translate');
        var mw = host.querySelector('.marquee-wrapper');
        if (mw) {
            mw.remove();
        }
    }

    /**
     * CPC 队伍卡片队名等「单行槽」：仅当 nowrap 宽于容器时建间歇轨道（非连续 marquee-wrapper）。
     * @returns {'empty'|'fit'|'inter'|'pending'}
     */
    function applyCpcPlainLineIntermittentSlot(host, plain, options) {
        options = options || {};
        if (!host) {
            return 'empty';
        }
        var raw = plain != null ? String(plain).trim() : '';
        clearCpcContinuousMarquee(host);
        if (!raw) {
            host.innerHTML = '';
            host.removeAttribute('data-cpc-mq-plain');
            host.removeAttribute('data-csg-mq-inter');
            host.removeAttribute('data-csg-mq-raw');
            clearHudHeadlineMarqueePreflight(host);
            return 'empty';
        }
        host.setAttribute('data-cpc-mq-plain', raw);
        if (host.getAttribute('data-csg-mq-inter') === '1') {
            restoreIntermittentHost(host);
        }
        var cw = host.clientWidth || 0;
        if (cw <= 0) {
            host.textContent = raw;
            return 'pending';
        }
        var cs = window.getComputedStyle(host);
        var slackRatio =
            options.overflowSlackRatio != null && Number.isFinite(Number(options.overflowSlackRatio))
                ? Number(options.overflowSlackRatio)
                : 0.02;
        var slackW = Math.max(2, Math.round(cw * slackRatio));
        var intr = measureSegPlain(raw, cs);
        host.textContent = raw;
        clearHudHeadlineMarqueePreflight(host);
        host.removeAttribute('data-csg-mq-inter');
        host.removeAttribute('data-csg-mq-raw');
        if (intr <= cw + slackW) {
            return 'fit';
        }
        host.style.setProperty('white-space', 'nowrap');
        host.style.setProperty('overflow', 'hidden');
        var built = buildIntermittentTrack(host, raw);
        if (!built && intr > cw + slackW) {
            host.innerHTML = '';
            host.textContent = raw;
            built = buildIntermittentTrack(host, raw);
        }
        return built ? 'inter' : 'fit';
    }

    function intermittentTick(tNow) {
        intermittentState.rafId = null;
        var now =
            typeof tNow === 'number'
                ? tNow
                : typeof performance !== 'undefined' && performance.now
                  ? performance.now()
                  : Date.now();
        intermittentState.byRoot.forEach(function (state, root) {
            if (!root || !root.isConnected) {
                intermittentState.byRoot.delete(root);
                return;
            }
            var cycle = state.Tscroll + state.Tpause;
            if (cycle <= 0 || !state.items || !state.items.length) {
                return;
            }
            var elapsed = (now - state.anchor) % cycle;
            if (elapsed < 0) {
                elapsed += cycle;
            }
            var inScroll = elapsed < state.Tscroll;
            var p = inScroll && state.Tscroll > 0 ? elapsed / state.Tscroll : 0;
            var dMax = state.dMax > 0 ? state.dMax : 1;
            for (var i = 0; i < state.items.length; i++) {
                var it = state.items[i];
                var di = it.d;
                var tx = inScroll ? -Math.min(di, p * dMax) : 0;
                it.track.style.transform = 'translate3d(' + tx + 'px,0,0)';
            }
        });
        if (intermittentState.byRoot.size > 0) {
            intermittentState.rafId = requestAnimationFrame(intermittentTick);
        }
    }

    function ensureIntermittentRaf() {
        if (intermittentState.rafId != null) {
            return;
        }
        intermittentState.rafId = requestAnimationFrame(intermittentTick);
    }

    function wireIntermittentResizeOnce() {
        if (intermittentState.resizeWired) {
            return;
        }
        intermittentState.resizeWired = true;
        window.addEventListener(
            'resize',
            function () {
                if (intermittentState.resizeTimer) {
                    clearTimeout(intermittentState.resizeTimer);
                }
                intermittentState.resizeTimer = setTimeout(function () {
                    intermittentState.resizeTimer = null;
                    var pairs = Array.from(intermittentState.byRoot.entries());
                    for (var pi = 0; pi < pairs.length; pi++) {
                        var root = pairs[pi][0];
                        var st = pairs[pi][1];
                        if (!root || !root.isConnected || !st) {
                            continue;
                        }
                        if (st.options && typeof st.options.onHostsResize === 'function') {
                            st.options.onHostsResize();
                        } else {
                            syncIntermittentMarqueeGroup(root, st.selector, st.options);
                        }
                    }
                }, 160);
            },
            { passive: true }
        );
    }

    function stopIntermittentMarqueeGroup(root) {
        if (!root) {
            return;
        }
        var prev = intermittentState.byRoot.get(root);
        if (prev && prev.teardownHosts) {
            prev.teardownHosts();
        }
        intermittentState.byRoot.delete(root);
        if (intermittentState.byRoot.size === 0 && intermittentState.rafId != null) {
            cancelAnimationFrame(intermittentState.rafId);
            intermittentState.rafId = null;
        }
    }

    function collectInterItemFromHost(host) {
        if (!host || host.getAttribute('data-csg-mq-inter') !== '1') {
            return null;
        }
        var track = host.querySelector('.csg-mq-inter-track');
        var seg = track && track.querySelector('.csg-mq-inter-seg');
        var sep = track && track.querySelector('.csg-mq-inter-sep');
        if (!track || !seg || !sep) {
            return null;
        }
        var d = seg.offsetWidth + sep.offsetWidth;
        if (d < 1) {
            var plain =
                host.getAttribute('data-csg-mq-raw') ||
                mastheadPlainOneLine(readHeadlinePlainAttr(host) || seg.textContent || '');
            var cs = window.getComputedStyle(host);
            d =
                measureSegPlain(plain, cs) +
                measureSegPlain(sep.textContent != null ? sep.textContent : '', cs);
        }
        return { track: track, d: d };
    }

    /**
     * 顶栏等已建好 .csg-mq-inter-track 的槽：直接挂间歇时间轴，勿走 sync 双 rAF 拆轨（避免退化为持续跑马或静态夹断）。
     */
    function startIntermittentMarqueeGroupFromHosts(root, hosts, options) {
        options = options || {};
        if (!root || !hosts || !hosts.length) {
            return;
        }
        var speed =
            options.speedPxPerSec != null && Number.isFinite(Number(options.speedPxPerSec))
                ? Math.max(14, Number(options.speedPxPerSec))
                : 72;
        var pauseMs =
            options.pauseMs != null && Number.isFinite(Number(options.pauseMs))
                ? Math.max(500, Number(options.pauseMs))
                : 2600;
        var minScrollMs =
            options.minScrollMs != null && Number.isFinite(Number(options.minScrollMs))
                ? Math.max(900, Number(options.minScrollMs))
                : 1800;
        var maxScrollMs =
            options.maxScrollMs != null && Number.isFinite(Number(options.maxScrollMs))
                ? Math.max(minScrollMs, Number(options.maxScrollMs))
                : 36000;

        var items = [];
        var dMax = 0;
        for (var i = 0; i < hosts.length; i++) {
            var host = hosts[i];
            if (!host || !host.isConnected) {
                continue;
            }
            var it = collectInterItemFromHost(host);
            if (it) {
                dMax = Math.max(dMax, it.d);
                items.push(it);
            }
        }
        if (!items.length) {
            return;
        }
        var Tscroll = (dMax / speed) * 1000;
        if (Tscroll < minScrollMs) {
            Tscroll = minScrollMs;
        }
        if (Tscroll > maxScrollMs) {
            Tscroll = maxScrollMs;
        }
        var prev = intermittentState.byRoot.get(root);
        var preserveAnchor = false;
        if (prev && prev.items && prev.items.length === items.length) {
            preserveAnchor = true;
            for (var ki = 0; ki < items.length; ki++) {
                if (prev.items[ki].track !== items[ki].track) {
                    preserveAnchor = false;
                    break;
                }
            }
        }
        var state = {
            root: root,
            selector: '__hosts__',
            options: options,
            items: items,
            Tscroll: Tscroll,
            Tpause: pauseMs,
            dMax: dMax,
            anchor: preserveAnchor && prev ? prev.anchor : performance.now(),
            teardownHosts: function () {
                for (var j = 0; j < items.length; j++) {
                    var tr = items[j].track;
                    var h = tr && tr.closest ? tr.closest('[data-csg-mq-inter="1"]') : null;
                    if (h) {
                        restoreIntermittentHost(h);
                    }
                }
            }
        };
        intermittentState.byRoot.set(root, state);
        wireIntermittentResizeOnce();
        ensureIntermittentRaf();
    }

    function syncIntermittentMarqueeGroup(root, selector, options) {
        options = options || {};
        if (!root || typeof root.querySelectorAll !== 'function') {
            return;
        }
        var sel = selector || '.rl-name__primary';
        var speed =
            options.speedPxPerSec != null && Number.isFinite(Number(options.speedPxPerSec))
                ? Math.max(14, Number(options.speedPxPerSec))
                : 72;
        var pauseMs =
            options.pauseMs != null && Number.isFinite(Number(options.pauseMs))
                ? Math.max(500, Number(options.pauseMs))
                : 2600;
        var minScrollMs =
            options.minScrollMs != null && Number.isFinite(Number(options.minScrollMs))
                ? Math.max(900, Number(options.minScrollMs))
                : 1800;
        var maxScrollMs =
            options.maxScrollMs != null && Number.isFinite(Number(options.maxScrollMs))
                ? Math.max(minScrollMs, Number(options.maxScrollMs))
                : 36000;
        var slackRatio =
            options.overflowSlackRatio != null && Number.isFinite(Number(options.overflowSlackRatio))
                ? Number(options.overflowSlackRatio)
                : 0.02;

        var prev = intermittentState.byRoot.get(root);
        if (prev && prev.teardownHosts) {
            prev.teardownHosts();
        }
        intermittentState.byRoot.delete(root);
        if (intermittentState.rafId != null && intermittentState.byRoot.size === 0) {
            cancelAnimationFrame(intermittentState.rafId);
            intermittentState.rafId = null;
        }

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (!root.isConnected) {
                    if (options.hosts && options.hosts.length) {
                        for (var di = 0; di < options.hosts.length; di++) {
                            clearHudHeadlineMarqueePreflight(options.hosts[di]);
                        }
                    }
                    return;
                }
                var slots;
                if (options.hosts && options.hosts.length) {
                    sel = '__hosts__';
                    slots = [];
                    for (var hi = 0; hi < options.hosts.length; hi++) {
                        var he = options.hosts[hi];
                        if (he && he.nodeType === 1 && he.isConnected) {
                            slots.push(he);
                        }
                    }
                } else {
                    slots = Array.prototype.slice.call(root.querySelectorAll(sel));
                }
                var items = [];
                var dMax = 0;
                for (var i = 0; i < slots.length; i++) {
                    var host = slots[i];
                    if (!host || host.nodeType !== 1) {
                        continue;
                    }
                    var savedRaw = host.getAttribute('data-csg-mq-raw');
                    var plainAttr = readHeadlinePlainAttr(host);
                    var plainEarly =
                        plainAttr !== ''
                            ? plainAttr
                            : savedRaw != null && savedRaw !== ''
                              ? String(savedRaw)
                              : '';
                    if (
                        host.getAttribute('data-csg-mq-inter') === '1' &&
                        plainEarly &&
                        savedRaw === mastheadPlainOneLine(plainEarly)
                    ) {
                        var trackKeep = host.querySelector('.csg-mq-inter-track');
                        var segKeep = trackKeep && trackKeep.querySelector('.csg-mq-inter-seg');
                        var sepKeep = trackKeep && trackKeep.querySelector('.csg-mq-inter-sep');
                        if (trackKeep && segKeep && sepKeep) {
                            var dKeep = segKeep.offsetWidth + sepKeep.offsetWidth;
                            dMax = Math.max(dMax, dKeep);
                            items.push({ track: trackKeep, d: dKeep });
                            continue;
                        }
                    }
                    if (host.getAttribute('data-csg-mq-inter') === '1') {
                        restoreIntermittentHost(host);
                    }
                    var plain =
                        plainAttr !== ''
                            ? plainAttr
                            : savedRaw != null && savedRaw !== ''
                              ? String(savedRaw)
                              : '';
                    if (!plain) {
                        clearHudHeadlineMarqueePreflight(host);
                        host.removeAttribute('data-csg-mq-raw');
                        host.removeAttribute('data-csg-mq-inter');
                        continue;
                    }
                    host.textContent = plain;
                    var cs = window.getComputedStyle(host);
                    var cw = host.clientWidth;
                    if (cw <= 0) {
                        clearHudHeadlineMarqueePreflight(host);
                        continue;
                    }
                    var slack = Math.max(2, Math.round(cw * slackRatio));
                    var intr = measureSegPlain(plain, cs);
                    if (intr <= cw + slack) {
                        clearHudHeadlineMarqueePreflight(host);
                        host.removeAttribute('data-csg-mq-raw');
                        host.removeAttribute('data-csg-mq-inter');
                        if (
                            host.classList.contains('contestlive-hud-title-slot') ||
                            host.classList.contains('contestlive-hud-subtitle-slot')
                        ) {
                            applyCpcCoachMemberSlot(host, plain, { overflowSlackRatio: slackRatio });
                        } else {
                            renderCoachMemberInner(host, plain, 'double');
                        }
                        continue;
                    }
                    var built = buildIntermittentTrack(host, plain);
                    if (!built) {
                        if (
                            host.classList.contains('contestlive-hud-title-slot') ||
                            host.classList.contains('contestlive-hud-subtitle-slot')
                        ) {
                            applyCpcCoachMemberSlot(host, plain, { overflowSlackRatio: slackRatio });
                        } else {
                            renderCoachMemberInner(host, plain, 'double');
                        }
                        continue;
                    }
                    dMax = Math.max(dMax, built.d);
                    items.push({ track: built.track, d: built.d });
                }
                if (items.length === 0) {
                    for (var si = 0; si < slots.length; si++) {
                        clearHudHeadlineMarqueePreflight(slots[si]);
                    }
                    return;
                }
                var Tscroll = (dMax / speed) * 1000;
                if (Tscroll < minScrollMs) {
                    Tscroll = minScrollMs;
                }
                if (Tscroll > maxScrollMs) {
                    Tscroll = maxScrollMs;
                }
                var state = {
                    root: root,
                    selector: sel,
                    options: options,
                    items: items,
                    Tscroll: Tscroll,
                    Tpause: pauseMs,
                    dMax: dMax,
                    anchor: performance.now(),
                    teardownHosts: function () {
                        for (var j = 0; j < items.length; j++) {
                            var tr = items[j].track;
                            var h = tr && tr.closest ? tr.closest('[data-csg-mq-inter="1"]') : null;
                            if (h) {
                                restoreIntermittentHost(h);
                            }
                        }
                    }
                };
                intermittentState.byRoot.set(root, state);
                wireIntermittentResizeOnce();
                ensureIntermittentRaf();
            });
        });
    }

    global.CsgMarqueePlain = {
        measureSegPlain: measureSegPlain,
        enableMarqueeIfNeeded: enableMarqueeIfNeeded,
        applyTwoLineClampOrMarquee: applyTwoLineClampOrMarquee,
        applyHudMastheadHeadlines: applyHudMastheadHeadlines,
        applyMastheadHeadlineSlot: applyMastheadHeadlineSlot,
        startIntermittentMarqueeGroupFromHosts: startIntermittentMarqueeGroupFromHosts,
        applyHudMqLineIntermittentGroup: applyHudMqLineIntermittentGroup,
        applyCpcCoachMemberSlot: applyCpcCoachMemberSlot,
        applyCpcPlainLineIntermittentSlot: applyCpcPlainLineIntermittentSlot,
        syncIntermittentMarqueeGroup: syncIntermittentMarqueeGroup,
        stopIntermittentMarqueeGroup: stopIntermittentMarqueeGroup
    };
})(typeof window !== 'undefined' ? window : this);
