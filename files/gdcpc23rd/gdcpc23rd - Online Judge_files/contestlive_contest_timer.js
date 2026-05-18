/**
 * 比赛计时：赛前 / 赛中 / 赛后 三段各自的主数字逻辑，由多套「显示套装」描述。
 * 按 T 在套装间循环切换（任意时刻有效）；偏好按 cid 写入 localStorage。
 */
(function () {
    const w = window;
    const LEGACY_LINE = 'contestlive_timer_line_mode_';
    const LEGACY_MID = 'contestlive_mid_timer_mode_';
    const LEGACY_POST = 'contestlive_timer_post_end_since_';

    function resetTimerLayoutStoreForSid(sidRaw) {
        const sid = String(sidRaw || '').trim();
        if (!sid) {
            return;
        }
        try {
            w.localStorage.setItem('contestlive_timer_display_pack_' + sid, '0');
            w.localStorage.setItem('contestlive_timer_remain_step_' + sid, '0');
            w.localStorage.setItem('contestlive_timer_ui_title_' + sid, '0');
            w.localStorage.setItem('contestlive_timer_ui_state_' + sid, '0');
        } catch (e) {
            /* ignore */
        }
    }

    function resetTimerLayoutStoreForCid(rawCid) {
        const c = parseInt(String(rawCid || 0), 10) || 0;
        if (!c) {
            return;
        }
        resetTimerLayoutStoreForSid(String(c));
        try {
            w.localStorage.removeItem(LEGACY_LINE + c);
            w.localStorage.removeItem(LEGACY_MID + c);
            w.localStorage.removeItem(LEGACY_POST + c);
        } catch (e) {
            /* ignore */
        }
    }

    w.ContestliveTimerLayoutStoreResetForCid = resetTimerLayoutStoreForCid;
    w.ContestliveTimerLayoutStoreResetForStorageId = resetTimerLayoutStoreForSid;

    function pad2(x) {
        const n = String(x);
        return n.length >= 2 ? n : '0' + n;
    }

    function fmtWallFromMs(ms) {
        const d = new Date(ms);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }

    function fmtDur(ms) {
        if (ms < 0) {
            ms = 0;
        }
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return [h, m, sec].map(function (n) {
            return String(n).padStart(2, '0');
        }).join(':');
    }

    function fmtDurSigned(ms) {
        if (ms >= 0) {
            return fmtDur(ms);
        }
        return '-' + fmtDur(-ms);
    }

    const DISPLAY_PACKS = [
        {
            nameCn: '标准',
            nameEn: 'Standard',
            preMain: function (now, startMs) {
                return fmtDurSigned(now - startMs);
            },
            midMain: function (now, startMs, endMs) {
                return fmtDur(endMs - now);
            },
            postMain: function () {
                return '00:00:00';
            },
            preState: function () {
                return { cn: '距开赛', en: 'Until start' };
            },
            midState: function () {
                return { cn: '剩余时间', en: 'Time remaining' };
            },
            postState: function () {
                return { cn: '已结束', en: 'Ended' };
            },
        },
        {
            nameCn: '至整场计划结束',
            nameEn: 'To planned end',
            preMain: function (now, startMs, endMs) {
                return fmtDurSigned(endMs - now);
            },
            midMain: function (now, startMs, endMs) {
                return fmtDurSigned(endMs - now);
            },
            postMain: function (now, startMs, endMs) {
                return fmtDurSigned(endMs - now);
            },
            preState: function () {
                return { cn: '距整场计划结束', en: 'Until planned contest end' };
            },
            midState: function () {
                return { cn: '距整场计划结束', en: 'Until planned contest end' };
            },
            postState: function () {
                return { cn: '相对计划结束', en: 'Versus planned end' };
            },
        },
        {
            nameCn: '正计时',
            nameEn: 'Elapsed clock',
            preMain: function (now, startMs) {
                return fmtDur(startMs - now);
            },
            midMain: function (now, startMs) {
                return fmtDur(now - startMs);
            },
            postMain: function (now, startMs, endMs) {
                return fmtDur(now - endMs);
            },
            preState: function () {
                return { cn: '距开赛', en: 'Until start' };
            },
            midState: function () {
                return { cn: '赛时已过', en: 'Elapsed since start' };
            },
            postState: function () {
                return { cn: '赛后已过', en: 'Since contest ended' };
            },
        },
        {
            nameCn: '相对开赛',
            nameEn: 'From contest start',
            preMain: function (now, startMs) {
                return fmtDurSigned(now - startMs);
            },
            midMain: function (now, startMs) {
                return fmtDurSigned(now - startMs);
            },
            postMain: function (now, startMs, endMs) {
                return fmtDurSigned(now - endMs);
            },
            preState: function () {
                return { cn: '距开赛', en: 'Until start' };
            },
            midState: function () {
                return { cn: '自开赛起', en: 'Since contest start' };
            },
            postState: function () {
                return { cn: '自整场结束', en: 'Since contest ended' };
            },
        },
    ];

    /** 榜单等 UI 展示「套装」名称用；顺序与 DISPLAY_PACKS 一致 */
    w.ContestliveContestTimerDisplayPackUiList = DISPLAY_PACKS.map(function (p) {
        return { nameCn: p.nameCn, nameEn: p.nameEn };
    });

    function showPackToast(nameCn, nameEn, anchorEl) {
        if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') {
            return;
        }
        try {
            document.querySelectorAll('.contestlive-timer-pack-toast').forEach(function (n) {
                n.remove();
            });
        } catch (eRm) {
            /* ignore */
        }
        const el = document.createElement('div');
        el.className = 'contestlive-timer-pack-toast';
        el.setAttribute('role', 'status');
        const cn = document.createElement('span');
        cn.className = 'contestlive-timer-pack-toast__cn';
        cn.textContent = nameCn;
        const sep = document.createElement('span');
        sep.className = 'contestlive-timer-pack-toast__sep';
        sep.textContent = ' · ';
        const en = document.createElement('span');
        en.className = 'contestlive-timer-pack-toast__en';
        en.textContent = nameEn;
        el.appendChild(cn);
        el.appendChild(sep);
        el.appendChild(en);
        document.body.appendChild(el);
        const r = anchorEl.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const top = r.bottom + Math.max(6, r.height * 0.04);
        el.style.left = cx + 'px';
        el.style.top = top + 'px';
        el.style.transform = 'translate(-50%, 0)';
        window.setTimeout(function () {
            el.classList.add('contestlive-timer-pack-toast--out');
            function onEnd(ev) {
                if (ev.propertyName !== 'opacity') {
                    return;
                }
                el.removeEventListener('transitionend', onEnd);
                try {
                    el.remove();
                } catch (e2) {
                    /* ignore */
                }
            }
            el.addEventListener('transitionend', onEnd);
            window.setTimeout(function () {
                try {
                    if (el.parentNode) {
                        el.remove();
                    }
                } catch (e3) {
                    /* ignore */
                }
            }, 800);
        }, 500);
    }

    w.ContestliveContestTimerShowPackToast = showPackToast;

    /**
     * @param {object} opts
     * @param {number} opts.cid  计时套装 legacy 迁移等仍按需依赖数值 cid（外榜等非数字 sid 时请传 0）
     * @param {number} opts.start_ms
     * @param {number} opts.end_ms
     * @param {number} [opts.now_ms]
     * @param {string} [opts.storage_id]  localStorage 键后缀；不传则等价于 String(cid)
     * @param {function (): number} [opts.get_now_ms]  若提供则每 tick 用语义时间（如榜单页的 GetActualCurrentTime）
     * @param {boolean} [opts.keyboard_t_cycle_pack]  若为 false，不监听 **T** 循环套装（由宿主页自行绑键）
     * @param {HTMLElement|null} opts.remain_el
     * @param {HTMLElement|null} opts.state_el
     * @param {HTMLElement|null} [opts.wall_el]
     * @returns {{ dispose: function, tick: function }|undefined}
     */
    function init(opts) {
        const startMs = Number(opts.start_ms) || 0;
        const endMs = Number(opts.end_ms) || 0;
        const anchorNow = opts.now_ms != null ? Number(opts.now_ms) : Date.now();
        const loadedAt = Date.now();
        const cid = parseInt(String(opts.cid || 0), 10) || 0;
        const sidOpt = opts.storage_id != null ? String(opts.storage_id).trim() : '';
        const sid = sidOpt !== '' ? sidOpt : String(cid);
        const useLegacyMigrate = sidOpt === '' && cid > 0;
        const storageKeyPack = 'contestlive_timer_display_pack_' + sid;
        const remainEl = opts.remain_el;
        const stateEl = opts.state_el;
        const wallEl = opts.wall_el;
        const getNowMsOpt = typeof opts.get_now_ms === 'function' ? opts.get_now_ms : null;
        const keyboardTCyclePack = opts.keyboard_t_cycle_pack !== false;

        function approxNowMs() {
            if (getNowMsOpt) {
                try {
                    const n = Number(getNowMsOpt());
                    if (!isNaN(n)) {
                        return n;
                    }
                } catch (eNow) {
                    /* ignore */
                }
            }
            return anchorNow + (Date.now() - loadedAt);
        }

        function readPackIndex() {
            try {
                const v = w.localStorage.getItem(storageKeyPack);
                if (v != null && v !== '') {
                    const n = parseInt(String(v), 10);
                    if (!isNaN(n)) {
                        return Math.max(0, Math.min(DISPLAY_PACKS.length - 1, n));
                    }
                }
                if (useLegacyMigrate) {
                    const line = w.localStorage.getItem(LEGACY_LINE + cid);
                    const migrated = line === 'to_end' ? 1 : 0;
                    w.localStorage.setItem(storageKeyPack, String(migrated));
                    return migrated;
                }
                w.localStorage.setItem(storageKeyPack, '0');
                return 0;
            } catch (e) {
                return 0;
            }
        }

        function writePackIndex(i) {
            const j = Math.max(0, Math.min(DISPLAY_PACKS.length - 1, parseInt(String(i), 10) || 0));
            try {
                w.localStorage.setItem(storageKeyPack, String(j));
            } catch (e) {
                /* ignore */
            }
            return j;
        }

        function isTypingTarget(el) {
            if (!el || !el.tagName) {
                return false;
            }
            const t = el.tagName;
            if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') {
                return true;
            }
            return !!el.isContentEditable;
        }

        function tick() {
            const now = approxNowMs();
            if (wallEl) {
                wallEl.textContent = fmtWallFromMs(now);
            }
            const packIdx = readPackIndex();
            const pack = DISPLAY_PACKS[packIdx] || DISPLAY_PACKS[0];
            let main = '';
            let st = { cn: '', en: '' };

            if (now < startMs) {
                main = pack.preMain(now, startMs, endMs);
                st = pack.preState(now, startMs, endMs);
            } else if (now <= endMs) {
                main = pack.midMain(now, startMs, endMs);
                st = pack.midState(now, startMs, endMs);
            } else {
                main = pack.postMain(now, startMs, endMs);
                st = pack.postState(now, startMs, endMs);
            }

            if (remainEl) {
                remainEl.textContent = main;
            }
            if (stateEl) {
                stateEl.innerHTML =
                    '<span class="bilingual-inline contestlive-contest-timer-state__bi">' +
                    '<span class="cn-text">' +
                    st.cn +
                    '</span><span class="en-text">' +
                    st.en +
                    '</span></span>';
            }
        }

        tick();
        let disposed = false;
        const intervalId = w.setInterval(function () {
            if (!disposed) {
                tick();
            }
        }, 1000);

        function onStorageChanged() {
            if (!disposed) {
                tick();
            }
        }
        document.addEventListener('contestlive-timer-storage-changed', onStorageChanged);

        const scBoot = w.document.getElementById('contestlive-skin-boot');
        const pageForBracket =
            (typeof w.CONTEST_LIVE_PAGE === 'string' && w.CONTEST_LIVE_PAGE) ||
            (scBoot && scBoot.getAttribute('data-contestlive-page')) ||
            '';
        if (pageForBracket === 'live_rank') {
            w.ContestlivePageLayoutResetters = w.ContestlivePageLayoutResetters || {};
            w.ContestlivePageLayoutResetters.live_rank = function () {
                resetTimerLayoutStoreForCid(cid);
                tick();
            };
        }

        function onKeyT(ev) {
            if (disposed || !ev || ev.ctrlKey || ev.metaKey || ev.altKey) {
                return;
            }
            if (isTypingTarget(ev.target)) {
                return;
            }
            if (!remainEl) {
                return;
            }
            const k = ev.key;
            if (k !== 't' && k !== 'T') {
                return;
            }
            const cur = readPackIndex();
            const next = writePackIndex(cur + 1 >= DISPLAY_PACKS.length ? 0 : cur + 1);
            const p = DISPLAY_PACKS[next] || DISPLAY_PACKS[0];
            showPackToast(p.nameCn, p.nameEn, remainEl);
            ev.preventDefault();
            tick();
        }
        if (keyboardTCyclePack) {
            document.addEventListener('keydown', onKeyT, false);
        }

        function dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            w.clearInterval(intervalId);
            document.removeEventListener('contestlive-timer-storage-changed', onStorageChanged);
            if (keyboardTCyclePack) {
                document.removeEventListener('keydown', onKeyT, false);
            }
        }

        return { dispose: dispose, tick: tick };
    }

    w.ContestliveContestTimer = {
        init: init,
        refresh: function () {
            try {
                document.dispatchEvent(new Event('contestlive-timer-storage-changed'));
            } catch (e) {
                /* ignore */
            }
        },
    };
})();
