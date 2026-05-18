/**
 * CPC 队伍卡片：校徽（`rank_tool` 共享 IDB + 视口懒加载）；国旗与 rank 同源（region_mapping + 文件名），渲染在校名行左侧。
 * 队名 / 英文名 / 校名：`applyCpcPlainLineIntermittentSlot`（间歇跑马，同卡 header 共一条 rAF 时间轴）。
 * 教练 / 选手值：`applyCpcCoachMemberSlot`（≤2 行静态；>2 行且单行宽于槽 → 间歇跑马）。文案只读 `data-cpc-val-plain`，不用 `textContent` 聚合。
 */
(function (global) {
    'use strict';

    function cfgSchoolBadgeBase() {
        var c = global.CPC_TEAM_CARD_CONFIG || {};
        return (c.school_badge_url && String(c.school_badge_url).replace(/\/+$/, '')) || '/static/image/school_badge';
    }

    function cfgFlagBase() {
        var c = global.CPC_TEAM_CARD_CONFIG || {};
        return (c.region_flag_url && String(c.region_flag_url).replace(/\/+$/, '')) || '/static/image/region_flag';
    }

    async function cpcApplySchoolLogoDisplay(el, fileKey, dataUrl) {
        var pack =
            typeof global.RankToolLoadSchoolBadgeProcessedPack === 'function'
                ? await global.RankToolLoadSchoolBadgeProcessedPack(fileKey, dataUrl)
                : { measured: { W: 0, H: 0, R: null }, displayUrl: dataUrl };
        var displayUrl = pack.displayUrl || dataUrl;
        el.style.setProperty('--rank-school-logo-bg', 'url(' + JSON.stringify(displayUrl) + ')');
        el.classList.add('has-background');
        var m = pack.measured || {};
        if (
            m.R != null &&
            m.R > 0 &&
            typeof global.RankToolApplySchoolBadgeBackgroundFit === 'function'
        ) {
            global.RankToolApplySchoolBadgeBackgroundFit(el, m.W, m.H, m.R, '--cpc-card-badge-bg-size');
        } else if (typeof global.RankToolDisconnectSchoolBadgeResizeObserver === 'function') {
            global.RankToolDisconnectSchoolBadgeResizeObserver(el, '--cpc-card-badge-bg-size');
        }
    }

    async function applySchoolLogo(el) {
        if (!el || typeof global.RankToolFetchSchoolLogoDataUrl !== 'function') return;
        var school = el.getAttribute('data-school');
        if (!school || !String(school).trim()) return;

        var schoolId = String(school);
        var base = cfgSchoolBadgeBase();
        var fileKey = base + '/' + encodeURIComponent(schoolId);

        if (typeof global.RankToolDisconnectSchoolBadgeResizeObserver === 'function') {
            global.RankToolDisconnectSchoolBadgeResizeObserver(el, '--cpc-card-badge-bg-size');
        }

        try {
            var dataUrl;
            var dispFileKey = fileKey;
            if (
                typeof global.RankToolSchoolLogoResolveDataUrlWithIdb === 'function' &&
                typeof global.RankToolGetSharedSchoolLogoIndexedDb === 'function'
            ) {
                var idb = await global.RankToolGetSharedSchoolLogoIndexedDb();
                if (idb) {
                    var resolved = await global.RankToolSchoolLogoResolveDataUrlWithIdb(
                        { get: function (k) { return idb.get(k); }, set: function (k, v, e) { return idb.set(k, v, e); } },
                        base,
                        schoolId,
                        function (fk) {
                            return global.RankToolFetchSchoolLogoDataUrl(fk, base);
                        }
                    );
                    dataUrl = resolved.dataUrl;
                    dispFileKey = resolved.fileKey || fileKey;
                }
            }
            if (!dataUrl) {
                dataUrl = await global.RankToolFetchSchoolLogoDataUrl(fileKey, base);
            }
            await cpcApplySchoolLogoDisplay(el, dispFileKey, dataUrl);
        } catch (e) {
            el.classList.remove('has-background');
            el.style.removeProperty('--rank-school-logo-bg');
            if (typeof global.RankToolDisconnectSchoolBadgeResizeObserver === 'function') {
                global.RankToolDisconnectSchoolBadgeResizeObserver(el, '--cpc-card-badge-bg-size');
            }
        }
        if (typeof CpcTeamCardsScheduleMarquees === 'function') {
            CpcTeamCardsScheduleMarquees(null);
        }
    }

    async function cpcLoadFlagMappingOnce(flagBaseUrl) {
        if (global.__cpcTeamCardFlagMapping instanceof Map) {
            return global.__cpcTeamCardFlagMapping;
        }
        if (global.__cpcTeamCardFlagMappingPromise) {
            return global.__cpcTeamCardFlagMappingPromise;
        }
        var base = String(flagBaseUrl || '').replace(/\/+$/, '');
        global.__cpcTeamCardFlagMappingPromise = (async function () {
            var mapping = new Map();
            try {
                var mappingUrl = base + '/region_mapping.json';
                var response = await fetch(mappingUrl);
                if (!response.ok) throw new Error('flag mapping http');
                var data = await response.json();
                if (Array.isArray(data)) {
                    data.forEach(function (region) {
                        if (!region || typeof region !== 'object') return;
                        if (region['中文名']) mapping.set(region['中文名'], region['文件名']);
                        if (region['中文简称']) mapping.set(region['中文简称'], region['文件名']);
                        if (region['英文名']) mapping.set(region['英文名'], region['文件名']);
                        if (region['英文简称']) mapping.set(region['英文简称'], region['文件名']);
                        if (region['英文缩写']) mapping.set(region['英文缩写'], region['文件名']);
                    });
                }
            } catch (e) {
                /* 与 rank 一致：失败则退回仅按文件名尝试 */
            }
            global.__cpcTeamCardFlagMapping = mapping;
            global.__cpcTeamCardFlagMappingPromise = null;
            return mapping;
        })();
        return global.__cpcTeamCardFlagMappingPromise;
    }

    async function cpcResolveFlagImageUrl(region, flagBaseUrl) {
        var trimmed = region != null ? String(region).trim() : '';
        if (!trimmed) return null;
        var base = String(flagBaseUrl || '').replace(/\/+$/, '');
        var mapping = await cpcLoadFlagMappingOnce(base);
        if (mapping.has(trimmed)) {
            return base + '/' + mapping.get(trimmed);
        }
        return base + '/' + encodeURIComponent(trimmed) + '.png';
    }

    function cpcCollapseSchoolFlagSlot(img) {
        var slot = img && img.closest && img.closest('.cpc-team-card__school-flag-slot');
        if (slot) {
            slot.classList.add('cpc-team-card__school-flag-slot--empty');
        }
    }

    function applyOneFlag(img) {
        if (!img || img.tagName !== 'IMG') return;
        var code = img.getAttribute('data-flag');
        if (!code || !String(code).trim()) {
            cpcCollapseSchoolFlagSlot(img);
            return;
        }
        cpcResolveFlagImageUrl(code, cfgFlagBase())
            .then(function (url) {
                if (!url) {
                    img.style.opacity = '0';
                    cpcCollapseSchoolFlagSlot(img);
                    return;
                }
                img.onload = function () {
                    img.style.opacity = '1';
                };
                img.onerror = function () {
                    img.style.opacity = '0';
                    img.removeAttribute('src');
                    cpcCollapseSchoolFlagSlot(img);
                };
                img.src = url;
            })
            .catch(function () {
                img.style.opacity = '0';
                cpcCollapseSchoolFlagSlot(img);
            });
    }

    function cpcEnsureSchoolLogoIntersectionObserver() {
        if (global.__cpcTeamCardsSchoolLogoIo) {
            return global.__cpcTeamCardsSchoolLogoIo;
        }
        if (typeof global.RankToolCreateLazyIntersectObserver !== 'function') {
            return null;
        }
        var io = global.RankToolCreateLazyIntersectObserver(function (el) {
            applySchoolLogo(el).catch(function () {});
        }, { rootMargin: '50px' });
        global.__cpcTeamCardsSchoolLogoIo = io;
        return io;
    }

    function CpcTeamCardsInitSchoolLogos(root) {
        var scope = root || document;
        var logos = scope.querySelectorAll('.cpc-team-card__logo.school-logo[data-school]');
        var obs = cpcEnsureSchoolLogoIntersectionObserver();
        if (!obs) {
            logos.forEach(function (el) {
                applySchoolLogo(el).catch(function () {});
            });
            return;
        }
        logos.forEach(function (el) {
            if (el.dataset.cpcSchoolLogoIo === '1') {
                return;
            }
            el.dataset.cpcSchoolLogoIo = '1';
            obs.observe(el);
        });
    }

    function CpcTeamCardsInitFlags(root) {
        var scope = root || document;
        var imgs = scope.querySelectorAll('.cpc-team-card img.flag-icon[data-flag]');
        imgs.forEach(function (img) {
            applyOneFlag(img);
        });
    }

    function cpcTeamCardsMqPlain(el) {
        if (!el) {
            return '';
        }
        if (el.getAttribute('data-csg-mq-inter') === '1') {
            var mr = el.getAttribute('data-csg-mq-raw');
            if (mr != null && String(mr).trim() !== '') {
                var canonMq = String(mr).trim();
                el.setAttribute('data-cpc-mq-plain', canonMq);
                return canonMq;
            }
        }
        var a = el.getAttribute('data-cpc-mq-plain');
        if (a != null && String(a).trim() !== '') {
            return String(a).trim();
        }
        var t = (el.textContent || '').trim();
        if (t) {
            el.setAttribute('data-cpc-mq-plain', t);
        }
        return t;
    }

    function CpcTeamCardsRefreshArticleHeaderMq(article) {
        if (!article || !article.isConnected) {
            return;
        }
        var M = global.CsgMarqueePlain;
        if (!M || typeof M.applyCpcPlainLineIntermittentSlot !== 'function') {
            return;
        }
        var headerMain = article.querySelector('.cpc-team-card__header-main');
        if (!headerMain) {
            return;
        }
        if (typeof M.stopIntermittentMarqueeGroup === 'function') {
            M.stopIntermittentMarqueeGroup(headerMain);
        }
        var interHosts = [];
        var pending = false;
        headerMain.querySelectorAll('.cpc-team-card__mq').forEach(function (el) {
            var plain = cpcTeamCardsMqPlain(el);
            if (!plain) {
                return;
            }
            var mode = M.applyCpcPlainLineIntermittentSlot(el, plain, { overflowSlackRatio: 0.02 });
            if (mode === 'inter') {
                interHosts.push(el);
            } else if (mode === 'pending') {
                pending = true;
            }
        });
        if (pending) {
            requestAnimationFrame(function () {
                CpcTeamCardsRefreshArticleHeaderMq(article);
            });
            return;
        }
        if (interHosts.length && typeof M.syncIntermittentMarqueeGroup === 'function') {
            M.syncIntermittentMarqueeGroup(headerMain, '__hosts__', {
                hosts: interHosts,
                overflowSlackRatio: 0.02
            });
        }
    }

    function CpcTeamCardsApplyMarquees(root) {
        var scope = root || document;
        scope.querySelectorAll('.cpc-team-card').forEach(function (article) {
            CpcTeamCardsRefreshArticleHeaderMq(article);
        });
    }

    function cpcTeamCardsHudSlotPlain(el) {
        if (!el) {
            return '';
        }
        var a = el.getAttribute('data-cpc-val-plain');
        return a != null ? String(a).trim() : '';
    }

    function CpcTeamCardsRefreshArticleHudSlots(article) {
        if (!article || !article.isConnected) {
            return;
        }
        if (!global.CsgMarqueePlain || typeof global.CsgMarqueePlain.applyCpcCoachMemberSlot !== 'function') {
            return;
        }
        var body = article.querySelector('.cpc-team-card__body') || article;
        if (typeof global.CsgMarqueePlain.stopIntermittentMarqueeGroup === 'function') {
            global.CsgMarqueePlain.stopIntermittentMarqueeGroup(body);
        }
        var interHosts = [];
        var pending = [];
        article.querySelectorAll('.cpc-team-card__hud-mq-slot').forEach(function (el) {
            var raw = cpcTeamCardsHudSlotPlain(el);
            if (!raw) {
                return;
            }
            var mode = global.CsgMarqueePlain.applyCpcCoachMemberSlot(el, raw, { overflowSlackRatio: 0.02 });
            if (mode === 'inter') {
                interHosts.push(el);
            } else if (mode === 'pending') {
                pending.push(el);
            }
        });
        if (pending.length) {
            requestAnimationFrame(function () {
                CpcTeamCardsRefreshArticleHudSlots(article);
            });
            return;
        }
        if (interHosts.length && typeof global.CsgMarqueePlain.syncIntermittentMarqueeGroup === 'function') {
            global.CsgMarqueePlain.syncIntermittentMarqueeGroup(body, '__hosts__', {
                hosts: interHosts,
                overflowSlackRatio: 0.02
            });
        }
    }

    function CpcTeamCardsInitHudCoachMemberSlots(root) {
        var scope = root || document;
        scope.querySelectorAll('.cpc-team-card').forEach(function (article) {
            CpcTeamCardsRefreshArticleHudSlots(article);
        });
    }

    function CpcTeamCardsScheduleMarquees(root) {
        if (global.__cpcTeamCardsMqResizeTimer) {
            clearTimeout(global.__cpcTeamCardsMqResizeTimer);
        }
        global.__cpcTeamCardsMqResizeTimer = setTimeout(function () {
            global.__cpcTeamCardsMqResizeTimer = null;
            CpcTeamCardsInitHudCoachMemberSlots(root || document);
            CpcTeamCardsApplyMarquees(root || document);
        }, 160);
    }

    if (!global.__cpcTeamCardsMqResizeWired) {
        global.__cpcTeamCardsMqResizeWired = true;
        global.addEventListener(
            'resize',
            function () {
                CpcTeamCardsScheduleMarquees(null);
            },
            { passive: true }
        );
    }

    function CpcTeamCardsInit(root) {
        CpcTeamCardsInitSchoolLogos(root);
        CpcTeamCardsInitFlags(root);
        CpcTeamCardsInitHudCoachMemberSlots(root);
        requestAnimationFrame(function () {
            CpcTeamCardsApplyMarquees(root);
        });
    }

    global.CpcTeamCardsInitSchoolLogos = CpcTeamCardsInitSchoolLogos;
    global.CpcTeamCardsInitFlags = CpcTeamCardsInitFlags;
    global.CpcTeamCardsApplyMarquees = CpcTeamCardsApplyMarquees;
    global.CpcTeamCardsInitHudCoachMemberSlots = CpcTeamCardsInitHudCoachMemberSlots;
    global.CpcTeamCardsScheduleMarquees = CpcTeamCardsScheduleMarquees;
    global.CpcTeamCardsInit = CpcTeamCardsInit;
})(window);
