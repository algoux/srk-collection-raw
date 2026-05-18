/**
 * 统一榜单系统
 * 整合队伍排名、 学校排名、滚榜功能
 *
 * ── 首屏耗时调试（与 rank_roll 的 URL 调试思路一致）──
 *   · URL：`?rankdbg=1` 启用（与比赛 cid 等其它参数可并存，如 `.../rank?cid=1&rankdbg=1`）
 *   · 或 `localStorage.setItem('rank_perf_debug','1')` 后刷新（持久）
 *   · 控制台可改：`window.RankPagePerfDebug = { enabled: true }`
 *   日志前缀 `[RankPerf]`，含累计 ms（自本轮 LoadData 起）与距上一日志的 Δms。
 *   `ProcessData` / `CalculateRank` 结束各有一条聚合：`ProcessData:timing_ms`、`CalculateRank:timing_ms`（分段毫秒 + 数据规模），便于强缓存下仍一眼看出瓶颈段。
 *   数据处理：`solution` 按 `in_date` 排序前对每行调用一次 `_rankWireInstantMs` 物化 `_rankOrderMs`（与 wire 契约一致，排序后即删）；`CalculateRank` 内比赛开始时刻只解析一次。勿改用裸字符串排序替代 wire，以免破坏 naive/偏移混排与时区语义。
 *   关闭：`?rankdbg=0` 不会自动关；需去掉参数并清 localStorage 或 `enabled:false`。
 *
 * 依赖：需要先加载 rank_tool.js（工具函数库）
 *
 * 使用示例：
 * RankSystemInit('my-container', {
 *     key: 'contest_123',
 *     cid_list: '123,456',
 *     api_url: '/csgoj/contest/contest_data_ajax',
 *     team_photo_url: '/upload/contest_attach/abc/team_photo',
 *     school_badge_url: '/static/image/school_badge',
 *     rank_mode: 'roll'
 * });
 */

// 顶层声明须可重入：rank.js 在登录态可能被两处模板重复 include
// （contest_header → team_info_panel 的 js_rank + rank.php 自身的 js_rank），
// 与下方 RankSystem 类同款的 `typeof X === 'undefined'` guard，并用 var 让块外仍可见。
if (typeof RANK_SKIN_VALUES === 'undefined') {
    /** 榜单配色方案（与 data-rank-skin、各 rank_skin_*.css 一致） */
    var RANK_SKIN_VALUES = Object.freeze(['default', 'dark_stage', 'light_macaron']);
    /** 换肤遮罩在 ApplyRankSkin 之后继续保留的 paint 帧数（大表仅改 data-rank-skin 时常跨多帧重绘） */
    var RANK_SKIN_BUSY_POST_PAINT_FRAMES = 8;
}
function RankSkinNormalize(s) {
    return RANK_SKIN_VALUES.includes(s) ? s : 'default';
}

/** 榜单页性能调试：URL `rankdbg=1` / localStorage `rank_perf_debug=1`（见文件头注释） */
(function rankPagePerfDebugFromUrl() {
    if (typeof window === 'undefined') return;
    let urlOn = false;
    try {
        const p = new URLSearchParams(window.location.search || '');
        urlOn = p.get('rankdbg') === '1';
    } catch (_) { /* 旧浏览器 */ }
    let lsOn = false;
    try {
        lsOn = window.localStorage && localStorage.getItem('rank_perf_debug') === '1';
    } catch (_) { /* 禁用 storage */ }
    const fromUrlOrLs = !!(urlOn || lsOn);
    const prev = window.RankPagePerfDebug && window.RankPagePerfDebug.enabled;
    window.RankPagePerfDebug = { enabled: !!(fromUrlOrLs || prev) };
})();

// #########################################
//  RankSystem 主类
// #########################################
if(typeof RankSystem == 'undefined') {
    class RankSystem {
        constructor(containerId, config = {}) {
            this.containerId = containerId;
            // 配置优先级：实例化参数 > window.RANK_CONFIG
            const globalConfig = window.RANK_CONFIG || {};
            this.config = RankToolMergeConfig(globalConfig, config);
            // 默认配置
            const defaultConfig = {
                flg_show_page_contest_title: true,       // 正常模式时是否显示比赛标题
                flg_show_fullscreen_contest_title: true, // 全屏模式时是否显示比赛标题
                flg_rank_cache: true,                    // 是否启用榜单数据缓存
                flg_show_time_progress: true,            // 是否显示时间进度条（默认显示）
                flg_show_controls_toolbar: true,         // 是否显示按钮功能区（默认显示）
                flg_show_team_id: false,                // 是否在校名前显示team_id（默认false）
                flg_award_lintel: true                   // 多归属且筛选多于一个时是否显示行顶奖区楣条
            };
            this.config = RankToolMergeConfig(defaultConfig, this.config);
            this.flgAwardLintelEnabled = this.config.flg_award_lintel !== false;

            this.key = this.config.key || `rank_${Date.now()}`; // 缓存键，用于localStorage等
            this.data = null;
            /** @type {object} contest_data_ajax / rank_data 的 time_context，缺省 {} 走应用时区 */
            this._rankTimeContext = {};
            this.currentMode = this.GetInitialMode(); // 从URL anchor参数读取初始模式
            this.starMode = 0; // 0: 打星不排名, 1: 不含打星, 2: 打星参与排名
            this.selectedGroupIds = []; // 当前筛选分组（运行期会保证至少1个）
            this.filterSchools = new Set();
            this.filterTeams = new Set();
            this.rankSkin = 'default'; // default | dark_stage | light_macaron
            this.isFullscreen = false;
            this.autoRefresh = false;
            // 自动滚动：0=停用，1=缓慢，2=半页，3=单行；B 键只负责开/关，数字 1～3 选模式（全屏且计时层关闭时）
            this.autoScrollMode = 0;
            this.lastAutoScrollMode = 1;    // B 键再次打开时使用的模式
            this.showTimeOverlay = false;
            /** @type {{ dispose: function, tick?: function }|null} */
            this._rankTimerDispose = null;
            this.refreshInterval = null; // 自动刷新定时器
            this.autoScrollInterval = null; // 缓慢滚动定时器
            this.autoScrollHalfPageInterval = null; // 半页滚动周期定时器
            this.autoScrollHalfPageAnimationId = null; // 半页滚动动画 raf id，用于取消
            this.autoScrollSingleRowInterval = null; // 单行滚动定时器（或下一轮 setTimeout id）
            this.autoScrollSingleRowAnimationId = null; // 单行滚动动画 raf id，用于取消
            this.autoScrollSingleRowTimeout = null; // 单行滚动下一轮 setTimeout id
            // 动画基础持续时间（毫秒）
            this.baseAnimationDuration = 1000; // 基础动画持续时间，用于排序动画
            this.minAnimationDuration = 300; // 最小动画持续时间
            this.maxAnimationDuration = 2000; // 最大动画持续时间
            // 时间回放功能
            this.timeReplayMode = false;
            this.replayTime = null; // 回放时间点
            this.contestStartTime = null;
            // 加载状态标志
            this.isInitialLoad = true; // 是否为初始加载
            this.contestEndTime = null;
            // 后端时间差（毫秒）
            this.backendTimeDiff = this.config.backend_time_diff || 0;
            // 时间进度条自动更新定时器
            this.timeProgressInterval = null;
            // Tooltip配置系统
            this.tooltipTemplates = {
                'coach': {
                    cn: '教练：{name}',
                    en: 'Coach: {name}'
                },
                'player': {
                    cn: '选手：{name}',
                    en: 'Player: {name}'
                }
            };
            // 专用tooltip处理函数注册表
            this.specialTooltipHandlers = {
                'problem-item': this.GenerateProblemItemTooltip.bind(this)
            };
            // 数据映射
            this.teamMap = {};
            this.solutionMap = {};
            this.problemMap = {};
            this.rankList = [];
            this.schoolMap = {};
            this.map_fb = { global: {}, regular: {} }; // 一血记录
            // DOM元素
            this.elements = {};
            this.container = null;
            /** 串行化榜单 DOM 更新，避免异步分帧 RenderRank 未完成时再次 UpdateRank 误判走增量路径而重复追加行 */
            this._rankRenderChain = Promise.resolve();
            // 旗帜映射缓存
            this._flagMapping = null;
            this._flagMappingPromise = null;
            // HTML配置
            this.htmlConfigs = {
                headerControls: {
                    starModeOptions: [
                        { value: '0', label: '打星不排名', label_en: 'Star No Rank', icon: RankToolGenerateIcon('star-half', '打星不排名', 'Star No Rank') },
                        { value: '1', label: '不含打星', label_en: 'Exclude Star', icon: RankToolGenerateIcon('moon-stars-fill', '不含打星', 'Exclude Star') },
                        { value: '2', label: '打星参与排名', label_en: 'Star Participate', icon: RankToolGenerateIcon('star-fill', '打星参与排名', 'Star Participate') }
                    ],
                    rankModeOptions: [
                        { value: 'team', label: '队伍排名', label_en: 'Team Rank' },
                        { value: 'school', label: '学校/组织 排名', label_en: 'Organization Rank' }
                    ],
                    rankSkinOptions: [
                        { value: 'default', label: '默认主题', label_en: 'Default theme', icon_key: 'palette' },
                        { value: 'dark_stage', label: '深色主题', label_en: 'Dark theme', icon_key: 'palette' },
                        { value: 'light_macaron', label: '浅色主题', label_en: 'Light theme', icon_key: 'palette' }
                    ],
                    buttons: [
                        { id: 'refresh-btn', icon: RankToolGenerateIconOnly('refresh'), label: '刷新', label_en: 'Refresh', class: 'refresh-btn' },
                        { id: 'summary-btn', icon: RankToolGenerateIconOnly('info'), label: '统计', label_en: 'Summary', class: 'summary-btn' },
                        { id: 'filter-btn', icon: RankToolGenerateIconOnly('filter'), label: '筛选', label_en: 'Filter', class: 'filter-btn' },
                        { id: 'help-btn', icon: RankToolGenerateIconOnly('question-circle'), label: '帮助', label_en: 'Help', class: 'help-btn' },
                        { id: 'fullscreen-btn', icon: RankToolGenerateIconOnly('fullscreen'), label: '全屏', label_en: 'Fullscreen', class: 'fullscreen-btn' }
                    ]
                }
            };
            this.Init();
        }
        // 图标系统（已迁移到 rank_tool.js，使用 RankTool 函数）
        // 从配置或URL anchor参数获取初始模式
        GetInitialMode() {
            const validModes = ['team', 'school', 'roll']; // 支持 roll 模式，用于专门的滚榜页面
            // 如果配置中提供了rank_mode，优先使用
            if (this.config.rank_mode && validModes.includes(this.config.rank_mode)) {
                return this.config.rank_mode;
            }
            // 否则从URL anchor参数读取
            const hash = window.location.hash;
            const params = new URLSearchParams(hash.substring(1));
            const mode = params.get('rank_mode');
            if (validModes.includes(mode)) {
                return mode;
            }
            // // 尝试从localStorage获取上次的模式
            // const savedMode = localStorage.getItem(`${this.key}_mode`);
            // if (validModes.includes(savedMode)) {
            //     return savedMode;
            // }
            return 'team'; // 默认模式
        }
        // 更新URL anchor参数
        UpdateAnchor(mode) {
            // 如果配置中提供了rank_mode，则不更新URL anchor
            if (this.config.rank_mode) {
                // 只保存到IndexedDB
                this.cache.set(`${this.key}_mode`, mode, 24 * 60 * 60 * 1000); // 24小时过期
                return;
            }
            const hash = window.location.hash;
            const params = new URLSearchParams(hash.substring(1));
            params.set('rank_mode', mode);
            // 更新URL但不触发页面跳转
            const newHash = '#' + params.toString();
            if (window.location.hash !== newHash) {
                window.history.replaceState(null, null, newHash);
            }
            // 保存到IndexedDB
            this.cache.set(`${this.key}_mode`, mode, 24 * 60 * 60 * 1000); // 24小时过期
        }
        Init() {
            // 找到指定的容器
            this.container = document.getElementById(this.containerId);
            // 初始化缓存管理器（如果还没有初始化）
            if (!this.cache) {
                this.cache = new IndexedDBCache('csgoj_rank', 'logotable');
                this.logoCache = new IndexedDBCache('csgoj_rank', 'logotable');
            }
            if (!this.container) {
                // console.warn(`Rank container with id "${this.containerId}" not found, running in external mode`);
                // 不提供 container，表示外部调用模式
                this.externalMode = true;
                return;
            }
            this.externalMode = false;
            this._rankPerfReset('Init');
            /** 站内比赛榜页「榜单列表松紧」档位 0=最密 1=较紧（原投屏推荐）2=默认 3=与 rank.css 原始一致；仅存于有 contest-rank-page-shell 的页面（IDB 键名仍为 contestRankDensityLevel） */
            this.contestRankDensityLevel = 2;
            // 添加rank-system类以应用基础样式
            this.container.classList.add('rank-system');
            this.ApplyRankModeMark();
            // 清理之前的DOM和状态
            this.Cleanup();
            /** 离开页时打断换肤/松紧的 idle 与 rAF，避免主线程仍排队执行大表样式重算、拖住导航 */
            if (typeof window !== 'undefined' && !this._rankSkinOnPagehideListening) {
                this._rankSkinOnPagehide = () => {
                    this._rankSkinBusyCancelScheduledRafs();
                    this._rankSkinApplyGen = (this._rankSkinApplyGen || 0) + 1;
                    this.HideRankSkinBusyOverlay();
                };
                window.addEventListener('pagehide', this._rankSkinOnPagehide);
                this._rankSkinOnPagehideListening = true;
            }
            this.CreateHTML();
            this.InitElements();
            this.BindEvents();
            this.InitializeMode(); // 初始化模式状态
            // 先初始化缓存，然后加载数据
            const cacheInitPromise = Promise.resolve(
                this.cache && typeof this.cache.init === 'function' ? this.cache.init() : undefined
            );
            cacheInitPromise.then(() => {
                this._rankPerfLog('Init:after_cache_init');
                return Promise.resolve(this.LoadViewPrefs()).finally(() => {
                    this._rankPerfLog('Init:after_load_view_prefs');
                    this.InitLazyLoaders();
                    this.LoadData();
                });
            });
        }
        _rankPerfEnabled() {
            try {
                return !!(
                    typeof window !== 'undefined' &&
                    window.RankPagePerfDebug &&
                    window.RankPagePerfDebug.enabled
                );
            } catch (_) {
                return false;
            }
        }
        /** 新一轮耗时起点（自 LoadData 入口） */
        _rankPerfReset(label) {
            if (!this._rankPerfEnabled()) return;
            const now = performance.now();
            this._rankPerfT0 = now;
            this._rankPerfLast = now;
            const c = typeof window !== 'undefined' ? window['console'] : null;
            if (c && c['log']) {
                c['log'](`[RankPerf] reset ${label || 'load'} t0=${now.toFixed(1)}`);
            }
        }
        /**
         * @param {string} phase
         * @param {Record<string, unknown> | string} [detail]
         */
        _rankPerfLog(phase, detail) {
            if (!this._rankPerfEnabled()) return;
            const now = performance.now();
            const t0 = typeof this._rankPerfT0 === 'number' ? this._rankPerfT0 : now;
            const fromStart = (now - t0).toFixed(1);
            const prev = typeof this._rankPerfLast === 'number' ? this._rankPerfLast : t0;
            const delta = (now - prev).toFixed(1);
            this._rankPerfLast = now;
            const c = typeof window !== 'undefined' ? window['console'] : null;
            if (c && c['log']) {
                let detailStr = '';
                if (detail !== undefined) {
                    if (typeof detail === 'string') {
                        detailStr = detail;
                    } else {
                        try {
                            detailStr = JSON.stringify(detail);
                        } catch (_) {
                            detailStr = String(detail);
                        }
                    }
                }
                c['log'](`[RankPerf +${fromStart}ms Δ${delta}ms] ${phase}${detailStr ? ' ' + detailStr : ''}`);
            }
        }
        async LoadViewPrefs() {
            const viewPrefKey = this.GetViewPrefsKey();
            let loaded = false;
            if (this.cache) {
                try {
                    const viewPrefs = await this.cache.get(viewPrefKey);
                    if (viewPrefs && typeof viewPrefs === 'object') {
                        if (!this.config.rank_mode && (viewPrefs.currentMode === 'team' || viewPrefs.currentMode === 'school')) {
                            this.currentMode = viewPrefs.currentMode;
                        }
                        if ([0, 1, 2].includes(parseInt(viewPrefs.starMode, 10))) {
                            this.starMode = parseInt(viewPrefs.starMode, 10);
                        }
                        if (Array.isArray(viewPrefs.selectedGroupIds)) {
                            this.selectedGroupIds = viewPrefs.selectedGroupIds.filter(Boolean).map((x) => String(x));
                        }
                        if (Array.isArray(viewPrefs.filterSchools)) {
                            this.filterSchools = new Set(viewPrefs.filterSchools.filter(Boolean));
                        }
                        if (Array.isArray(viewPrefs.filterTeams)) {
                            this.filterTeams = new Set(viewPrefs.filterTeams.filter(Boolean));
                        }
                        if (RANK_SKIN_VALUES.includes(viewPrefs.rankSkin)) {
                            this.rankSkin = viewPrefs.rankSkin;
                            loaded = true;
                        }
                        const dLev = parseInt(viewPrefs.contestRankDensityLevel, 10);
                        if (!Number.isNaN(dLev) && dLev >= 0 && dLev <= 3) {
                            this.contestRankDensityLevel = dLev;
                        }
                    }
                    const skin = await this.cache.get(`${this.key}_rank_skin`);
                    if (!loaded && RANK_SKIN_VALUES.includes(skin)) {
                        this.rankSkin = skin;
                        loaded = true;
                    }
                } catch (e) {}
            }
            if (!loaded) {
            try {
                const skin = localStorage.getItem(`${this.key}_rank_skin`);
                if (RANK_SKIN_VALUES.includes(skin)) {
                    this.rankSkin = skin;
                }
            } catch (e) {}
            }
            this.ApplyRankSkin();
            this.SelectCustomOption('rank-skin', this.rankSkin);
            if (this.currentMode !== "roll") {
                this.SelectCustomOption(
                    "rank-mode",
                    this.currentMode === "school" ? "school" : "team"
                );
            }
            this.ApplyContestRankDensityLevel();
        }
        GetViewPrefsKey() {
            const cid = String(this.config?.cid_list || this.key || 'unknown');
            return `${this.key}_view_prefs_v1_${cid}`;
        }
        SaveViewPrefs() {
            if (!this.cache) return;
            const d = parseInt(this.contestRankDensityLevel, 10);
            const densityLev = !Number.isNaN(d) && d >= 0 && d <= 3 ? d : 2;
            const data = {
                currentMode: this.currentMode,
                starMode: this.starMode,
                selectedGroupIds: Array.isArray(this.selectedGroupIds) ? this.selectedGroupIds : [],
                filterSchools: Array.from(this.filterSchools || []),
                filterTeams: Array.from(this.filterTeams || []),
                rankSkin: this.rankSkin || 'default',
                contestRankDensityLevel: densityLev,
            };
            this.cache.set(this.GetViewPrefsKey(), data, 0).catch(() => {});
        }
        /**
         * 将榜单列表松紧档位同步到 .contest-rank-page-shell（仅站内比赛榜页有该节点；外榜等无操作）。
         * 档位 3：移除 data-contest-rank-density，样式与 rank.css 默认一致。
         */
        ApplyContestRankDensityLevel() {
            const shell = this.container && this.container.closest('.contest-rank-page-shell');
            if (!shell) return;
            let v = parseInt(this.contestRankDensityLevel, 10);
            if (Number.isNaN(v)) v = 2;
            v = Math.max(0, Math.min(3, v));
            this.contestRankDensityLevel = v;
            if (v >= 3) {
                shell.removeAttribute('data-contest-rank-density');
            } else {
                shell.setAttribute('data-contest-rank-density', String(v));
            }
            const lab = document.getElementById('rank-skin-density-level');
            if (lab) lab.textContent = String(v);
            const minus = document.getElementById('rank-skin-density-minus');
            const plus = document.getElementById('rank-skin-density-plus');
            const toMin = document.getElementById('rank-skin-density-to-min');
            const toMax = document.getElementById('rank-skin-density-to-max');
            if (minus) minus.disabled = v <= 0;
            if (plus) plus.disabled = v >= 3;
            if (toMin) toMin.disabled = v <= 0;
            if (toMax) toMax.disabled = v >= 3;
        }
        ApplyRankSkin() {
            if (!this.container) return;
            this.container.setAttribute('data-rank-skin', this.rankSkin);
            const rankHdr = this.GetHeaderElement();
            if (rankHdr) {
                rankHdr.setAttribute("data-rank-skin", this.rankSkin || "default");
            }
            document.querySelectorAll(".roll-controls-section").forEach((el) => {
                el.setAttribute("data-rank-skin", this.rankSkin || "default");
            });
            const rollAwardOv = this.container.querySelector('#csg-roll-award-overlay');
            if (rollAwardOv) {
                rollAwardOv.setAttribute('data-rank-skin', this.rankSkin || 'default');
            }
            if (this.cache) {
                this.cache.set(`${this.key}_rank_skin`, this.rankSkin, 0).catch(() => {});
            }
            this.SaveViewPrefs();
            try {
                localStorage.setItem(`${this.key}_rank_skin`, this.rankSkin);
            } catch (e) {}
            /** 换肤不整表重建表头（避免大 DOM replace）；仅同步依赖皮肤的表头小部件 */
            this.SyncRankSkinDependentHeaderBits();
        }
        /**
         * @param {'skin'|'density'} [mode='skin'] 文案区分换肤与榜单列表松紧
         */
        ShowRankSkinBusyOverlay(mode = 'skin') {
            if (this.externalMode || !this.container) return;
            const busy = this.elements?.rankSkinBusy || document.getElementById('rank-skin-busy');
            if (!busy) return;
            const msgEl = busy.querySelector('#rank-skin-busy-msg');
            if (msgEl) {
                if (mode === 'density') {
                    msgEl.innerHTML = this.CreateBilingualText('正在调整榜单列表…', 'Updating ranking list…');
                } else {
                    msgEl.innerHTML = this.CreateBilingualText('切换配色中…', 'Applying theme…');
                }
            }
            busy.style.display = 'flex';
            busy.setAttribute('aria-busy', 'true');
            void busy.offsetHeight;
        }
        HideRankSkinBusyOverlay() {
            const busy = this.elements?.rankSkinBusy || document.getElementById('rank-skin-busy');
            if (!busy) return;
            busy.style.display = 'none';
            busy.setAttribute('aria-busy', 'false');
        }
        _rankSkinBusyClearDeferredApply() {
            if (this._rankSkinBusyDeferredIdleId != null) {
                try {
                    if (typeof cancelIdleCallback === 'function') {
                        cancelIdleCallback(this._rankSkinBusyDeferredIdleId);
                    }
                } catch (_) { /* ignore */ }
                this._rankSkinBusyDeferredIdleId = null;
            }
            if (this._rankSkinBusyDeferredTimeoutId != null) {
                clearTimeout(this._rankSkinBusyDeferredTimeoutId);
                this._rankSkinBusyDeferredTimeoutId = null;
            }
        }
        _rankSkinBusyCancelScheduledRafs() {
            this._rankSkinBusyClearDeferredApply();
            if (this._rankSkinBusyScheduledRafs && this._rankSkinBusyScheduledRafs.length) {
                this._rankSkinBusyScheduledRafs.forEach((id) => cancelAnimationFrame(id));
            }
            this._rankSkinBusyScheduledRafs = [];
        }
        _rankSkinBusyPushRaf(callback) {
            const id = requestAnimationFrame(callback);
            if (!this._rankSkinBusyScheduledRafs) this._rankSkinBusyScheduledRafs = [];
            this._rankSkinBusyScheduledRafs.push(id);
            return id;
        }
        /**
         * 大表改 data-rank-skin / 密度属性会触发整树样式重算（同步、耗时长）。
         * 若在 rAF 回调里立刻执行并再 void offsetHeight 强制 layout，会占满主线程，后续排队的导航点击要等该长任务结束才执行。
         * 因此在双 rAF 之后用 requestIdleCallback（带 timeout）或 setTimeout(0) 再跑 apply；不要用 offsetHeight 强刷 layout。
         */
        _rankSkinBusyDeferHeavyApply(gen, applyFn) {
            this._rankSkinBusyClearDeferredApply();
            const postPaintFrames = RANK_SKIN_BUSY_POST_PAINT_FRAMES;
            const run = () => {
                this._rankSkinBusyDeferredIdleId = null;
                this._rankSkinBusyDeferredTimeoutId = null;
                if (gen !== this._rankSkinApplyGen) return;
                try {
                    applyFn();
                } finally {
                    let left = postPaintFrames;
                    const step = () => {
                        if (gen !== this._rankSkinApplyGen) return;
                        left -= 1;
                        if (left <= 0) {
                            this.HideRankSkinBusyOverlay();
                            this._rankSkinBusyScheduledRafs = [];
                            return;
                        }
                        this._rankSkinBusyPushRaf(step);
                    };
                    this._rankSkinBusyPushRaf(step);
                }
            };
            if (typeof requestIdleCallback === 'function') {
                this._rankSkinBusyDeferredIdleId = requestIdleCallback(run, { timeout: 64 });
            } else {
                this._rankSkinBusyDeferredTimeoutId = setTimeout(run, 0);
            }
        }
        /**
         * 在遮罩已显示后调用：双 rAF 再 ApplyRankSkin，给主线程空隙合成遮罩；再经多帧绘制后关遮罩，减少大表逐字反色暴露在遮罩外。
         * 快速连点用代数丢弃过期回调。
         */
        ScheduleRankSkinApplyAndHideBusy() {
            if (this.externalMode || !this.container) return;
            this._rankSkinApplyGen = (this._rankSkinApplyGen || 0) + 1;
            const gen = this._rankSkinApplyGen;
            this._rankSkinBusyCancelScheduledRafs();
            this._rankSkinBusyPushRaf(() => {
                if (gen !== this._rankSkinApplyGen) return;
                this._rankSkinBusyPushRaf(() => {
                    if (gen !== this._rankSkinApplyGen) return;
                    this._rankSkinBusyDeferHeavyApply(gen, () => this.ApplyRankSkin());
                });
            });
        }
        /**
         * 与 ScheduleRankSkinApplyAndHideBusy 相同节奏；与换肤共用 #rank-skin-busy 与 _rankSkinApplyGen。
         */
        ScheduleContestRankDensityApplyAndHideBusy() {
            if (this.externalMode || !this.container) return;
            this._rankSkinApplyGen = (this._rankSkinApplyGen || 0) + 1;
            const gen = this._rankSkinApplyGen;
            this._rankSkinBusyCancelScheduledRafs();
            this._rankSkinBusyPushRaf(() => {
                if (gen !== this._rankSkinApplyGen) return;
                this._rankSkinBusyPushRaf(() => {
                    if (gen !== this._rankSkinApplyGen) return;
                    this._rankSkinBusyDeferHeavyApply(gen, () => this.ApplyContestRankDensityLevel());
                });
            });
        }
        /**
         * 表头中与 rankSkin 相关的 DOM（当前仅题列气球线框/实心），不调用 RecreateHeaderRow。
         */
        SyncRankSkinDependentHeaderBits() {
            if (!this.container) return;
            const headerRow = this.container.querySelector('.rank-header-row');
            if (!headerRow) return;
            const useOutlineBalloon = this.rankSkin === 'dark_stage';
            const iconClass = useOutlineBalloon ? 'bi bi-balloon' : 'bi bi-balloon-fill';
            headerRow.querySelectorAll('.problem-header-color-bg > i').forEach((icon) => {
                icon.className = iconClass;
            });
        }
        // 清理之前的DOM和状态
        Cleanup() {
            this._rankSkinBusyCancelScheduledRafs();
            this._rankSkinApplyGen = (this._rankSkinApplyGen || 0) + 1;
            this.HideRankSkinBusyOverlay();
            // 清理时间进度条自动更新定时器
            this.StopTimeProgressAutoUpdate();
            // 清理时间遮罩层定时器
            this.StopTimeOverlay();
            // 清理自动滚动定时器
            this.StopAutoScroll();
            this.autoScrollMode = 0;
            // 清理观察器
            if (this.logoObserver) {
                this.logoObserver.disconnect();
                this.logoObserver = null;
            }
            if (this._flagObserver) {
                this._flagObserver.disconnect();
                this._flagObserver = null;
            }
            // 清理DOM事件监听器
            if (this.elements) {
                // 移除所有事件监听器
                Object.values(this.elements).forEach(element => {
                    if (element && element.removeEventListener) {
                        // 这里可以添加具体的事件清理逻辑
                    }
                });
            }
            // 清理header元素（从容器外部移除）
            if (this.container) {
                const oldHeader = this.GetHeaderElement();
                if (oldHeader) {
                    oldHeader.remove();
                }
            }
            // 清理全屏状态
            if (this.isFullscreen) {
                this.container.classList.remove('fullscreen');
                this.isFullscreen = false;
            }
            // 清理tooltip
            if (this.globalTooltip) {
                this.globalTooltip.remove();
                this.globalTooltip = null;
                this.globalTooltipContent = null;
            }
            // 清理tooltip相关状态
            if (this.tooltipTimeouts) {
                Object.values(this.tooltipTimeouts).forEach(timeout => clearTimeout(timeout));
                this.tooltipTimeouts = {};
            }
            // 重置状态
            this.rankList = [];
            this.schoolList = [];
            this.data = null;
            this.elements = {};
            this._rankRenderChain = Promise.resolve();
        }
        // #########################################
        //  初始化和配置模块
        // #########################################
        // 初始化模式状态
        InitializeMode() {
            this.ApplyRankModeMark();
            // 同步模式下拉文案（滚榜页不渲染 rank-mode 控件）
            if (this.currentMode !== "roll") {
                this.SelectCustomOption(
                    "rank-mode",
                    this.currentMode === "school" ? "school" : "team"
                );
            }
            // 更新页面内「当前模式」紧凑指示文案（结构需与 CreateHeader 一致，便于双语切换）
            const modeLabel = { team: ['队伍排名', 'Team Rank'], school: ['学校/组织 排名', 'Organization Rank'], roll: ['滚榜', 'Roll'] };
            const [modeCn, modeEn] = modeLabel[this.currentMode] || modeLabel.team;
            if (this.elements.rankModeIndicator) {
                this.elements.rankModeIndicator.innerHTML = `<span class="rank-mode-cn">${RankToolEscapeHtml(modeCn)}</span><en-text>${RankToolEscapeHtml(modeEn)}</en-text>`;
            }
            // 显示/隐藏 学校/组织 信息
            if (this.elements.schoolInfo) {
                this.elements.schoolInfo.style.display = this.currentMode === 'school' ? 'block' : 'none';
            }
            // 更新页面标题
            this.UpdatePageTitle();
        }
        ApplyRankModeMark() {
            if (!this.container) return;
            this.container.setAttribute('data-rank-mode', this.currentMode || 'team');
            const rankContainer = this.container.querySelector('.rank-container');
            if (rankContainer) {
                rankContainer.setAttribute('data-rank-mode', this.currentMode || 'team');
            }
            const headerRow = this.container.querySelector('.rank-header-row');
            if (headerRow) {
                headerRow.setAttribute('data-rank-mode', this.currentMode || 'team');
            }
        }
        // #########################################
        //  HTML生成和DOM操作模块
        // #########################################
        // HTML生成工具方法（已迁移到 rank_tool.js）
        CreateBilingualText(label, label_en) {
            return RankToolGenerateBilingualText(label, label_en);
        }
        GenerateSelectOptions(options) {
            return options.map(option => 
                `<option value="${option.value}">${this.CreateBilingualText(option.label, option.label_en)}</option>`
            ).join('');
        }
        GenerateButtons(buttons, withText = false) {
            if (withText) {
                // 带文字的按钮（用于下拉菜单）
                return buttons.map(button => 
                    `<div id="${button.id}" class="control-btn ${button.class} with-text" role="button" tabindex="0" ${RankToolGenerateBilingualAttributes(button.label, button.label_en)}>
                        ${button.icon}
                        <span class="button-text">${this.CreateBilingualText(button.label, button.label_en)}</span>
                    </div>`
                ).join('');
            } else {
                // 仅图标按钮（用于工具栏）
                return buttons.map(button => 
                    button.id === 'filter-btn'
                        ? `<div id="${button.id}" class="control-btn ${button.class} filter-info-btn" role="button" tabindex="0" ${RankToolGenerateBilingualAttributes(button.label, button.label_en)}>
                            ${button.icon}
                            <span id="filter-quick-info" class="filter-quick-info">G0 · T0 · S0</span>
                        </div>`
                        : `<div id="${button.id}" class="control-btn ${button.class}" role="button" tabindex="0" ${RankToolGenerateBilingualAttributes(button.label, button.label_en)}>${button.icon}</div>`
                ).join('');
            }
        }
        // 生成自定义下拉组件
        GenerateCustomSelect(options, selectId, currentValue = '0', withText = false) {
            const currentOption = options.find(opt => opt.value === currentValue) || options[0];
            const btnClass = withText ? '' : 'icon-only';
            // 触发按钮始终带 .option-text：宽屏 icon-only 由 CSS 隐藏；收起到「更多」下拉或滚榜条等场景可显示，与 control-btn.with-text 一致
            const btnContent =
                `${RankToolGenerateIconOnly(RankToolGetIconKeyFromOption(currentOption))}` +
                `<span class="option-text">${this.CreateBilingualText(currentOption.label, currentOption.label_en)}</span>`;
            return `
                <div class="custom-select-container" id="${selectId}-container">
                    <div class="custom-select-btn ${btnClass}" id="${selectId}-btn" role="button" tabindex="0" ${RankToolGenerateBilingualAttributes(currentOption.label, currentOption.label_en)}>
                        ${btnContent}
                    </div>
                    <div class="custom-select-dropdown" id="${selectId}-dropdown">
                        ${options.map(option => `
                            <div class="custom-select-option ${option.value === currentValue ? 'selected' : ''}" 
                                data-value="${option.value}" 
                                ${RankToolGenerateBilingualAttributes(option.label, option.label_en)}>
                                ${RankToolGenerateIconOnly(RankToolGetIconKeyFromOption(option))}
                                <span class="option-text">${option.label}<en-text>${option.label_en}</en-text></span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        GenerateAwardItems(items) {
            return items.map(item => 
                `<div class="award-item">
                    <span class="award-label">${this.CreateBilingualText(item.label, item.label_en)}</span>
                    <span id="${item.id}" class="award-value"></span>
                </div>`
            ).join('');
        }
        CreateHTML() {
            // 清空容器
            this.container.innerHTML = '';
            // 创建页面头部（控制按钮）- 插入到容器外部
            this.CreateHeader();
            // 创建内容包装器（用于全屏时的居中对齐）
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'rank-content-wrapper';
            // 创建榜单容器（包含表格表头和数据）
            this.CreateRankContainer();
            // 将rank-container放入包装器
            const rankContainer = this.container.querySelector('.rank-container');
            if (rankContainer) contentWrapper.appendChild(rankContainer);
            // 将包装器添加到容器
            this.container.appendChild(contentWrapper);
            // 创建加载提示
            this.CreateLoading();
            // 创建模态框
            this.CreateModals();
        }
        CreateHeader() {
            const config = this.htmlConfigs.headerControls;
            const header = document.createElement('div');
            header.className = 'rank-header';
            // 根据配置和当前模式决定是否显示比赛标题
            const shouldShowTitle = this.isFullscreen 
                ? this.config.flg_show_fullscreen_contest_title 
                : this.config.flg_show_page_contest_title;
            const titleHtml = shouldShowTitle 
                ? `<h1 id="rank-page-title">${this.CreateBilingualText('比赛榜单', 'Contest Ranking')}</h1>`
                : '';
            
            // 根据配置决定是否显示时间进度条
            const showTimeProgress = this.config.flg_show_time_progress !== false;
            // 根据配置决定是否显示按钮功能区
            const showControlsToolbar = this.config.flg_show_controls_toolbar !== false;
            const showControlsTimeSection = showTimeProgress || showControlsToolbar;
            
            // 生成时间轴HTML（如果启用）
            const timeProgressHtml = showTimeProgress ? `
                        <!-- 时间轴区域（左侧） -->
                        <div class="time-progress-wrapper">
                            <div class="time-display-group">
                                <span id="time-progress-current" class="time-current">00:00:00</span>
                                <span id="time-progress-total" class="time-total">00:00:00</span>
                            </div>
                            <div class="time-progress-bar-container">
                                <input type="range" id="time-progress-slider" class="time-progress-slider" min="0" max="100" value="100">
                                <div class="time-progress-track"></div>
                                <div class="time-progress-track-outline"></div>
                            </div>
                            <button id="time-reset-btn" class="time-reset-btn" title="重置到最新时间">
                                <i class="bi bi-skip-end-fill" aria-hidden="true"></i>
                            </button>
                        </div>
            ` : '';
            
            // 生成按钮功能区HTML（如果启用）
            const controlsToolbarHtml = showControlsToolbar ? `
                        <!-- 控制按钮区域（右侧，宽屏时显示） -->
                        <div class="controls-toolbar" id="header-controls">
                            <div class="toolbar-group">
                                <div class="toolbar-item">
                                    ${this.GenerateButtons([config.buttons[0]])}
                                </div>
                            </div>
                            <div class="toolbar-group">
                                ${this.GenerateButtons(config.buttons.slice(1, 3))}
                            </div>
                            <div class="toolbar-group">
                                ${this.GenerateButtons(config.buttons.slice(3))}
                            </div>
                        </div>
                        
                        <!-- 折叠按钮（窄屏时显示） -->
                        <button class="controls-toggle-btn" id="controls-toggle-btn" title="更多选项">
                            <i class="bi bi-three-dots"></i>
                        </button>
                        
                        <!-- 折叠下拉菜单（窄屏时使用） -->
                        <div class="controls-dropdown" id="controls-dropdown">
                            <div class="toolbar-group">
                                <div class="toolbar-item">
                                    ${this.GenerateButtons([config.buttons[0]], true)}
                                </div>
                            </div>
                            <div class="toolbar-group">
                                ${this.GenerateButtons(config.buttons.slice(1, 3), true)}
                            </div>
                            <div class="toolbar-group">
                                ${this.GenerateButtons(config.buttons.slice(3), true)}
                            </div>
                        </div>
            ` : '';
            
            // 当前排名模式指示（紧凑文案，与工具栏同一行；用 span 包裹中文以便双语切换时隐藏）
            const modeLabel = { team: ['队伍排名', 'Team Rank'], school: ['学校/组织 排名', 'Organization Rank'], roll: ['滚榜', 'Roll'] };
            const [modeCn, modeEn] = modeLabel[this.currentMode] || modeLabel.team;
            const rankModeIndicatorHtml = (showTimeProgress || showControlsToolbar) ? `
                <span id="rank-mode-indicator" class="rank-mode-indicator" aria-live="polite"><span class="rank-mode-cn">${RankToolEscapeHtml(modeCn)}</span><en-text>${RankToolEscapeHtml(modeEn)}</en-text></span>
            ` : '';
            const rankModeSelectHtml =
                this.currentMode === "roll"
                    ? ""
                    : `
                <div class="toolbar-item">
                    ${this.GenerateCustomSelect(config.rankModeOptions, 'rank-mode', this.currentMode === 'school' ? 'school' : 'team')}
                </div>
            `;
            const skinFilterHtml =
                this.currentMode === "roll"
                    ? ""
                    : `
                <div class="toolbar-item">
                    ${this.GenerateCustomSelect(config.rankSkinOptions, 'rank-skin', this.rankSkin)}
                </div>
            `;
            // 只有当至少一个区域需要显示时，才渲染 controls-time-section
            const controlsTimeSectionHtml = showControlsTimeSection ? `
                <div class="controls-time-section">
                    <div class="controls-time-container">
                        ${rankModeIndicatorHtml}
                        ${rankModeSelectHtml}
                        ${skinFilterHtml}
                        ${timeProgressHtml}
                        ${controlsToolbarHtml}
                    </div>
                </div>
            ` : '';
            
            
            header.innerHTML = `
                <div class="header-content">
                    <div class="title-section">
                        ${titleHtml}
                    </div>
                </div>
                ${controlsTimeSectionHtml}
            `;
            // 将 header 插到「榜单块」外：有 contest-rank-page-shell__body 时插在壳子层（与 __body 并列），
            // 避免换肤/松紧遮罩 dim（挂在 __body 内、inset:0）盖住工具栏与皮肤下拉。
            const p = this.container.parentElement;
            const ref =
                p && p.classList.contains('contest-rank-page-shell__body') ? p : this.container;
            ref.insertAdjacentElement('beforebegin', header);
            header.setAttribute("data-rank-skin", this.rankSkin || "default");

            // 检查 header 是否为空，如果为空则隐藏
            this.UpdateHeaderVisibility();
        }
        
        /**
         * 获取 header 元素（从容器外部查找）
         */
        GetHeaderElement() {
            const shell = this.container && this.container.closest('.contest-rank-page-shell');
            if (shell) {
                const scoped = shell.querySelector(':scope > .rank-header');
                if (scoped) {
                    return scoped;
                }
            }
            let header = this.container.previousElementSibling;
            if (!header || !header.classList.contains('rank-header')) {
                const containerParent = this.container.parentNode;
                if (containerParent) {
                    header = Array.from(containerParent.children).find(el =>
                        el.classList.contains('rank-header') &&
                        el.nextElementSibling === this.container
                    );
                }
                if (!header) {
                    const allHeaders = document.querySelectorAll('.rank-header');
                    for (const h of allHeaders) {
                        if (h.nextElementSibling && h.nextElementSibling.id === this.containerId) {
                            header = h;
                            break;
                        }
                    }
                }
            }
            return header;
        }
        
        /**
         * 更新 header 的可见性：如果 header 没有内容，则隐藏它
         */
        UpdateHeaderVisibility() {
            const header = this.GetHeaderElement();
            if (!header) return;
            
            // 检查是否有实际内容
            const titleSection = header.querySelector('.title-section');
            const controlsTimeSection = header.querySelector('.controls-time-section');
            
            // 检查 title-section 是否有实际内容（h1 标签或有文本内容）
            let hasTitle = false;
            if (titleSection) {
                const h1 = titleSection.querySelector('h1');
                if (h1) {
                    // 有 h1 标签，检查是否有文本内容
                    hasTitle = h1.textContent.trim().length > 0;
                } else {
                    // 没有 h1，检查整个 title-section 是否有文本内容
                    // 排除空白字符和空 en-text 标签
                    const textContent = Array.from(titleSection.childNodes)
                        .filter(node => node.nodeType === Node.TEXT_NODE)
                        .map(node => node.textContent)
                        .join('')
                        .trim();
                    hasTitle = textContent.length > 0;
                }
            }
            
            // 检查 controls-time-section 是否存在且有实际内容（子元素）
            const hasControls = controlsTimeSection && controlsTimeSection.children.length > 0;
            
            // 如果没有任何内容，隐藏 header（设置为 display: none 而不是高度 0，更彻底）
            if (!hasTitle && !hasControls) {
                header.style.display = 'none';
            } else {
                header.style.display = '';
            }
        }
        CreateRankContainer() {
            // 创建rank容器
            const container = document.createElement('div');
            container.className = 'rank-container';
            container.setAttribute('data-rank-mode', this.currentMode || 'team');
            // 使用统一的CreateHeaderRow方法创建表头
            const tableHeaderRow = this.CreateHeaderRow();
            // 添加rank-grid
            const rankGrid = document.createElement('div');
            rankGrid.id = 'rank-grid';
            rankGrid.className = 'rank-grid';
            container.appendChild(tableHeaderRow);
            container.appendChild(rankGrid);
            this.container.appendChild(container);
            // 为整个rank容器注册hover事件，动态处理tooltip
            this.SetupDynamicTooltips(this.container);
        }
        // #########################################
        //  Tooltip和交互功能模块
        // #########################################
        // 设置动态tooltip处理
        SetupDynamicTooltips(container) {
            // 使用事件委托处理hover事件
            const throttle = (fn, gap = 16) => {
                let last = 0;
                return function(...args) {
                    const now = Date.now();
                    if (now - last >= gap) { last = now; return fn.apply(this, args); }
                };
            };
            
            // 处理鼠标悬停事件
            container.addEventListener('mouseover', (e) => {
                // 滚榜状态下，不显示tooltip
                if (this.currentMode === 'roll' && this.isRolling) {
                    return;
                }
                
                // 查找有tooltip属性的元素（包括自身和父元素）
                let target = e.target;
                let titlecn = null;
                let titleen = null;
                while (target && target !== container) {
                    // 优先检查专用tooltip处理函数
                    const specialHandler = this.HasSpecialTooltipHandler(target);
                    if (specialHandler) {
                        const content = this.GetSpecialTooltipContent(target, specialHandler);
                        if (content) {
                            titlecn = content.titlecn;
                            titleen = content.titleen;
                            break;
                        }
                    }
                    // 回退到传统属性方式
                    titlecn = target.getAttribute('title-cn');
                    titleen = target.getAttribute('title-en');
                    if (titlecn || titleen) {
                        break;
                    }
                    target = target.parentElement;
                }
                if (titlecn || titleen) {
                    // 初始化tooltipTimeouts
                    if (!this.tooltipTimeouts) {
                        this.tooltipTimeouts = {};
                    }
                    // 清除之前的延迟
                    if (this.tooltipTimeouts[target]) {
                        clearTimeout(this.tooltipTimeouts[target]);
                    }
                    // 延迟显示tooltip，传递鼠标事件
                    this.tooltipTimeouts[target] = setTimeout(() => {
                        this.ShowTooltipForElement(target, titlecn, titleen, e);
                    }, 300);
                }
            });
            
            // 处理点击和双击事件 - 使用延迟区分单击和双击
            let clickTimeout = null;
            let clickCount = 0;
            
            container.addEventListener('click', (e) => {
                clickCount++;
                
                // 清除之前的延迟
                if (clickTimeout) {
                    clearTimeout(clickTimeout);
                }
                
                // 延迟处理单击事件，给双击事件机会
                clickTimeout = setTimeout(() => {
                    if (clickCount === 1) {
                        // 单击事件 - 点击空白区域显示队伍ID
                        const rankRow = e.target.closest('.rank-row');
                        if (rankRow) {
                            const rowId = rankRow.getAttribute('data-row-id');
                            if (rowId) {
                                // 检查是否点击在空白区域（没有其他tooltip元素）
                                const hasTooltipElement = e.target.closest('[title-cn], [title-en], .control-btn, .custom-select-btn, .rank-item, .solve-item, .penalty-item, .problem-item');
                                if (!hasTooltipElement) {
                                    // 滚榜状态下，不显示tooltip
                                    if (this.currentMode === 'roll' && this.isRolling) {
                                        return;
                                    }
                                    // 显示队伍ID的tooltip
                                    const teamId = rowId;
                                    this.ShowTooltipForElement(rankRow, `队伍ID: ${teamId}`, `Team ID: ${teamId}`, e);
                                }
                            }
                        }
                    }
                    clickCount = 0;
                }, 300); // 300ms延迟，给双击事件足够时间
            });
            
            container.addEventListener('dblclick', async (e) => {
                // 清除单击延迟
                if (clickTimeout) {
                    clearTimeout(clickTimeout);
                    clickTimeout = null;
                }
                clickCount = 0;
                
                // 双击事件 - 复制tooltip信息
                let target = e.target;
                let titlecn = null;
                let titleen = null;
                
                // 首先检查是否点击在rank-row空白区域
                const rankRow = e.target.closest('.rank-row');
                if (rankRow) {
                    const rowId = rankRow.getAttribute('data-row-id');
                    if (rowId) {
                        const hasTooltipElement = e.target.closest('[title-cn], [title-en], .control-btn, .custom-select-btn, .rank-item, .solve-item, .penalty-item, .problem-item');
                        if (!hasTooltipElement) {
                            // 空白区域双击，复制队伍ID
                            const teamId = rowId;
                            const success = await this.CopyToClipboard(teamId);
                            if (success) {
                                this.ShowCopySuccessBubble(e);
                            }
                            return;
                        }
                    }
                }
                
                // 特判：检查是否双击在副语言队名上
                const teamNameEn = e.target.closest('.team-name-en');
                if (teamNameEn) {
                    const rankRow = teamNameEn.closest('.rank-row');
                    if (rankRow) {
                        const rowId = rankRow.getAttribute('data-row-id');
                        if (rowId) {
                            // 从数据中获取副语言队名
                            const teamData = this.rankData.find(item => item.team.team_id == rowId);
                            if (teamData && teamData.team.name_en) {
                                const success = await this.CopyToClipboard(teamData.team.name_en);
                                if (success) {
                                    this.ShowCopySuccessBubble(e);
                                }
                                return;
                            }
                        }
                    }
                }
                
                // 查找有tooltip属性的元素
                while (target && target !== container) {
                    // 优先检查专用tooltip处理函数
                    const specialHandler = this.HasSpecialTooltipHandler(target);
                    if (specialHandler) {
                        const content = this.GetSpecialTooltipContent(target, specialHandler);
                        if (content) {
                            titlecn = content.titlecn;
                            titleen = content.titleen;
                            break;
                        }
                    }
                    // 回退到传统属性方式
                    titlecn = target.getAttribute('title-cn');
                    titleen = target.getAttribute('title-en');
                    if (titlecn || titleen) {
                        break;
                    }
                    target = target.parentElement;
                }
                
                // 如果找到tooltip内容，复制到剪贴板
                if (titlecn || titleen) {
                    const copyText = titlecn || titleen;
                    const success = await this.CopyToClipboard(copyText);
                    if (success) {
                        this.ShowCopySuccessBubble(e);
                    }
                }
            });
            container.addEventListener('mouseout', (e) => {
                // 滚榜状态下，不处理tooltip
                if (this.currentMode === 'roll' && this.isRolling) {
                    return;
                }
                
                // 查找有tooltip属性的元素（包括自身和父元素）
                let target = e.target;
                let titlecn = null;
                let titleen = null;
                while (target && target !== container) {
                    // 优先检查专用tooltip处理函数
                    const specialHandler = this.HasSpecialTooltipHandler(target);
                    if (specialHandler) {
                        const content = this.GetSpecialTooltipContent(target, specialHandler);
                        if (content) {
                            titlecn = content.titlecn;
                            titleen = content.titleen;
                            break;
                        }
                    }
                    // 回退到传统属性方式
                    titlecn = target.getAttribute('title-cn');
                    titleen = target.getAttribute('title-en');
                    if (titlecn || titleen) {
                        break;
                    }
                    target = target.parentElement;
                }
                if (titlecn || titleen) {
                    // 清除延迟
                    if (this.tooltipTimeouts && this.tooltipTimeouts[target]) {
                        clearTimeout(this.tooltipTimeouts[target]);
                    }
                    // 延迟隐藏tooltip
                    setTimeout(() => {
                        this.HideGlobalTooltip();
                    }, 50);
                }
            });
            container.addEventListener('mousemove', throttle((e) => {
                // 滚榜状态下，不处理tooltip位置更新
                if (this.currentMode === 'roll' && this.isRolling) {
                    return;
                }
                
                // 查找有tooltip属性的元素（包括自身和父元素）
                let target = e.target;
                let titlecn = null;
                let titleen = null;
                while (target && target !== container) {
                    // 优先检查专用tooltip处理函数
                    const specialHandler = this.HasSpecialTooltipHandler(target);
                    if (specialHandler) {
                        const content = this.GetSpecialTooltipContent(target, specialHandler);
                        if (content) {
                            titlecn = content.titlecn;
                            titleen = content.titleen;
                            break;
                        }
                    }
                    // 回退到传统属性方式
                    titlecn = target.getAttribute('title-cn');
                    titleen = target.getAttribute('title-en');
                    if (titlecn || titleen) {
                        break;
                    }
                    target = target.parentElement;
                }
                if ((titlecn || titleen) && this.globalTooltip && this.globalTooltip.style.display !== 'none') {
                    this.UpdateTooltipPosition(this.globalTooltip, target, e);
                }
            }));
        }
        // 处理元素中的tooltip (已废弃，使用全局tooltip)
        ProcessElementForTooltips(element) {
            // 不再需要，使用全局tooltip处理
        }
        CreateLoading() {
            const existingBusy = document.getElementById('rank-skin-busy');
            if (existingBusy) {
                existingBusy.remove();
            }
            const wrap = this.container.querySelector('.rank-content-wrapper');
            const host = wrap || this.container;
            const rankBusyCardStackHtml = (msgHtml, msgElementId) =>
                '<div class="loading-overlay-dim" aria-hidden="true"></div>' +
                '<div class="rank-loading-viewport-anchor">' +
                '<div class="card border-0 csgoj-overlay-card rank-loading-card rank-loading-card--neutral">' +
                '<div class="card-body text-center px-4 py-4">' +
                '<div class="spinner-border text-primary rank-loading-bs-spinner" role="status" style="width:2.75rem;height:2.75rem">' +
                '<span class="visually-hidden">Loading</span></div>' +
                `<div class="rank-loading-msg text-center px-1"${msgElementId ? ` id="${msgElementId}"` : ''}>` +
                msgHtml +
                '</div></div></div></div>';
            const loading = document.createElement('div');
            loading.id = 'loading';
            loading.className = 'loading-overlay loading-overlay-stack';
            loading.innerHTML = rankBusyCardStackHtml(this.CreateBilingualText('初始化中...', 'Initializing...'), '');
            host.appendChild(loading);
            const skinBusy = document.createElement('div');
            skinBusy.id = 'rank-skin-busy';
            skinBusy.className = 'loading-overlay loading-overlay-stack rank-skin-busy-overlay';
            skinBusy.setAttribute('aria-hidden', 'true');
            skinBusy.style.display = 'none';
            skinBusy.innerHTML = rankBusyCardStackHtml(
                this.CreateBilingualText('切换配色中…', 'Applying theme…'),
                'rank-skin-busy-msg'
            );
            host.appendChild(skinBusy);
            this.MountRankSkinBusyOverlayToShell();
        }
        /**
         * 将换肤/列表松紧遮罩挂到 .contest-rank-page-shell__body（若存在），dim 只盖榜单块；
         * 无 __body 时退回挂 shell；无壳时保留在 .rank-content-wrapper 内（与既有绝对定位一致）。
         */
        MountRankSkinBusyOverlayToShell() {
            const busy = document.getElementById('rank-skin-busy');
            if (!busy || !this.container) return;
            const shell = this.container.closest('.contest-rank-page-shell');
            if (!shell) {
                busy.classList.remove('rank-skin-busy-overlay--shell-host');
                return;
            }
            const body = shell.querySelector(':scope > .contest-rank-page-shell__body');
            (body || shell).appendChild(busy);
            busy.classList.add('rank-skin-busy-overlay--shell-host');
        }
        CreateModals() {
            // 统计模态框
            const summaryModal = document.createElement('div');
            summaryModal.id = 'summary-modal';
            summaryModal.className = 'modal-overlay';
            summaryModal.style.display = 'none';
            summaryModal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>${this.CreateBilingualText('统计数据', 'Statistics')}</h3>
                        <button id="close-summary" class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="summary-content"></div>
                    </div>
                </div>
            `;
            this.container.appendChild(summaryModal);
            
            // 快捷键帮助模态框
            const helpModal = document.createElement('div');
            helpModal.id = 'rank-help-modal';
            helpModal.className = 'modal-overlay';
            helpModal.style.display = 'none';
            helpModal.innerHTML = `
                <div class="modal-content rank-help-modal-content">
                    <div class="modal-header rank-help-modal-header">
                        <h3>${this.CreateBilingualText('快捷键说明', 'Keyboard Shortcuts')}</h3>
                        <button id="close-rank-help" class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body rank-help-body rank-help-modal-body">
                        <div class="rank-help-columns">
                            <section class="rank-help-panel">
                                <h4 class="rank-help-panel-title">${this.CreateBilingualText('常用', 'General')}</h4>
                                <div class="rank-help-rows">
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>F5</code></div><div class="rank-help-desc">${this.CreateBilingualText('刷新', 'Refresh data')}</div></div>
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>A</code></div><div class="rank-help-desc">${this.CreateBilingualText('自动刷新 开/关', 'Toggle auto refresh')}</div></div>
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>B</code></div><div class="rank-help-desc">${this.CreateBilingualText('全屏时自动滚动 开/关', 'Fullscreen: toggle auto-scroll')}</div></div>
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>H</code></div><div class="rank-help-desc">${this.CreateBilingualText('打开/关闭本说明（全屏计时器打开时，去右侧栏看本键）', 'This help. With timer on, see right column')}</div></div>
                                </div>
                            </section>
                            <section class="rank-help-panel">
                                <h4 class="rank-help-panel-title">${this.CreateBilingualText('全屏 · 计时器', 'Fullscreen · Timer')}</h4>
                                <p class="rank-help-lead">${this.CreateBilingualText('先浏览器全屏。仅队伍榜、学校榜；赛事滚榜无此计时器。', 'Browser fullscreen · team/school rank only · not roll view.')}</p>
                                <div class="rank-help-rows">
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>T</code></div><div class="rank-help-desc">${this.CreateBilingualText('全屏计时器 开/关', 'Turn timer on/off')}</div></div>
                                    <div class="rank-help-timer-modes" role="group">
                                        <div class="rank-help-mode-cell"><div class="rank-help-keys"><code>1</code></div><div class="rank-help-desc">${this.CreateBilingualText('标准', 'Standard')}</div></div>
                                        <div class="rank-help-mode-cell"><div class="rank-help-keys"><code>2</code></div><div class="rank-help-desc">${this.CreateBilingualText('整场计划结束', 'Planned end')}</div></div>
                                        <div class="rank-help-mode-cell"><div class="rank-help-keys"><code>3</code></div><div class="rank-help-desc">${this.CreateBilingualText('正计时', 'Elapsed')}</div></div>
                                        <div class="rank-help-mode-cell"><div class="rank-help-keys"><code>4</code></div><div class="rank-help-desc">${this.CreateBilingualText('相对开赛', 'From start')}</div></div>
                                    </div>
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>H</code></div><div class="rank-help-desc">${this.CreateBilingualText('比赛标题 显示/隐藏', 'Show/Hide contest title')}</div></div>
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>S</code></div><div class="rank-help-desc">${this.CreateBilingualText('赛段说明 显示/隐藏', 'Show/Hide phase line')}</div></div>
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>−</code><code>=</code><code>+</code></div><div class="rank-help-desc">${this.CreateBilingualText('主倒计时数字缩放（小键盘 ± 亦可）', 'Resize main countdown (numpad ±)')}</div></div>
                                    <div class="rank-help-row"><div class="rank-help-keys"><code>\\</code></div><div class="rank-help-desc">${this.CreateBilingualText('数字恢复默认字号', 'Reset countdown size')}</div></div>
                                </div>
                            </section>
                            <section class="rank-help-panel rank-help-panel--span">
                                <h4 class="rank-help-panel-title">${this.CreateBilingualText('自动滚动开时 · 数字键', 'Auto-scroll on · Keys')}</h4>
                                <p class="rank-help-lead">${this.CreateBilingualText('全屏计时器关闭时，数字 1～3 才用于滚动；计时器打开时 1～4 用于计时方式（见上栏）。', '1–3 scroll only while timer is off; 1–4 pick layouts when timer is on.')}</p>
                                <div class="rank-help-rows rank-help-rows--inline">
                                    <div class="rank-help-row rank-help-row--narrow"><div class="rank-help-keys"><code>1</code></div><div class="rank-help-desc">${this.CreateBilingualText('慢滚', 'Slow')}</div></div>
                                    <div class="rank-help-row rank-help-row--narrow"><div class="rank-help-keys"><code>2</code></div><div class="rank-help-desc">${this.CreateBilingualText('半页', 'Half-page')}</div></div>
                                    <div class="rank-help-row rank-help-row--narrow"><div class="rank-help-keys"><code>3</code></div><div class="rank-help-desc">${this.CreateBilingualText('单行', 'Single row')}</div></div>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            `;
            this.container.appendChild(helpModal);

            const filterModal = document.createElement('div');
            filterModal.id = 'rank-filter-modal';
            filterModal.className = 'modal-overlay';
            filterModal.style.display = 'none';
            filterModal.innerHTML = `
                <div class="modal-content rank-filter-modal-content">
                    <div class="modal-header">
                        <h3>${this.CreateBilingualText('高级筛选', 'Advanced Filters')}</h3>
                        <button id="close-rank-filter" class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body rank-filter-modal-body">
                        <div class="filter-grid">
                            <div class="filter-card filter-card-star">
                                <div class="filter-card-title">${this.CreateBilingualText('打星视图', 'Star Mode')}</div>
                                <select id="filter-star-mode-select" class="form-select form-select-sm">
                                    <option value="0">打星不排名 / Star No Rank</option>
                                    <option value="1">不含打星 / Exclude Star</option>
                                    <option value="2">打星参与排名 / Star Participate</option>
                                </select>
                            </div>
                            <div class="filter-card filter-card-school">
                                <div class="filter-card-title">${this.CreateBilingualText('学校/组织 名筛选', 'School filter')}</div>
                                <div class="filter-search-wrapper">
                                    <input id="filter-school-search" class="form-control form-control-sm filter-search-input" type="text" placeholder="搜索学校 / Search school" autocomplete="off">
                                    <div class="filter-candidates filter-candidates-dropdown" id="filter-school-candidates"></div>
                                </div>
                                <div class="filter-tags" id="filter-school-tags"></div>
                            </div>
                            <div class="filter-card filter-card-team">
                                <div class="filter-card-title">${this.CreateBilingualText('队伍名筛选', 'Team filter')}</div>
                                <div class="filter-search-wrapper">
                                    <input id="filter-team-search" class="form-control form-control-sm filter-search-input" type="text" placeholder="ID、队名、译名、学校、教练、队员 / ID, names, school, coach, roster" autocomplete="off">
                                    <div class="filter-candidates filter-candidates-dropdown" id="filter-team-candidates"></div>
                                </div>
                                <div class="filter-tags" id="filter-team-tags"></div>
                            </div>
                            <div class="filter-card filter-card-group ${this.IsMultiGroupEnabled() ? '' : 'd-none'}" id="filter-group-card">
                                <div class="filter-card-title">${this.CreateBilingualText('赛事归属筛选', 'Affiliation Filter')}</div>
                                <div class="filter-actions">
                                    <button class="btn btn-outline-secondary btn-sm" id="filter-group-select-all">全选<span class="en-text">All</span></button>
                                    <button class="btn btn-outline-secondary btn-sm" id="filter-group-clear">清空<span class="en-text">None</span></button>
                                </div>
                                <select id="filter-group-select" class="form-select form-select-sm" multiple size="6"></select>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer rank-filter-footer">
                        <button class="btn btn-outline-secondary btn-sm" id="cancel-rank-filter">取消<span class="en-text">Cancel</span></button>
                        <button class="btn btn-primary btn-sm" id="apply-rank-filter">应用筛选<span class="en-text">Apply</span></button>
                    </div>
                </div>
            `;
            this.container.appendChild(filterModal);
            
            // 全屏计时遮罩（独立模块，rank_tool.js）
            this.timeOverlay = RankToolCreateTimeOverlay(this.container);
        }
        InitElements() {
            // 获取 header 元素（在容器外部）
            const header = this.GetHeaderElement();
            
            this.elements = {
                pageTitle: header ? header.querySelector('#rank-page-title') : null,
                rankModeIndicator: header ? header.querySelector('#rank-mode-indicator') : null,
                starMode: header ? header.querySelector('#star-mode') : null,
                refreshBtn: header ? header.querySelector('#refresh-btn') : null,
                summaryBtn: header ? header.querySelector('#summary-btn') : null,
                filterBtn: header ? header.querySelector('#filter-btn') : null,
                filterQuickInfo: header ? header.querySelector('#filter-quick-info') : null,
                fullscreenBtn: header ? header.querySelector('#fullscreen-btn') : null,
                rankGrid: this.container.querySelector('#rank-grid'),
                loading: this.container.querySelector('#loading'),
                rankSkinBusy: document.getElementById('rank-skin-busy'),
                summaryModal: this.container.querySelector('#summary-modal'),
                summaryContent: this.container.querySelector('#summary-content'),
                closeSummary: this.container.querySelector('#close-summary'),
                closeAward: this.container.querySelector('#close-award'),
                helpModal: this.container.querySelector('#rank-help-modal'),
                closeHelp: this.container.querySelector('#close-rank-help'),
                filterModal: this.container.querySelector('#rank-filter-modal'),
                closeFilter: this.container.querySelector('#close-rank-filter'),
                cancelFilter: this.container.querySelector('#cancel-rank-filter'),
                applyFilter: this.container.querySelector('#apply-rank-filter'),
                filterStarModeSelect: this.container.querySelector('#filter-star-mode-select'),
                filterSchoolSearch: this.container.querySelector('#filter-school-search'),
                filterTeamSearch: this.container.querySelector('#filter-team-search'),
                filterSchoolCandidates: this.container.querySelector('#filter-school-candidates'),
                filterTeamCandidates: this.container.querySelector('#filter-team-candidates'),
                filterSchoolTags: this.container.querySelector('#filter-school-tags'),
                filterTeamTags: this.container.querySelector('#filter-team-tags'),
                filterGroupSelect: this.container.querySelector('#filter-group-select'),
                filterGroupCard: this.container.querySelector('#filter-group-card'),
                filterGroupSelectAll: this.container.querySelector('#filter-group-select-all'),
                filterGroupClear: this.container.querySelector('#filter-group-clear'),
                helpBtn: header ? header.querySelector('#help-btn') : null,
                // 响应式折叠相关
                headerControls: header ? header.querySelector('#header-controls') : null,
                foldBtn: header ? header.querySelector('#fold-btn') : null,
                controlsDropdown: header ? header.querySelector('#controls-dropdown') : null,
                starModeDropdown: header ? header.querySelector('#star-mode-dropdown') : null,
                // 自定义下拉组件
                starModeBtn: header ? header.querySelector('#star-mode-btn') : null,
                starModeDropdown: header ? header.querySelector('#star-mode-dropdown') : null,
                starModeDropdownBtn: header ? header.querySelector('#star-mode-dropdown-btn') : null,
                starModeDropdownDropdown: header ? header.querySelector('#star-mode-dropdown-dropdown') : null,
                rankModeBtn: header ? header.querySelector('#rank-mode-btn') : null,
                rankSkinBtn: header ? header.querySelector('#rank-skin-btn') : null,
            };
            // 创建 学校/组织 信息元素
            this.CreateSchoolInfo();
        }
        IsMultiGroupEnabled() {
            const contest = this.data?.contest || {};
            const cnt = parseInt(this.data?.group_count || contest.group_count || 0);
            const flag = parseInt(this.data?.is_multi_group || contest.is_multi_group || 0);
            return flag === 1 || cnt > 1;
        }
        GetContestGroups() {
            const contest = this.data?.contest || {};
            const groups = Array.isArray(this.data?.contest_group)
                ? this.data.contest_group
                : (Array.isArray(contest.contest_group) ? contest.contest_group : []);
            return groups.filter(g => g && g.group_id);
        }
        NormalizeTeamIdLike(raw) {
            const s = String(raw || '');
            if (!s) return '';
            if (s.startsWith('#cpc') && s.includes('_')) {
                return s.split('_').slice(1).join('_');
            }
            return s;
        }
        GetDefaultSelectedGroupIds() {
            const groups = this.GetContestGroups();
            if (groups.length === 0) return [];
            const allIds = groups.map((g) => String(g.group_id)).filter(Boolean);
            const allGroupSet = new Set(allIds);
            if (allIds.length <= 1) {
                return allIds.slice();
            }
            const staffAll = parseInt(
                this.data?.rank_group_staff_default_all ?? this.data?.contest?.rank_group_staff_default_all ?? 0,
                10
            ) === 1;
            if (staffAll) {
                return allIds.slice();
            }
            const contestUserRaw = this.data?.contest_user || this.data?.contest?.contest_user || '';
            const contestUser = this.NormalizeTeamIdLike(contestUserRaw);
            const team = contestUser && this.teamMap ? this.teamMap[contestUser] : null;
            if (team) {
                const explicit = team.group_ids_explicit === true || team.group_ids_explicit === 1;
                const gids = (Array.isArray(team.group_ids) ? team.group_ids : [])
                    .map((gid) => String(gid))
                    .filter((gid) => allGroupSet.has(gid));
                if (!explicit) {
                    return allIds.slice();
                }
                if (gids.length > 0) {
                    return gids.slice().sort();
                }
                return allIds.slice();
            }
            return allIds.slice();
        }
        EnsureGroupSelection() {
            const groups = this.GetContestGroups();
            if (groups.length === 0) {
                this.selectedGroupIds = [];
                return;
            }
            const allGroupSet = new Set(groups.map((g) => String(g.group_id)));
            let selected = Array.isArray(this.selectedGroupIds)
                ? this.selectedGroupIds.map((gid) => String(gid)).filter((gid) => allGroupSet.has(gid))
                : [];
            if (selected.length === 0) {
                selected = this.GetDefaultSelectedGroupIds().map((gid) => String(gid));
            }
            this.selectedGroupIds = selected;
            const select = this.elements?.filterGroupSelect;
            if (select) {
                Array.from(select.options).forEach(op => {
                    op.selected = selected.includes(op.value);
                });
            }
        }

        /**
         * 多赛事归属：把「当前允许的归属 id 列表」写入 selectedGroupIds，供 FilterByStarMode / UpdateRank 做 OR 过滤。
         * 颁奖页、滚榜筛选等外部 UI 应通过本方法与榜单筛选共用一套语义，避免各模块自管一套 id 与 rankList 脱节。
         * @param {string[]} ids 选中的 group_id；空或全无效时退化为「全部归属」
         */
        ApplyContestGroupFilterForRanking(ids) {
            if (!this.IsMultiGroupEnabled()) {
                return;
            }
            const groups = this.GetContestGroups();
            if (!groups.length) {
                return;
            }
            const all = groups.map((g) => String(g.group_id)).filter(Boolean);
            const allSet = new Set(all);
            let next = (Array.isArray(ids) ? ids : []).map((x) => String(x)).filter((id) => allSet.has(id));
            if (next.length === 0) {
                next = all.slice();
            }
            this.selectedGroupIds = next;
        }
        BuildGroupFilterOptions() {
            const groups = this.GetContestGroups();
            const select = this.elements.filterGroupSelect;
            if (!select) return;
            select.innerHTML = '';
            groups.forEach(g => {
                const op = document.createElement('option');
                op.value = g.group_id;
                op.textContent = g.group_name || g.group_id;
                select.appendChild(op);
            });
            this.EnsureGroupSelection();
        }
        // 初始化所有懒加载功能
        InitLazyLoaders() {
            this.InitSchoolLogoLoader();
            this.InitFlagLoader();
        }
        // 通用懒加载初始化方法
        InitImageLoader(config) {
            const {
                type,
                baseUrl,
                fetchFn,
                calculateFn,
                onSuccess,
                onError,
                selector,
                attributeName,
                observerProperty,
                baseProperty
            } = config;
            // 设置基础URL
            this[baseProperty] = baseUrl;
            // 使用统一的缓存管理器
            const getFn = (key) => this.logoCache.get(key);
            const setFn = (key, val, expire) => this.logoCache.set(key, val, expire);
            // 创建懒加载观察器
            this[observerProperty] = this.CreateImageLazyLoader({
                type: type,
                getFn: getFn,
                setFn: setFn,
                baseUrl: baseUrl,
                fetchFn: fetchFn,
                calculateFn: calculateFn,
                onSuccess: onSuccess,
                onError: onError
            });
            // 延迟观察，确保DOM元素已创建
            setTimeout(() => {
                this.container.querySelectorAll(selector).forEach(element => {
                    const identifier = element.getAttribute(attributeName);
                    if (identifier && !element.dataset.observed) {
                        this[observerProperty].observe(element);
                        element.dataset.observed = 'true';
                    }
                });
            }, 100);
        }
        // 初始化学校logo懒加载
        InitSchoolLogoLoader() {
            this.InitImageLoader({
                type: 'logo',
                baseUrl: this.config.school_badge_url || '/static/image/school_badge',
                fetchFn: this.FetchSchoolLogoDataUrl.bind(this),
                onError: () => {
                    // logo 加载失败时保持透明，不处理
                },
                selector: '.school-logo',
                attributeName: 'data-school',
                observerProperty: '_logoObserver',
                baseProperty: '_logoBase'
            });
        }
        // 初始化旗帜懒加载
        InitFlagLoader() {
            this.InitImageLoader({
                type: 'flag',
                baseUrl: this.config.region_flag_url || '/static/image/region_flag',
                fetchFn: this.FetchFlagDataUrl.bind(this),
                calculateFn: this.CalculateFlagUrl.bind(this),
                onSuccess: (element, dataUrl) => {
                    // 旗帜加载成功，显示旗帜
                    this.ShowFlag(element);
                },
                onError: (element) => {
                    // // 旗帜加载失败，显示地区名
                    // this.ShowRegionText(element, element.getAttribute('data-flag'));
                },
                selector: 'img.flag-icon',
                attributeName: 'data-flag',
                observerProperty: '_flagObserver',
                baseProperty: '_flagBase'
            });
        }
        async FetchSchoolLogoDataUrl(fileKey) {
            // 检查离线图片数据（优先使用，避免CORS问题）
            if (window.OFFLINE_IMAGES?.school_badge) {
                // fileKey格式：baseUrl/school，需要提取school名
                const baseUrl = this.config.school_badge_url || '/static/image/school_badge';
                // 移除baseUrl和末尾的图片扩展名（如果有）
                let schoolKey = fileKey.replace(baseUrl + '/', '').replace(/\.(jpg|webp)$/, '');
                // schoolKey可能是URL编码后的，先尝试直接查找
                let base64Data = window.OFFLINE_IMAGES.school_badge[schoolKey];
                // 如果没找到，尝试URL编码后查找
                if (!base64Data && schoolKey !== encodeURIComponent(schoolKey)) {
                    schoolKey = encodeURIComponent(schoolKey);
                    base64Data = window.OFFLINE_IMAGES.school_badge[schoolKey];
                }
                // 如果还是没找到，尝试解码后查找（处理已经编码的key）
                if (!base64Data) {
                    try {
                        const decodedKey = decodeURIComponent(schoolKey);
                        base64Data = window.OFFLINE_IMAGES.school_badge[decodedKey];
                    } catch (e) {
                        // 解码失败，继续尝试在线加载
                    }
                }
                if (base64Data) {
                    return base64Data; // 直接返回base64 data URL
                }
            }
            
            // 离线模式没有找到，尝试在线加载（用于在线模式的fallback）
            const tryList = ['webp'];
            for (let i = 0; i < tryList.length; i++) {
                const url = `${fileKey}.${tryList[i]}`;
                try {
                    const resp = await fetch(url, { cache: 'force-cache' });
                    if (!resp.ok) continue;
                    const blob = await resp.blob();
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    return dataUrl;
                } catch (e) {
                    // try next ext
                }
            }
            throw new Error('No valid school logo');
        }
        CreateSchoolInfo() {
            const schoolInfo = document.createElement('div');
            schoolInfo.id = 'school-info';
            schoolInfo.className = 'school-info';
            schoolInfo.style.display = 'none';
            schoolInfo.innerHTML = `<h4>每校Top <span id="top-team-count">1</span> 队伍（合并）计入${this.CreateBilingualText('', 'Top <span id="top-team-count-en">1</span> teams per school (merged)')}</h4>`;
            // 插入到榜单容器之前
            const rankContainer = this.container.querySelector('.rank-container');
            if (rankContainer && rankContainer.parentNode) {
                rankContainer.parentNode.insertBefore(schoolInfo, rankContainer);
            } else {
                // 如果找不到rank-container，直接添加到容器中
                this.container.appendChild(schoolInfo);
            }
            this.elements.schoolInfo = schoolInfo;
            this.elements.topTeamCount = this.container.querySelector('#top-team-count');
            this.elements.topTeamCountEn = this.container.querySelector('#top-team-count-en');
        }
        // #########################################
        //  事件绑定模块
        // #########################################
        BindEvents() {
            this.BindHeaderEvents();
            // 模态框关闭
            if (this.elements.closeSummary) {
                this.elements.closeSummary.addEventListener('click', () => this.HideModal('summary'));
            }
            if (this.elements.closeHelp) {
                this.elements.closeHelp.addEventListener('click', () => this.HideModal('help'));
            }
            if (this.elements.closeFilter) {
                this.elements.closeFilter.addEventListener('click', () => this.HideModal('filter'));
            }
            if (this.elements.cancelFilter) {
                this.elements.cancelFilter.addEventListener('click', () => this.HideModal('filter'));
            }
            if (this.elements.applyFilter) {
                this.elements.applyFilter.addEventListener('click', () => this.ApplyFilterModal());
            }
            if (this.elements.filterGroupSelectAll) {
                this.elements.filterGroupSelectAll.addEventListener('click', () => {
                    const select = this.elements.filterGroupSelect;
                    if (!select) return;
                    Array.from(select.options).forEach(op => { op.selected = true; });
                });
            }
            if (this.elements.filterGroupClear) {
                this.elements.filterGroupClear.addEventListener('click', () => {
                    const select = this.elements.filterGroupSelect;
                    if (!select) return;
                    const first = select.options[0] ? select.options[0].value : '';
                    Array.from(select.options).forEach(op => { op.selected = (op.value === first); });
                });
            }
            this.SetupFilterSearchDropdown(
                this.elements.filterSchoolSearch,
                this.elements.filterSchoolCandidates,
                () => this.UpdateSchoolCandidates()
            );
            this.SetupFilterSearchDropdown(
                this.elements.filterTeamSearch,
                this.elements.filterTeamCandidates,
                () => this.UpdateTeamCandidates()
            );
            // 帮助按钮
            if (this.elements.helpBtn) {
                this.AddButtonEventListeners(this.elements.helpBtn, () => this.ShowHelp());
            }
            // 点击模态框背景关闭
            if (this.elements.helpModal) {
                this.elements.helpModal.addEventListener('click', (e) => {
                    if (e.target === this.elements.helpModal) this.HideModal('help');
                });
            }
            if (this.elements.filterModal) {
                this.elements.filterModal.addEventListener('click', (e) => {
                    if (e.target === this.elements.filterModal) this.HideModal('filter');
                });
            }
            // 页面可见性：后台暂停自动刷新
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
                } else {
                    const pollMs = typeof this.GetAutoRefreshIntervalMs === 'function' ? this.GetAutoRefreshIntervalMs() : 60000;
                    const allow = typeof this.ShouldScheduleAutoRefreshInterval !== 'function' || this.ShouldScheduleAutoRefreshInterval();
                    if (!this.refreshInterval && this.autoRefresh && allow && pollMs > 0) {
                        this.refreshInterval = setInterval(() => this.LoadData(), pollMs);
                    }
                }
            });
            // 全局快捷键（只绑一次，避免 RecreateHeader 后重复绑定导致 H 等键失效）
            document.addEventListener('keydown', (e) => this.HandleKeydown(e));
        }
        // 绑定header相关事件
        BindHeaderEvents() {
            if (this.currentMode !== "roll") {
                this.SetupCustomSelect("rank-mode", (value) => {
                    this.SwitchMode(value === "school" ? "school" : "team");
                });
            }
            this.EnsureRankSkinSelectBound();
            const header = this.GetHeaderElement();
            const headerBtns = (sel) => Array.from(header ? header.querySelectorAll(sel) : []);
            // 刷新 / 统计 / 全屏 / 帮助 / 筛选：各控件在配对 `.rank-header` 内可能各有两份（工具栏 + 折叠菜单）
            headerBtns('#refresh-btn').forEach((btn) => this.AddButtonEventListeners(btn, () => this.RefreshData()));
            headerBtns('#summary-btn').forEach((btn) => this.AddButtonEventListeners(btn, () => this.ShowSummary()));
            headerBtns('#fullscreen-btn').forEach((btn) => this.AddButtonEventListeners(btn, () => this.ToggleFullscreen()));
            headerBtns('#help-btn').forEach((btn) => this.AddButtonEventListeners(btn, () => this.ShowHelp()));
            headerBtns('#filter-btn').forEach((btn) => this.AddButtonEventListeners(btn, () => this.ShowFilterModal()));
            // 为按钮添加tooltip
            this.AddButtonTooltips();
            // 时间进度条事件绑定（如果启用，不包含初始化）
            if (this.config.flg_show_time_progress !== false) {
                this.BindTimeProgressEvents();
            }
            this.BindRankModeIndicatorXlsxEaster();
            // 全屏事件绑定
            this.BindFullscreenEvents();
            
            // 折叠按钮事件处理（header 与 `#${containerId}` 兄弟）
            const toggleBtn = header ? header.querySelector('#controls-toggle-btn') : null;
            const dropdown = header ? header.querySelector('#controls-dropdown') : null;
            
            if (toggleBtn && dropdown) {
                // 点击切换下拉菜单
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dropdown.classList.toggle('show');
                });
                
                // 点击外部关闭下拉菜单
                const closeDropdown = (e) => {
                    if (!dropdown.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
                        dropdown.classList.remove('show');
                    }
                };
                document.addEventListener('click', closeDropdown);
                
                // 窗口大小改变时，如果从窄屏变为宽屏，自动关闭下拉菜单
                let resizeTimer = null;
                window.addEventListener('resize', () => {
                    clearTimeout(resizeTimer);
                    resizeTimer = setTimeout(() => {
                        if (window.innerWidth > 1024) {
                            dropdown.classList.remove('show');
                        }
                    }, 100);
                });
            }
            // 为 header 内的按钮等元素绑定动态 tooltip（header 在容器外，需单独绑定）
            if (header) this.SetupDynamicTooltips(header);
        }
        // 为div按钮添加事件监听器（点击和键盘）
        AddButtonEventListeners(button, callback) {
            if (!button) return;
            // 点击事件
            button.addEventListener('click', callback);
            // 键盘事件
            button.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    callback();
                }
            });
        }
        /** 皮肤下拉：滚榜工具栏晚于 BindHeaderEvents 插入 DOM；RankRollSystem.createUI 末尾会再调本方法与 ApplyRankSkin。 */
        EnsureRankSkinSelectBound() {
            const btn = document.querySelector("#rank-skin-btn");
            const dropdown = document.querySelector("#rank-skin-dropdown");
            if (!btn || !dropdown || btn.dataset.csgRankSkinBound === "1") {
                return;
            }
            btn.dataset.csgRankSkinBound = "1";
            // 换肤逻辑在 SelectCustomOption(rank-skin) 内统一处理（先遮罩、更新按钮 DOM、再双 rAF 应用样式）
            this.SetupCustomSelect("rank-skin", null);
        }
        // 设置自定义下拉组件
        SetupCustomSelect(selectId, onChange) {
            // header 现在在容器外部，使用 document.querySelector
            const btn = document.querySelector(`#${selectId}-btn`);
            const dropdown = document.querySelector(`#${selectId}-dropdown`);
            if (!btn || !dropdown) return;
            // 按钮点击事件
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.ToggleCustomSelect(selectId);
            });
            // 键盘事件
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.ToggleCustomSelect(selectId);
                }
            });
            // 为自定义选择按钮单独处理tooltip
            btn.addEventListener('mouseover', (e) => {
                const titlecn = btn.getAttribute('title-cn');
                const titleen = btn.getAttribute('title-en');
                if (titlecn || titleen) {
                    // 初始化tooltipTimeouts
                    if (!this.tooltipTimeouts) {
                        this.tooltipTimeouts = {};
                    }
                    // 清除之前的延迟
                    if (this.tooltipTimeouts[btn]) {
                        clearTimeout(this.tooltipTimeouts[btn]);
                    }
                    // 延迟显示tooltip
                    this.tooltipTimeouts[btn] = setTimeout(() => {
                        this.ShowTooltipForElement(btn, titlecn, titleen);
                    }, 300);
                }
            });
            btn.addEventListener('mouseout', (e) => {
                // 清除延迟
                if (this.tooltipTimeouts && this.tooltipTimeouts[btn]) {
                    clearTimeout(this.tooltipTimeouts[btn]);
                }
                // 延迟隐藏tooltip
                setTimeout(() => {
                    this.HideGlobalTooltip();
                }, 100);
            });
            // 选项点击事件
            dropdown.addEventListener('click', (e) => {
                const option = e.target.closest('.custom-select-option');
                if (option) {
                    const value = option.getAttribute('data-value');
                    this.SelectCustomOption(selectId, value, onChange);
                }
            });
            // 点击外部关闭
            document.addEventListener('click', (e) => {
                if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
                    this.CloseCustomSelect(selectId);
                }
            });
        }
        // 切换自定义下拉组件
        ToggleCustomSelect(selectId) {
            const btn = document.querySelector(`#${selectId}-btn`);
            const dropdown = document.querySelector(`#${selectId}-dropdown`);
            if (!btn || !dropdown) return;
            const isOpen = dropdown.classList.contains('show');
            // 关闭所有其他下拉组件
            this.CloseAllCustomSelects();
            if (!isOpen) {
                dropdown.classList.add('show');
                btn.classList.add('active');
            }
        }
        // 选择自定义选项
        SelectCustomOption(selectId, value, onChange) {
            const btn = document.querySelector(`#${selectId}-btn`);
            const dropdown = document.querySelector(`#${selectId}-dropdown`);
            if (!btn || !dropdown) return;
            let rankSkinChanged = false;
            if (selectId === 'rank-skin') {
                const next = RankSkinNormalize(value);
                rankSkinChanged = next !== this.rankSkin;
                if (rankSkinChanged) {
                    this.rankSkin = next;
                    this.ShowRankSkinBusyOverlay('skin');
                }
            }
            const options = dropdown.querySelectorAll('.custom-select-option');
            // 更新选中状态
            options.forEach(option => {
                option.classList.remove('selected');
                if (option.getAttribute('data-value') === value) {
                    option.classList.add('selected');
                }
            });
            // 更新按钮显示
            const selectedOption = dropdown.querySelector(`[data-value="${value}"]`);
            if (selectedOption) {
                const iconElement = selectedOption.querySelector('i');
                const icon = iconElement ? iconElement.outerHTML : '';
                const titlecn = selectedOption.getAttribute('title-cn');
                const titleen = selectedOption.getAttribute('title-en');
                // 检查按钮是否带文字（用于下拉菜单）
                const hasText = btn.querySelector('.option-text');
                if (hasText) {
                    // 带文字的按钮：更新图标和文字
                    const optionText = selectedOption.querySelector('.option-text');
                    btn.innerHTML = icon + (optionText ? optionText.outerHTML : '');
                } else {
                    // 仅图标按钮：只更新图标
                    btn.innerHTML = icon;
                }
                btn.setAttribute('title-cn', titlecn);
                btn.setAttribute('title-en', titleen);
            }
            // 关闭下拉菜单
            this.CloseCustomSelect(selectId);
            if (selectId === 'rank-skin' && rankSkinChanged) {
                this.ScheduleRankSkinApplyAndHideBusy();
            }
            // 触发回调
            if (onChange) {
                onChange(value);
            }
        }
        // 关闭自定义下拉组件
        CloseCustomSelect(selectId) {
            const btn = document.querySelector(`#${selectId}-btn`);
            const dropdown = document.querySelector(`#${selectId}-dropdown`);
            if (btn) btn.classList.remove('active');
            if (dropdown) dropdown.classList.remove('show');
        }
        // 关闭所有自定义下拉组件
        CloseAllCustomSelects() {
            const allDropdowns = document.querySelectorAll('.custom-select-dropdown');
            const allBtns = document.querySelectorAll('.custom-select-btn');
            allDropdowns.forEach(dropdown => dropdown.classList.remove('show'));
            allBtns.forEach(btn => btn.classList.remove('active'));
        }
        // 为按钮添加tooltip
        AddButtonTooltips() {
            const buttons = [
                this.elements.summaryBtn,
                this.elements.filterBtn,
                this.elements.fullscreenBtn
            ];
            // 不再需要，全局tooltip系统会自动处理所有元素的tooltip
            // 点击模态框背景关闭
            this.elements.summaryModal.addEventListener('click', (e) => {
                if (e.target === this.elements.summaryModal) this.HideModal('summary');
            });
        }
        // #########################################
        //  数据加载和处理模块
        // 用途：通用逻辑（适用于所有功能：队伍榜、学校榜、统计、滚榜）
        // #########################################

        /**
         * naive / wire 时间串 → UTC 毫秒（与后端 time_context、CsgWireInstantMs 一致）。
         * @param {string} s
         * @returns {number}
         */
        _rankWireInstantMs(s) {
            const tc = this._rankTimeContext && typeof this._rankTimeContext === 'object' ? this._rankTimeContext : {};
            const appTz = typeof CsgGetAppTimezone === 'function' ? CsgGetAppTimezone() : '';
            if (typeof CsgWireInstantMs === 'function') {
                const m = CsgWireInstantMs(s, tc, appTz || null);
                if (Number.isFinite(m)) {
                    return m;
                }
            }
            const d = new Date(s);
            const t = d.getTime();
            return Number.isFinite(t) ? t : NaN;
        }
        /**
         * @param {string} s
         * @returns {Date}
         */
        _rankNaiveSqlToDate(s) {
            const ms = this._rankWireInstantMs(s);
            return Number.isFinite(ms) ? new Date(ms) : new Date(NaN);
        }

        OriInit(raw_data) {
            const oriT0 = this._rankPerfEnabled() ? performance.now() : 0;
            this.data = raw_data;
            this._rankTimeContext =
                raw_data && typeof raw_data.time_context === 'object' && raw_data.time_context !== null
                    ? raw_data.time_context
                    : {};
            if (this._rankPerfEnabled()) {
                this._rankPerfLog('OriInit:start', { cumOriMs: '0.0' });
            }
            // 将 list 格式转换为 dict 格式
            this.ConvertListToDict();
            if (this._rankPerfEnabled()) {
                this._rankPerfLog('OriInit:after_convertListToDict', { cumOriMs: (performance.now() - oriT0).toFixed(1) });
            }
            this.ProcessData();
            if (this._rankPerfEnabled()) {
                this._rankPerfLog('OriInit:after_processData', {
                    cumOriMs: (performance.now() - oriT0).toFixed(1),
                    rankListLen: this.rankList && this.rankList.length,
                });
            }
            this.BuildGroupFilterOptions();
            this.EnsureGroupSelection();
            if (this.elements.filterGroupCard) {
                this.elements.filterGroupCard.classList.toggle('d-none', !this.IsMultiGroupEnabled());
            }
            this.UpdateFilterQuickInfo();
            if (this._rankPerfEnabled()) {
                this._rankPerfLog('OriInit:after_filter_ui', { cumOriMs: (performance.now() - oriT0).toFixed(1) });
            }
            if (!this.externalMode) {
                this.UpdatePageTitle();
                // 数据加载完成后，重新创建表头以包含题目列
                this.RecreateHeaderRow();
                if (this._rankPerfEnabled()) {
                    this._rankPerfLog('OriInit:after_recreateHeaderRow', { cumOriMs: (performance.now() - oriT0).toFixed(1) });
                }
                // 初始化时间进度条（如果启用）
                if (this.config.flg_show_time_progress !== false) {
                    this.InitializeTimeProgress();
                }
                if (this._rankPerfEnabled()) {
                    this._rankPerfLog('OriInit:before_hide_loading', { cumOriMs: (performance.now() - oriT0).toFixed(1) });
                }
                // 先收起全屏蒙层：表头与工具栏立即可用；榜单行由 UpdateRank → RenderRank 分帧续画
                this.HideLoading();
                this.isInitialLoad = false;
                // 处理 Rank 模式：打星显示模式、队排/滚榜/校排，会执行RenderRank（内含 UpdateAwardInfo）
                this.UpdateRank();
            } else {
                if (this.rankList.length) {
                    this.UpdateAwardInfo();
                }
                this.HideLoading();
                this.isInitialLoad = false;
            }
            if (this._rankPerfEnabled()) {
                this._rankPerfLog('OriInit:after_updateRank_sync', { cumOriMs: (performance.now() - oriT0).toFixed(1) });
            }
            this._syncRankContestTimerOverlayAfterContestDataRefresh();
            if (this._rankPerfEnabled()) {
                this._rankPerfLog('OriInit:done', { cumOriMs: (performance.now() - oriT0).toFixed(1) });
            }
        }
        /**
         * 是否由本类自行 `setInterval(LoadData)`。综合 HUD 嵌入榜由 `contestlive_hud_data` 同源拉取后调用
         * `applyFreshContestData`，此处返回 false 以免与 visibility / A 键逻辑叠出二次 HTTP。
         */
        ShouldScheduleAutoRefreshInterval() {
            return true;
        }
        /**
         * 注入与 `contest_data_ajax` 成功响应 `data` 同形的数据，走 `OriInit` 全链路，不发起网络请求。
         * 须深拷贝：`OriInit` → `ConvertListToDict` 会就地改写 team/problem/solution 行结构，避免与 HUD 等调用方共用引用时破坏其 list 解析。
         */
        applyFreshContestData(raw_data) {
            if (!raw_data || this.externalMode) {
                return;
            }
            let payload = raw_data;
            try {
                payload =
                    typeof structuredClone === 'function'
                        ? structuredClone(raw_data)
                        : JSON.parse(JSON.stringify(raw_data));
            } catch (eClone) {
                console.error('[RankSystem] applyFreshContestData clone failed', eClone);
                return;
            }
            // 勿在 OriInit 之前置 isInitialLoad=false：OriInit 内 HideLoading 依赖仍为 true 才收起首屏蒙层；
            // HUD 同源包若先于本类 LoadData 返回，否则蒙层永不收起（仅清刷新按钮动效）。
            this.OriInit(payload);
        }
        async LoadData() {
            try {
                this._rankPerfReset('LoadData');
                this._rankPerfLog('LoadData:entry', {
                    key: this.key,
                    flg_rank_cache: !!this.config.flg_rank_cache,
                });
                this.ShowLoading();
                const cacheKey = `${this.key}_data_v2`;
                // 如果启用缓存，尝试从缓存加载数据（30秒过期）
                if (this.config.flg_rank_cache) {
                    const tIdb = performance.now();
                    const cachedData = await this.cache.get(cacheKey);
                    this._rankPerfLog('LoadData:after_idb_get', {
                        ms: (performance.now() - tIdb).toFixed(1),
                        hit: !!cachedData,
                    });
                    if (cachedData) {
                        this.OriInit(cachedData);
                        return;
                    }
                }
                
                const apiUrl = this.config.api_url;
                
                // 判断 api_url 是数据对象还是 URL 字符串
                // 如果是对象（离线模式，数据已从 data.js 加载），直接使用
                if (typeof apiUrl === 'object' && apiUrl !== null && !Array.isArray(apiUrl)) {
                    // 检查是否包含比赛数据的字段（contest, team, problem, solution）
                    if (apiUrl.contest || apiUrl.team || apiUrl.problem || apiUrl.solution) {
                        // 这是数据对象，直接使用
                        this.data = apiUrl;
                        // 如果启用缓存，使用缓存管理器保存数据，30秒过期
                        if (this.config.flg_rank_cache) {
                            await this.cache.set(cacheKey, this.data, 30 * 1000);
                        }
                        this.OriInit(this.data);
                        return;
                    }
                }
                
                // 如果是字符串（URL），使用 fetch 请求
                if (typeof apiUrl === 'string') {
                    const params = {};
                    // 确保 cid 参数存在（从 cid_list 或 key 配置中获取）
                    // 注意：cid_list 可能是字符串或数字，需要转换为字符串
                    let cidValue = null;
                    if (this.config.cid_list !== undefined && this.config.cid_list !== null && this.config.cid_list !== '') {
                        cidValue = String(this.config.cid_list);
                    } else if (this.config.key !== undefined && this.config.key !== null && this.config.key !== '') {
                        // 如果没有 cid_list，尝试使用 key（通常是比赛ID）
                        cidValue = String(this.config.key);
                    }
                    
                    // 如果没有 cid 参数，无法继续请求
                    if (!cidValue) {
                        console.error('RankSystem LoadData: 缺少比赛ID参数', {
                            cid_list: this.config.cid_list,
                            key: this.config.key,
                            config: this.config
                        });
                        this.ShowError('缺少比赛ID参数');
                        return;
                    }
                    
                    params.cid = cidValue;
                    if (this.config.lvtk) {
                        params.lvtk = String(this.config.lvtk);
                    }

                    // 处理 info_need 数组（直接定义为数组）
                    params['info_need[]'] = [ // 键名带 []，配合函数内的处理生成正确格式
                        'solution',
                        'team',
                        'problem',
                        'contest'
                    ];
                      
                    const tHttp = performance.now();
                    const result = await this.GetRequest(apiUrl, params);
                    const sol = result && result.data && result.data.solution;
                    const solLen = Array.isArray(sol) ? sol.length : typeof sol === 'number' ? sol : 0;
                    this._rankPerfLog('LoadData:after_http', {
                        ms: (performance.now() - tHttp).toFixed(1),
                        code: result && result.code,
                        teams: result && result.data && result.data.team && result.data.team.length,
                        problems: result && result.data && result.data.problem && result.data.problem.length,
                        solutions: solLen,
                    });
                    if (result.code === 1) {
                        this.data = result.data;
                        // 如果启用缓存，使用缓存管理器保存数据，30秒过期
                        if (this.config.flg_rank_cache) {
                            await this.cache.set(cacheKey, this.data, 30 * 1000);
                        }
                        this.OriInit(result.data);
                    } else {
                        this.ShowError(result.msg || '数据加载失败');
                    }
                } else {
                    this.ShowError('无效的 api_url 配置');
                }
            } catch (error) {
                console.error('数据加载错误:', error);
                this.ShowError('网络错误，请检查连接');
            }
        }
        // 将 list 格式转换为 dict 格式
        ConvertListToDict() {
            if (!this.data) return;
            // 使用公共函数进行转换
            RankToolConvertListToDict(this.data);
        }
        
        // ********** 通用逻辑 - 数据处理 **********
        // 用途：处理原始数据，构建基础数据结构
        // 涉及功能：队伍榜、学校榜、统计、滚榜
        // 功能：处理题目映射、提交映射、队伍映射、一血计算、封榜标记（滚榜模式）
        ProcessData(flg_real_rank=false) {
            if (!this.data) return;
            const perf = this._rankPerfEnabled();
            const solRowsBeforePre = this.data.solution && Array.isArray(this.data.solution) ? this.data.solution.length : 0;
            let a0 = 0;
            let a1 = 0;
            let a2 = 0;
            let a3 = 0;
            let a4 = 0;
            let a5 = 0;
            let tCalc0 = 0;
            if (perf) {
                a0 = performance.now();
            }
            // 预处理数据：统一处理带"#"的ID格式
            this.PreprocessData();
            if (perf) {
                a1 = performance.now();
            }
            // 处理题目数据
            this.problemMap = {};
            this.data.problem.forEach(problem => {
                this.problemMap[problem.problem_id] = problem;
            });
            if (perf) {
                a2 = performance.now();
            }
            // 处理提交数据
            this.solutionMap = {};
            // 重置一血记录
            this.map_fb = { global: {}, regular: {} };
            let hadSolutionBranch = false;
            if (this.data.solution) {
                hadSolutionBranch = true;
                // 从根源上过滤掉无效的提交结果：
                // 0~3：等待评测或正在评测
                // >=11：无效状态
                // 只保留 result === 4 (AC) 或其他有效的结果状态 (4-10)
                this.data.solution = this.data.solution.filter(solution => {
                    const result = solution.result;
                    // 忽略 0~3 和 >=11 的结果，保留封榜结果
                    return result >= 4 && result < 11 || result < 0;
                });
                if (perf) {
                    a3 = performance.now();
                }
                // 按提交时间排序：全序须与 _rankWireInstantMs（time_context + CsgWireInstantMs）一致。
                // 先在每行物化一次瞬时毫秒再 sort，避免比较器内重复解析（O(n log n) 量级调用），罚时/展示仍用原 in_date 串。
                const solsForSort = this.data.solution;
                for (let si = 0; si < solsForSort.length; si++) {
                    const sol = solsForSort[si];
                    sol._rankOrderMs = this._rankWireInstantMs(sol.in_date);
                }
                solsForSort.sort((a, b) => {
                    const ma = a._rankOrderMs;
                    const mb = b._rankOrderMs;
                    if (ma !== mb) {
                        return ma - mb;
                    }
                    return (a.solution_id || 0) - (b.solution_id || 0); // 用 solution_id 排序，处理一血同时间多队的情况
                });
                if (perf) {
                    a4 = performance.now();
                }
                
                this.data.solution.forEach(solution => {
                    const team_id = solution.team_id; // 已经预处理过，直接使用
                    
                    // 如果处于回放模式，只处理回放时间之前的提交
                    if (this.timeReplayMode && this.replayTime) {
                        const submitTime = this._rankNaiveSqlToDate(solution.in_date);
                        if (submitTime > this.replayTime) {
                            return; // 跳过回放时间之后的提交
                        }
                    }
                    
                    if (!this.solutionMap[team_id]) {
                        this.solutionMap[team_id] = {
                            ac: {},
                            frozen: {},
                            problems: {}
                        };
                    }
                    const problemId = solution.problem_id;
                    const team_solutions = this.solutionMap[team_id];
                    
                    // 如果该题已有AC且AC已揭晓，忽略后续提交，已考虑是否frozen
                    if (team_solutions.ac[problemId]) {                        
                        return;     // 忽略 AC 后的提交
                    }
                    
                    // 初始化problems数组，按时间顺序记录一个队在特定题目的所有提交
                    if (!team_solutions.problems[problemId]) {
                        team_solutions.problems[problemId] = [];
                    }
                    team_solutions.problems[problemId].push(solution);
                    
                    // 判断这次提交是否是frozen
                    if (!flg_real_rank && this.IsFrozen(solution)) {
                        team_solutions.frozen[problemId] = true;
                        // frozen状态的提交，后续可能还有提交，不处理AC逻辑（因为还未揭晓）
                        return;
                    }
                    // 处理AC提交和一血计算
                    // 关键修正：只保留第一次AC的时间（最早的AC）
                    if (solution.result === 4) {
                        team_solutions.ac[problemId] = solution.in_date;
                        // 计算一血（First Blood）- 只用第一次AC计算一血
                        this.UpdateFirstBlood(team_id, problemId, solution.in_date);
                    }
                });
                for (let si = 0; si < solsForSort.length; si++) {
                    delete solsForSort[si]._rankOrderMs;
                }
                if (perf) {
                    a5 = performance.now();
                }
            } else if (perf) {
                a3 = a4 = a5 = performance.now();
            }
            // 计算排名数据
            if (perf) {
                tCalc0 = performance.now();
            }
            this.CalculateRank(flg_real_rank);
            if (perf) {
                const a6 = performance.now();
                const ms = (u, v) => +(v - u).toFixed(2);
                const teamN = Object.keys(this.teamMap).length;
                const probN = Object.keys(this.problemMap).length;
                const solN = this.data.solution && Array.isArray(this.data.solution) ? this.data.solution.length : 0;
                const solMapN = Object.keys(this.solutionMap).length;
                this._rankPerfLog('ProcessData:timing_ms', {
                    preprocess_ms: ms(a0, a1),
                    problem_map_ms: ms(a1, a2),
                    solution_filter_ms: hadSolutionBranch ? ms(a2, a3) : 0,
                    solution_sort_ms: hadSolutionBranch ? ms(a3, a4) : 0,
                    solution_scan_ms: hadSolutionBranch ? ms(a4, a5) : 0,
                    calculate_rank_ms: ms(tCalc0, a6),
                    processData_total_ms: ms(a0, a6),
                    n_solution_raw: solRowsBeforePre,
                    n_solution_kept: solN,
                    teamMap: teamN,
                    problems: probN,
                    solutionMapTeams: solMapN,
                    loop_pairs: teamN * probN,
                });
            }
        }
        
        // 更新一血记录（在AC提交时调用）
        UpdateFirstBlood(team_id, problemId, in_date) {
            const team = this.teamMap[team_id];
            const isStarTeam = team && team.tkind === 2;
            
            // Global 一血：所有队伍中第一个AC的
            if (!this.map_fb.global[problemId]) {
                this.map_fb.global[problemId] = {
                    team_id: team_id,
                    in_date: in_date,
                    isStarTeam: isStarTeam
                };
            }
            
            // Regular 一血：非打星队伍中第一个AC的
            if (!isStarTeam && !this.map_fb.regular[problemId]) {
                this.map_fb.regular[problemId] = {
                    team_id: team_id,
                    in_date: in_date,
                    isStarTeam: false
                };
            }
        }

        /**
         * 从 contest_data_ajax 同形 payload 计算全场 map_fb（与 rank 页 ProcessData / UpdateFirstBlood 一致）。
         * 供气球队列等在 API 按分区裁剪 solution 后仍展示全局首答；须深拷贝，避免 ConvertListToDict 污染原数据。
         * @param {object} rawData
         * @param {object} [config]
         * @returns {{ global: object, regular: object }}
         */
        static buildMapFbFromContestPayload(rawData, config = {}) {
            if (!rawData) {
                return { global: {}, regular: {} };
            }
            let payload;
            try {
                payload =
                    typeof structuredClone === "function"
                        ? structuredClone(rawData)
                        : JSON.parse(JSON.stringify(rawData));
            } catch (eClone) {
                console.error(
                    "[RankSystem] buildMapFbFromContestPayload clone failed",
                    eClone
                );
                return { global: {}, regular: {} };
            }
            const globalConfig =
                typeof window !== "undefined" && window.RANK_CONFIG
                    ? window.RANK_CONFIG
                    : {};
            const inst = new RankSystem(
                null,
                RankToolMergeConfig(globalConfig, config)
            );
            inst.data = payload;
            inst._rankTimeContext =
                payload.time_context &&
                typeof payload.time_context === "object"
                    ? payload.time_context
                    : {};
            inst.ConvertListToDict();
            inst.ProcessData(false);
            return {
                global: Object.assign({}, inst.map_fb && inst.map_fb.global),
                regular: Object.assign({}, inst.map_fb && inst.map_fb.regular),
            };
        }

        // 预处理数据：统一处理带"#"的ID格式
        PreprocessData() {
            // 处理队伍数据中的team_id
            this.teamMap = {}; //处理队伍数据
            /** @type {Set<string>} 本场 solution 中出现过的 team_id（ProcessData 内按 result 过滤之前统计，含评测中等） */
            this.teamIdsWithAnySolutionRow = new Set();
            if (this.data.team) {
                this.data.team.forEach(team => {
                    if (team.team_id && team.team_id.startsWith('#')) {
                        // 提取真正的team_id (格式: #cpc1001_A11 -> A11)
                        if (team.team_id.startsWith('#cpc')) {
                            team.team_id = team.team_id.split('_')[1];
                        } else {
                            // 其他格式，直接去掉"#"
                            console.error("team 用户名格式不正确", team)
                        }
                    }
                    // 维护 team_id 到 team 信息的映射
                    this.teamMap[team.team_id] = team;
                });
            }
            // 处理提交数据中的team_id
            if (this.data.solution) {
                this.data.solution.forEach(solution => {
                    const tidRaw = solution.team_id;
                    if (tidRaw != null && tidRaw !== '') {
                        let tidKey = String(tidRaw);
                        if (tidKey.startsWith('#cpc')) {
                            const parts = tidKey.split('_');
                            if (parts.length >= 2) {
                                tidKey = parts[1];
                            }
                        }
                        this.teamIdsWithAnySolutionRow.add(tidKey);
                    }
                    if (solution.team_id && solution.team_id.startsWith('#')) {
                        // 提取真正的team_id (格式: #cpc1001_A11 -> A11)
                        if (solution.team_id.startsWith('#cpc')) {
                            solution.team_id = solution.team_id.split('_')[1];
                        } else {
                            console.error("solution 用户名格式不正确", solution)
                        }
                    }
                });
            }
        }
        // ********** 队伍榜 - 排名计算 **********
        // 用途：计算队伍排名，生成 rankList （队伍榜单的基础数据）
        // 涉及功能：队伍榜（主功能）、学校榜（依赖此数据）、统计（依赖此数据）、滚榜（依赖此数据）
        // 功能：计算每队每题状态、解决数、罚时，处理封榜状态（滚榜模式），排序
        CalculateRank(flg_real_rank=false) {
            // 忠于 ProcessData 处理的数据，计算榜单并排序，不理会是否封榜，不处理打星信息
            const perf = this._rankPerfEnabled();
            const teamKeys = Object.keys(this.teamMap);
            const probKeys = Object.keys(this.problemMap);
            let c0 = 0;
            let c1 = 0;
            let c2 = 0;
            let c3 = 0;
            if (perf) {
                c0 = performance.now();
            }
            this.rankList = [];
            const contestStartMs =
                this.data && this.data.contest && this.data.contest.start_time != null && this.data.contest.start_time !== ''
                    ? this._rankWireInstantMs(this.data.contest.start_time)
                    : NaN;
            for (const team_id in this.teamMap) {
                if (this.teamIdsWithAnySolutionRow && !this.teamIdsWithAnySolutionRow.has(team_id)) {
                    continue;
                }
                const team = this.teamMap[team_id];
                const team_solutions = this.solutionMap[team_id] || { ac: {}, frozen: {}, problems: {} };
                let solved = 0;
                let penalty = 0; // seconds
                const problemStats = {};
                // 计算每个题目的状态
                for (const problemId in this.problemMap) {
                    const problem = this.problemMap[problemId];
                    let team_problem_solutions = team_solutions.problems[problemId] || [];
                    let status = 'none';
                    let submitCount = 0;
                    let lastSubmitTime = '';
                    // 检查AC状态（基于过滤后的提交）
                    const validAcTime = team_solutions.ac[problemId];
                    
                    if (validAcTime) {
                        // ac
                        status = 'ac';
                        solved ++;
                        
                        submitCount = team_problem_solutions.length;
                        
                        const acTime = this._rankWireInstantMs(validAcTime);
                        const deltaSeconds = Math.floor((acTime - contestStartMs) / 1000);
                        // 基础用时（秒） + 每次错误罚时20分钟（转秒）
                        penalty += deltaSeconds;
                        penalty += (submitCount - 1) * 20 * 60;
                        lastSubmitTime = RankjsFormatSecondsToHMS(deltaSeconds);
                    } else if (team_problem_solutions.length > 0) {
                        // wa 或 pending
                        status = problemId in team_solutions.frozen ? 'pending' : 'wa';
                        submitCount = team_problem_solutions.length;
                        const lastSolution = team_problem_solutions[team_problem_solutions.length - 1];
                        const lastTime = this._rankWireInstantMs(lastSolution.in_date);
                        const deltaSeconds = Math.floor((lastTime - contestStartMs) / 1000);
                        lastSubmitTime = RankjsFormatSecondsToHMS(deltaSeconds);
                    } else {
                        // 没有提交
                        submitCount = 0;
                    }
                    problemStats[problemId] = {
                        status,
                        submitCount,
                        lastSubmitTime,
                        problemAlphabetIdx: RankToolGetProblemAlphabetIdx(problem.num)
                    };
                }
                this.rankList.push({
                    item_key: team_id,  // 无论学校排名还是队伍排名，都用队伍做key，学校排名的队伍key就是该校排第一的队伍
                    team_id,
                    team,
                    solved,
                    penalty, // 精确到秒
                    problemStats
                });
            }
            if (perf) {
                c1 = performance.now();
            }
            // 排序
            this.rankList.sort((a, b) => this.CompareTeamsForRanking(a, b));
            if (perf) {
                c2 = performance.now();
            }
            if (typeof RankToolApplyMedalFlagsByGroupFromList === 'function') {
                RankToolApplyMedalFlagsByGroupFromList(this, this.rankList);
            }
            if (perf) {
                c3 = performance.now();
                const ms = (u, v) => +(v - u).toFixed(2);
                this._rankPerfLog('CalculateRank:timing_ms', {
                    team_problem_loop_ms: ms(c0, c1),
                    sort_ms: ms(c1, c2),
                    medals_ms: ms(c2, c3),
                    calculateRank_total_ms: ms(c0, c3),
                    teamMap: teamKeys.length,
                    problems: probKeys.length,
                    loop_pairs: teamKeys.length * probKeys.length,
                    rankListLen: this.rankList.length,
                });
            }
        }

        /**
         * 统一开关：行顶多归属奖区指示楣条（关闭后仅隐藏 UI，不影响排名计算）。
         * @param {boolean} on
         */
        SetAwardLintelEnabled(on) {
            if (typeof RankAwardLintel !== 'undefined') {
                RankAwardLintel.setEnabled(this, on);
            } else {
                this.flgAwardLintelEnabled = !!on;
            }
        }

        /** 按当前视图数据源刷新多归属奖牌档标记（rankList / rollData），供 RenderRank、IncrementalUpdate、滚榜数据重建等复用 */
        _ReapplyMedalFlagsByGroupForCurrentView() {
            if (typeof RankToolApplyMedalFlagsByGroupFromList !== 'function') return;
            if (this.currentMode === 'roll' && this.rollData && this.rollData.length) {
                RankToolApplyMedalFlagsByGroupFromList(this, this.rollData);
            } else if (this.currentMode !== 'school' && this.rankList && this.rankList.length) {
                RankToolApplyMedalFlagsByGroupFromList(this, this.rankList);
            }
        }
        
        /**
         * 队伍排序比较函数（通用逻辑，供子类复用）
         * 排序规则：solved 降序，penalty 升序，team_id 升序
         * @param {Object} a - 队伍A
         * @param {Object} b - 队伍B
         * @returns {number} 比较结果
         */
        CompareTeamsForRanking(a, b) {
            if (a.solved !== b.solved) return b.solved - a.solved;
            if (a.penalty !== b.penalty) return a.penalty - b.penalty;  // 此处 penalty 精确到秒
            return a.team_id.localeCompare(b.team_id);
        }
        // ********** 通用逻辑 - 榜单更新和渲染 **********
        // 用途：根据当前模式更新榜单显示
        // 涉及功能：队伍榜、学校榜
        // 功能：根据模式选择数据源（rankList/schoolRank），应用打星过滤，触发渲染
        UpdateRank(flg_render=true, starMode=null) {
            // 基于新一轮计算的 rankList 数据，更新 rank 的 渲染
            if (!this.rankList.length) {
                return [];
            }
            const starForAward = starMode === null || starMode === undefined ? this.starMode : starMode;
            this.UpdateAwardInfo(starForAward);
            let displayList;
            // 普通模式使用原始数据
            const filteredList = this.FilterByStarMode(this.rankList, starMode);
            filteredList.sort((a, b) => this.CompareTeamsForRanking(a, b));
            // ********** 学校榜 - 学校排名计算 **********
            if (this.currentMode === 'school') {
                const schoolList = this.CalculateSchoolRank(filteredList);
                displayList = this.ApplyKeywordFilters(schoolList, 'school');
            } else {
                displayList = this.ApplyKeywordFilters(filteredList, 'team');
            }
            this.latestDisplayList = displayList;
            this.UpdateFilterQuickInfo(this.ApplyKeywordFilters(filteredList, 'team'));
            if (flg_render) {
                const runRender = async () => {
                    this._rankPerfLog('UpdateRank:runRender_start', {
                        displayLen: displayList.length,
                        gridChildren: this.elements.rankGrid ? this.elements.rankGrid.children.length : -1,
                    });
                    if (!this.elements.rankGrid) return;
                    if (this.elements.rankGrid.children.length > 0) {
                        await this.IncrementalUpdate(displayList);
                    } else {
                        await this.RenderRank(displayList);
                    }
                    this._rankPerfLog('UpdateRank:runRender_done', {
                        gridChildren: this.elements.rankGrid ? this.elements.rankGrid.children.length : -1,
                    });
                };
                this._rankRenderChain = this._rankRenderChain
                    .then(() => runRender())
                    .catch((e) => console.warn('[RankSystem] UpdateRank render', e));
                if (this._rankPerfEnabled()) {
                    this._rankPerfLog('UpdateRank:render_enqueued', { displayLen: displayList.length });
                }
            }
            return displayList;
        }
        NormalizeFilterKeyword(text) {
            return String(text || '')
                .toLowerCase()
                .replace(/[\s\u3000]+/g, ' ')
                .trim();
        }
        HasTagFilters() {
            return (this.filterSchools && this.filterSchools.size > 0) || (this.filterTeams && this.filterTeams.size > 0);
        }
        IsContestantTeam(team) {
            if (!team) return false;
            if (Number(team.tkind) === 2) return false;
            const priv = String(team.privilege || '').trim().toLowerCase();
            return priv === '' || priv === 'default';
        }
        GetAllSchools() {
            const schools = new Set();
            for (const id in this.teamMap) {
                const t = this.teamMap[id];
                if (!this.IsContestantTeam(t)) continue;
                const school = String(t.school || '').trim();
                if (school) schools.add(school);
            }
            return Array.from(schools).sort();
        }
        GetAllTeamInfos() {
            const teams = [];
            for (const id in this.teamMap) {
                const t = this.teamMap[id];
                if (!this.IsContestantTeam(t)) continue;
                teams.push({
                    team_id: id,
                    name: t.name || '',
                    name_en: t.name_en || '',
                    school: t.school || '',
                    coach: t.coach || '',
                    tmember: t.tmember || ''
                });
            }
            return teams.sort((a, b) => (a.name || a.team_id).localeCompare(b.name || b.team_id));
        }
        TeamFilterMetaPlain(obj) {
            if (!obj) return '';
            const parts = [];
            ['name_en', 'coach', 'tmember', 'school'].forEach((k) => {
                const v = String(obj[k] || '').trim();
                if (v) parts.push(v);
            });
            return parts.join(' · ');
        }
        TeamFilterMatchesQuery(item, q) {
            if (!q) return true;
            const keys = ['team_id', 'name', 'name_en', 'coach', 'tmember', 'school'];
            return keys.some(k => String(item[k] || '').toLowerCase().includes(q));
        }
        SetupFilterSearchDropdown(input, dropdown, updateFn) {
            if (!input || !dropdown) return;
            input.addEventListener('focus', () => {
                updateFn();
                dropdown.classList.add('show');
            });
            input.addEventListener('input', () => {
                updateFn();
                dropdown.classList.add('show');
            });
            input.addEventListener('blur', () => {
                setTimeout(() => dropdown.classList.remove('show'), 180);
            });
        }
        RenderFilterTags() {
            const renderGroup = (container, values, type) => {
                if (!container) return;
                if (type === 'school') {
                    container.innerHTML = Array.from(values).map(v => {
                        const c = RankToolSchoolFilterColors(v);
                        return `<span class="filter-tag filter-tag-school" style="background:${c.tagBg};border-color:${c.border};color:${c.text};--filter-tag-x:${c.tagAccent}">
                            <span class="filter-tag-label">${RankToolEscapeHtml(v)}</span>
                            <button class="filter-tag-remove" data-type="school" data-value="${RankToolEscapeHtml(v)}" title="移除">&times;</button>
                        </span>`;
                    }).join('');
                } else {
                    container.innerHTML = Array.from(values).map(tid => {
                        const t = this.teamMap[tid];
                        const c = RankToolSchoolFilterColors(String(t?.school || `team:${tid}`));
                        const idEsc = RankToolEscapeHtml(tid);
                        const nameEsc = RankToolEscapeHtml(t?.name || '');
                        const primary = nameEsc ? `${idEsc} · ${nameEsc}` : idEsc;
                        const meta = this.TeamFilterMetaPlain(t || {});
                        const metaBlock = meta ? `<span class="filter-tag-meta">${RankToolEscapeHtml(meta)}</span>` : '';
                        return `<span class="filter-tag filter-tag-team" style="background:${c.tagBg};border-color:${c.border};color:${c.text};--filter-tag-x:${c.tagAccent}">
                            <span class="filter-tag-text-col">
                                <span class="filter-tag-primary">${primary}</span>${metaBlock}
                            </span>
                            <button class="filter-tag-remove" data-type="team" data-value="${RankToolEscapeHtml(tid)}" title="移除">&times;</button>
                        </span>`;
                    }).join('');
                }
                container.querySelectorAll('.filter-tag-remove').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const val = btn.dataset.value || '';
                        if ((btn.dataset.type || '') === 'school') this.filterSchools.delete(val);
                        else this.filterTeams.delete(val);
                        this.RenderFilterTags();
                        this.UpdateSchoolCandidates();
                        this.UpdateTeamCandidates();
                        this.UpdateRank();
                        this.SaveViewPrefs();
                    });
                });
            };
            renderGroup(this.elements.filterSchoolTags, this.filterSchools, 'school');
            renderGroup(this.elements.filterTeamTags, this.filterTeams, 'team');
        }
        RenderFilterCandidates(container, items, type) {
            if (!container) return;
            const max = 80;
            if (!items.length) {
                container.innerHTML = '<div class="filter-candidate-empty">无匹配 / No match</div>';
                return;
            }
            container.innerHTML = items.slice(0, max).map(item => {
                if (type === 'school') {
                    return `<div class="filter-candidate-item" role="button" tabindex="0" data-value="${RankToolEscapeHtml(item)}">${RankToolEscapeHtml(item)}</div>`;
                }
                const idPart = RankToolEscapeHtml(item.team_id);
                const namePart = item.name ? RankToolEscapeHtml(item.name) : '';
                const primary = namePart ? `${idPart} · ${namePart}` : idPart;
                const meta = this.TeamFilterMetaPlain(item);
                const metaRow = meta ? `<div class="filter-candidate-team-meta">${RankToolEscapeHtml(meta)}</div>` : '';
                return `<div class="filter-candidate-item filter-candidate-team" role="button" tabindex="0" data-value="${RankToolEscapeHtml(item.team_id)}"><div class="filter-candidate-team-primary">${primary}</div>${metaRow}</div>`;
            }).join('');
            container.querySelectorAll('.filter-candidate-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const v = el.dataset.value || '';
                    if (type === 'school') this.filterSchools.add(v);
                    else this.filterTeams.add(v);
                    this.RenderFilterTags();
                    this.UpdateSchoolCandidates();
                    this.UpdateTeamCandidates();
                    this.UpdateRank();
                    this.SaveViewPrefs();
                });
            });
        }
        UpdateSchoolCandidates() {
            const container = this.elements.filterSchoolCandidates;
            if (!container) return;
            const q = this.NormalizeFilterKeyword(this.elements.filterSchoolSearch?.value || '');
            const all = this.GetAllSchools();
            const filtered = q ? all.filter(s => this.NormalizeFilterKeyword(s).includes(q)) : all;
            const available = filtered.filter(s => !this.filterSchools.has(s));
            this.RenderFilterCandidates(container, available, 'school');
        }
        UpdateTeamCandidates() {
            const container = this.elements.filterTeamCandidates;
            if (!container) return;
            const q = this.NormalizeFilterKeyword(this.elements.filterTeamSearch?.value || '');
            const all = this.GetAllTeamInfos();
            const filtered = q ? all.filter(t => this.TeamFilterMatchesQuery(t, q)) : all;
            const available = filtered.filter(t => !this.filterTeams.has(t.team_id));
            this.RenderFilterCandidates(container, available, 'team');
        }
        ApplyKeywordFilters(list, mode='team') {
            if (!this.HasTagFilters()) return list;
            return list.filter((item) => {
                if (mode === 'school') {
                    const schoolName = String(item?.school || item?.team?.school || '');
                    const teams = Array.isArray(item?.selected_teams) ? item.selected_teams : [];
                    const schoolHit = this.filterSchools.has(schoolName);
                    const teamHit = teams.some((t) => this.filterTeams.has(String(t?.team_id || t?.team?.team_id || '')));
                    return schoolHit || teamHit;
                }
                const team = item?.team || {};
                const schoolHit = this.filterSchools.has(String(team.school || ''));
                const teamHit = this.filterTeams.has(String(team.team_id || item?.team_id || item?.item_key || ''));
                return schoolHit || teamHit;
            });
        }
        // #########################################
        //  排名计算和渲染模块
        // #########################################
        // 行级增量更新：基于ID匹配的增量更新
        async IncrementalUpdate(list) {
            // 🔥 模拟模式：跳过DOM操作和动画
            if (this.isSimulating) {
                return;
            }
            
            // 真实模式：执行DOM更新和动画
            const grid = this.elements.rankGrid;
            this._ReapplyMedalFlagsByGroupForCurrentView();
            const rankedList = this.CalculateRankInfo(list);
            // 获取当前页面中所有存在的队伍ID
            const existingItemKeys = new Set();
            const existingRows = grid.querySelectorAll('.rank-row, .rl-row');
            existingRows.forEach(row => {
                const item_key = row.getAttribute('data-row-id');
                if (item_key) existingItemKeys.add(item_key);
            });
            // 获取新列表中的队伍ID
            const newItemKeys = new Set(rankedList.map(item => String(item.item_key)));
            
            // 1. 更新已存在的队伍
            let updatedCount = 0;
            let createdCount = 0;
            const rankUpdates = []; // 存储需要延迟更新的排名信息（仅在滚榜排序时使用）
            // 检查是否在滚榜排序中（由子类 RankRollSystem 提供 currentRollStep）
            const isRollSorting = this.currentRollStep === 'sort';
            
            if (isRollSorting) {
                // 滚榜排序：立即更新排名和背景色（包括排名），然后执行位置动画
                // 关键修复：先更新所有排名和背景色，再执行动画，确保观众立即看到排名变化
                //
                // 【根因】UpdateRankRow 虽为 async 但体内无 await，首个 await UpdateRankRow 即让出到微任务，
                // RankRollSystem.JudgeSort 紧接着同步执行 _JudgeSortDoneJudge → JudgeConfirm → scrollToTeam，
                // 此时仅第一行已写回 DOM，与 rollData 全量不一致 → FLIP 错向/视口错位/U 后 N 偶发。
                // 故本分支禁止行间 await；须在同一同步段内刷完所有行再进入 AnimateRankSort。
                for (let i = 0; i < rankedList.length; i++) {
                    const item = rankedList[i];
                    const item_key = String(item.item_key);
                    if (existingItemKeys.has(item_key)) {
                        // 队伍存在，立即更新所有内容（包括排名和背景色）
                        void this.UpdateRankRow(item, item.displayRank, i);
                        updatedCount++;
                    } else {
                        // 队伍不存在，创建新行
                        const newRow = await this.CreateRankRow(item, item.displayRank, i);
                        grid.appendChild(newRow);
                        createdCount++;
                    }
                }
            } else {
                // 普通更新：正常更新所有内容（包括排名）
                for (let i = 0; i < rankedList.length; i++) {
                    const item = rankedList[i];
                    const item_key = String(item.item_key);
                    if (existingItemKeys.has(item_key)) {
                        // 队伍存在，更新内容
                        await this.UpdateRankRow(item, item.displayRank, i);
                        updatedCount++;
                    } else {
                        // 队伍不存在，创建新行
                        const newRow = await this.CreateRankRow(item, item.displayRank, i);
                        grid.appendChild(newRow);
                        createdCount++;
                    }
                }
            }
            
            // 2. 删除不存在的队伍
            let removedCount = 0;
            existingItemKeys.forEach(item_key => {
                if (!newItemKeys.has(item_key)) {
                    const rowToRemove = document.getElementById(`rank-grid-${item_key}`);
                    if (rowToRemove) {
                        rowToRemove.remove();
                        removedCount++;
                    }
                }
            });
            
            // 3. 执行排序动画
            // 关键修复：滚榜排序时排名已在上面更新，这里只需要执行位置动画
            if (isRollSorting) {
                // 滚榜排序：排名已更新，只执行位置动画
                await this.AnimateRankSort(rankedList, () => {
                    // 动画完成回调：恢复正在揭晓队伍的z-index
                    if (this.judgingTeamId) {
                        const judgingRow = document.getElementById(`rank-grid-${this.judgingTeamId}`);
                        if (judgingRow && judgingRow.style.zIndex === '99') {
                            judgingRow.style.zIndex = '';
                        }
                    }
                });
            } else {
                // 普通更新：正常执行动画（可能没有位置变化）
                await this.AnimateRankSort(rankedList);
            }
        }
        // 更新排名行（不更新排名数字）
        async UpdateRankRowWithoutRank(item, index) {
            const team_id = item.team.team_id;
            const row = document.getElementById(`rank-grid-${team_id}`);
            if (!row) {
                return;
            }
            // 更新行样式（但不更新排名相关的样式）
            row.className = this.GetRowClassName(index, row);
            row.setAttribute('data-rank-mode', this.currentMode || 'team');
            // 更新解题数
            const solveCell = row.querySelector('.solve-item .problem-label');
            if (solveCell) {
                solveCell.textContent = item.solved;
            }
            // 更新解题数tooltip
            const solveItem = row.querySelector('.solve-item');
            if (solveItem) {
                solveItem.setAttribute('title-cn', `解题数：${item.solved}`);
                solveItem.setAttribute('title-en', `Solved: ${item.solved}`);
            }
            // 更新罚时
            const penaltyBrief = row.querySelector('.penalty-time-brief');
            const penaltyFull = row.querySelector('.penalty-time-full');
            if (penaltyBrief) penaltyBrief.textContent = RankjsFormatSecondsToMinutes(item.penalty);
            if (penaltyFull) penaltyFull.textContent = RankjsFormatSecondsToHMS(item.penalty);
            // 更新罚时tooltip
            const penaltyItem = row.querySelector('.penalty-item');
            if (penaltyItem) {
                penaltyItem.setAttribute('title-cn', `罚时：${RankjsFormatSecondsToMinutes(item.penalty)} 分钟（${RankjsFormatSecondsToHMS(item.penalty)}）`);
                penaltyItem.setAttribute('title-en', `Penalty: ${RankjsFormatSecondsToMinutes(item.penalty)} min (${RankjsFormatSecondsToHMS(item.penalty)})`);
            }
            // 更新题目组
            const problemGroup = row.querySelector('.problem-group');
            if (problemGroup) {
                problemGroup.innerHTML = this.CreateProblemGroup(item.problemStats, item);
            }
        }
        // 只更新排名数字
        UpdateRankNumber(item, rank, index) {
            const team_id = item.team.team_id;
            const row = document.getElementById(`rank-grid-${team_id}`);
            if (!row) {
                return;
            }
            // 检查排名变化（使用order属性判断）
            const rankCell = row.querySelector('.rank-item');
            if (!rankCell) {
                return;
            }
            const rankNumberElement = rankCell.querySelector('.rank-number');
            const oldOrder = parseInt(rankNumberElement?.getAttribute('order') || '0');
            const newOrder = item?.displayOrder || 0;
            const rankChanged = oldOrder !== newOrder && oldOrder > 0; // oldOrder > 0 确保不是初次创建
            
            const rankDisplay = item.isStar ? '*' : rank;
            const displayOrder = item?.displayOrder;
            const rankClass = this.GetRankClass(rank);
            
            // // 更新排名显示
            // if (rankChanged) {
            //     // 排名变化，添加特殊动画
            //     row.classList.add('rank-changed');
            //     if (newOrder < oldOrder) {
            //         row.classList.add('rank-improved');
            //     } else if (newOrder > oldOrder) {
            //         row.classList.add('rank-declined');
            //     }
            //     // 排名数字变化动画
            //     const rankNumber = rankCell.querySelector('.rank-number');
            //     if (rankNumber) {
            //         rankNumber.style.transform = 'scale(1.2)';
            //         rankNumber.style.color = newOrder < oldOrder ? '#10b981' : '#f59e0b';
            //     }
            // }
            
            rankCell.innerHTML = `${this.GetRankEmoji(rankClass)}<span class="rank-number" order="${displayOrder}">${rankDisplay}</span>`;
            rankCell.className = `rank-item ${rankClass}`;
            
            // // 清理动画类（0.5秒后清理）
            // if (rankChanged) {
            //     setTimeout(() => {
            //         row.classList.remove('rank-changed', 'rank-improved', 'rank-declined');
            //         const rankNumber = rankCell.querySelector('.rank-number');
            //         if (rankNumber) {
            //             rankNumber.style.transform = '';
            //             rankNumber.style.color = '';
            //         }
            //     }, 500);
            // }
        }
        // 全新的动画系统：流畅的排名变化动画
        async AnimateRankSort(rankedList, onComplete = null) {
            const grid = this.elements.rankGrid;
            // 强制重排，确保DOM状态稳定
            grid.offsetHeight;
            // 重新获取最新的DOM状态（IncrementalUpdate后）
            const currentRows = Array.from(grid.querySelectorAll('.rank-row, .rl-row'));
            if (currentRows.length === 0) {
                if (onComplete) onComplete();
                return;
            }
            // 1. 记录当前所有行的位置和状态（基于最新DOM）
            const currentPositions = new Map();
            const rowHeight = currentRows[0]?.getBoundingClientRect().height || 0;
            currentRows.forEach((row, index) => {
                const item_key = row.getAttribute('data-row-id');
                const rect = row.getBoundingClientRect();
                currentPositions.set(item_key, {
                    element: row,
                    currentIndex: index,
                    top: rect.top,
                    height: rect.height
                });
            });
            // 2. 计算目标位置映射
            const targetPositions = new Map();
            rankedList.forEach((item, index) => {
                const item_key = String(item.item_key);
                const currentPos = currentPositions.get(item_key);
                if (currentPos) {
                    targetPositions.set(item_key, {
                        newIndex: index,
                        targetTop: index * rowHeight,
                        element: currentPos.element
                    });
                }
            });
            // 3. 执行一次性动画
            await this.ExecuteOneTimeAnimation(currentPositions, targetPositions, rankedList, onComplete);
        }
        async ExecuteOneTimeAnimation(currentPositions, targetPositions, rankedList, onComplete = null) {
            const grid = this.elements.rankGrid;
            // 1. 创建目标DOM结构（按rankedList顺序）
            const sortedRows = [];
            const matchedCount = { count: 0 };
            rankedList.forEach((item, index) => {
                const item_key = String(item.item_key);
                const currentPos = currentPositions.get(item_key);
                if (currentPos) {
                    sortedRows.push(currentPos.element);
                    matchedCount.count++;
                } else {
                }
            });
            // 2. 直接使用CSG动画库，让它处理FLIP逻辑
            await this.ExecuteBulkAnimation([], sortedRows, grid, onComplete);
        }
        // 使用CSG动画库的智能排序动画（标准榜单模式，不需要处理上升队伍）
        async ExecuteBulkAnimation(movements, sortedRows, grid, onComplete = null) {
            // 计算动画持续时间（rollSpeedMultiplier 由子类 RankRollSystem 提供，默认为1.0）
            const speedMultiplier = this.rollSpeedMultiplier || 1.0;
            const animationDuration = RankToolCalculateAnimationDuration(this.baseAnimationDuration, speedMultiplier, this.minAnimationDuration, this.maxAnimationDuration);
            // 1. 提取排序后的itemKey顺序
            const order = sortedRows.map(row => row.getAttribute('data-row-id')).filter(Boolean);
            // 2. 使用CSG动画库的智能排序动画（标准榜单：固定duration + 队列管理，不处理上升队伍）
            await window.CSGAnim.sortAnimate(grid, order, {
                duration: animationDuration,
                speedMultiplier: speedMultiplier,
                easing: window.CSGAnim.getEasing('smooth'),
                useFlip: true,
                queue: true,
                cancelPrevious: true,
                // 标准榜单：不启用上升队伍相关功能
                useSpeedBasedDuration: false,
                mergeAnimations: false,
                risingTeamIds: [],
                onStart: () => {
                },
                onComplete: () => {
                    this.FinalizeBulkAnimation([], sortedRows, grid);
                    if (onComplete) {
                        onComplete();
                    }
                }
            });
        }
        // 完成批量动画
        FinalizeBulkAnimation(animationData, sortedRows, grid) {
            // 清理动画状态
            animationData.forEach(data => {
                // 注释掉上升下降动效的class移除，提高滚榜流畅性
                // data.element.classList.remove('rank-animating', 'rank-moving-up', 'rank-moving-down');
                data.element.style.transform = '';
                data.element.style.transition = '';
            });
        }
        FilterByStarMode(list, starMode=null) {
            // 根据打星模式过滤队伍或调整队伍标记
            const tmp_star_mode = starMode === null ? this.starMode : starMode;
            return list.filter(item => {
                const team = item.team;
                // 先按赛事归属过滤（运行期保证至少选中1个）
                if (this.IsMultiGroupEnabled() && this.selectedGroupIds.length > 0) {
                    const contestGroups = this.GetContestGroups();
                    // 仅 1 条归属时：与旧 OJ 一致，不按 group_ids 过滤，全队视为该归属
                    if (contestGroups.length > 1) {
                        const gids = Array.isArray(team.group_ids) ? team.group_ids : [];
                        const selected = new Set(
                            this.selectedGroupIds.map((x) => String(x))
                        );
                        const hit = gids.some((gid) => selected.has(String(gid)));
                        if (!hit) return false;
                    }
                }
                if (team.tkind === 2) { // 处理打星队
                    if (tmp_star_mode === 0) item.isStar = true;    // 打星不排名
                    if (tmp_star_mode === 1) return false;          // 不含打星，过滤掉
                    if (tmp_star_mode === 2) item.isStar = false;   // 打星参与排名
                }
                return true;
            });
        }
        // 计算具体名次（考虑并列、打星） - 公共逻辑
        CalculateRankInfo(list) {
            let currentOrder = 0;
            let currentRank = 0;
            let schoolCntSet = new Set();
            let currentSchoolCntOrder = 0; // 不考虑并列，队伍前面不重复学校个数
            let currentSchoolCntNow = 0;   // 考虑并列，队伍前面不重复学校个数
            let lastSolved = -1;
            let lastPenalty = -1;
            return list.map((item, index) => {
                if (!item.isStar) {
                    currentOrder++;
                    const school = item?.team?.school ?? "";
                    if(!schoolCntSet.has(school)) {
                        schoolCntSet.add(school);
                        currentSchoolCntOrder++;
                    }
                    const penalty_for_rank = Math.floor(item.penalty / 60 + 0.00000001); // 按分钟取整，以此排名
                    if (item.solved !== lastSolved || penalty_for_rank !== lastPenalty) {
                        currentRank = currentOrder;
                        currentSchoolCntNow = currentSchoolCntOrder;
                    }
                    lastSolved = item.solved;
                    lastPenalty = penalty_for_rank;
                }
                item.displayRank = item.isStar ? '*' : currentRank;
                item.displayOrder = currentOrder; // 如果打星，就会出现重复的order，但这刚好可以作为打星队的近似排名
                item.displayIdx = index + 1;
                item.displaySchoolCntNow = item.isStar ? '*' : currentSchoolCntNow;
                item.displaySchoolCntOrder = currentSchoolCntOrder;
                return item;
            });
        }
        // ********** 学校榜 - 学校排名计算 **********
        // 用途：将队伍排名聚合为学校排名
        // 涉及功能：学校榜（主功能）
        // 功能：按学校分组、选择每校前N支队伍、合并题目状态、计算学校总解决数和罚时、排序
        CalculateSchoolRank(teamList) {
            // 从已经 filter 并根据模式标记好 isStar 的排名中计算学校排名
            const schoolMap = {};
            // 按 学校 分组
            teamList.forEach(item => {
                const school = item.team.school;
                if (!schoolMap[school]) {
                    schoolMap[school] = [];
                }
                schoolMap[school].push(item);
            });
            // 计算 学校 排名
            const schoolList = [];
            for (const school in schoolMap) {
                const teams = schoolMap[school];
                teams.sort((a, b) => {
                    if (a.solved !== b.solved) return b.solved - a.solved;
                    return a.penalty - b.penalty;
                });
                // 根据打星模式处理队伍选择
                let selectedTeams = [];
                // 打星不排名或不含打星：优先选择regular队 （此处以 isStar 区分，已涵盖 starMode 的定义）
                const regularTeams = teams.filter(team => team.team?.isStar);
                const starTeams = teams.filter(team => !team.team?.isStar);
                if (regularTeams.length > 0) {
                    // 有regular队，只取regular队
                    selectedTeams = regularTeams.slice(0, this.GetTopTeamCount());
                } else {
                    // 全是打星队，则使用所有打星队
                    selectedTeams = starTeams.slice(0, this.GetTopTeamCount());
                }
                let totalSolved = 0;
                let totalPenalty = 0;
                const mergedProblems = {};
                selectedTeams.forEach(team => {
                    totalSolved += team.solved;
                    totalPenalty += team.penalty;
                    // 合并题目状态
                    for (const problemId in team.problemStats) {
                        const stats = team.problemStats[problemId];
                        if (!mergedProblems[problemId]) {
                            mergedProblems[problemId] = {
                                status: 'none',
                                submitCount: 0,
                                lastSubmitTime: '',
                                problemAlphabetIdx: stats.problemAlphabetIdx
                            };
                        }
                        const merged = mergedProblems[problemId];
                        merged.submitCount += stats.submitCount;
                        // school rank 的每个题目格子显示该校多个队伍这道题最晚的一次最接近ac的提交
                        // 优先级：ac > pending > wa > none
                        if (stats.status === 'ac' || 
                            (stats.status === 'pending' && merged.status !== 'ac') ||
                            (stats.status === 'wa' && merged.status === 'none')) {
                            if(stats.status != merged.status || stats.lastSubmitTime > merged.lastSubmitTime) {
                                merged.status = stats.status;
                                merged.lastSubmitTime = stats.lastSubmitTime;
                            }
                        }
                    }
                });
                const top_item = selectedTeams[0];
                schoolList.push({
                    item_key: top_item.team.team_id, // 用top team 的 team_id 作为这个 school row 的key
                    school,
                    solved: totalSolved,
                    penalty: totalPenalty,
                    problemStats: mergedProblems,
                    top_team: top_item,
                    team: top_item?.team,
                    isStar: top_item?.isStar ?? false,
                    teamCount: selectedTeams.length,
                    selected_teams: selectedTeams
                });
            }
            // 按成绩排序
            schoolList.sort((a, b) => {
                if (a.solved !== b.solved) return b.solved - a.solved;
                return a.penalty - b.penalty;
            });
            return schoolList;
        }
        GetTopTeamCount() {
            // 赛事归属维度：当且仅当筛选了一个归属时，优先使用该归属的 topteam
            const selected = Array.isArray(this.selectedGroupIds) ? this.selectedGroupIds : [];
            const contest = this.data?.contest || {};
            const groups = Array.isArray(this.data?.contest_group)
                ? this.data.contest_group
                : (Array.isArray(contest.contest_group) ? contest.contest_group : []);
            if (selected.length === 1 && groups.length > 0) {
                const hit = groups.find(g => g.group_id === selected[0]);
                if (hit && parseInt(hit.topteam || 0) > 0) {
                    return parseInt(hit.topteam);
                }
            }
            return this.data?.contest?.topteam || 1;
        }
        async RenderRank(list) {
            const rr0 = this._rankPerfEnabled() ? performance.now() : 0;
            if (this._rankPerfEnabled()) {
                this._rankPerfLog('RenderRank:start', { inputLen: list && list.length });
            }
            const grid = this.elements.rankGrid;
            grid.innerHTML = '';
            grid.setAttribute('data-rank-body-loading', '1');
            try {
                this._ReapplyMedalFlagsByGroupForCurrentView();
                const rankedList = this.CalculateRankInfo(list);
                if (this._rankPerfEnabled()) {
                    this._rankPerfLog('RenderRank:after_calculateRankInfo', {
                        cumRrMs: (performance.now() - rr0).toFixed(1),
                        rankedLen: rankedList.length,
                    });
                }
                const total = rankedList.length;
                const frag = document.createDocumentFragment();
                for (let j = 0; j < total; j++) {
                    const item = rankedList[j];
                    try {
                        const row = await this.CreateRankRow(item, item.displayRank, j);
                        if (row && row.nodeType === Node.ELEMENT_NODE) {
                            frag.appendChild(row);
                        } else {
                            console.error('CreateRankRow returned invalid node:', row);
                        }
                    } catch (error) {
                        console.error('Error creating rank row:', error);
                    }
                }
                if (frag.childNodes.length) {
                    grid.appendChild(frag);
                }
                const lastRow = grid.querySelector('.rank-row:last-child');
                if (lastRow) lastRow.style.borderRadius = '0 0 8px 8px';
                this.ReobserveFlags();
                this.ReobserveLogos();
                if (this._rankPerfEnabled()) {
                    this._rankPerfLog('RenderRank:complete', {
                        cumRrMs: (performance.now() - rr0).toFixed(1),
                        totalRows: total,
                    });
                }
            } finally {
                grid.removeAttribute('data-rank-body-loading');
            }
        }
        // 绑定图标tooltip
        BindIconTooltips(row) {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const setupIconTooltip = (icon) => {
                if (!icon) return;
                const tooltipKey = icon.getAttribute('tooltip-key');
                const titleCn = icon.getAttribute('title-cn');
                const titleEn = icon.getAttribute('title-en');
                const nameElement = icon.nextElementSibling;
                const name = nameElement ? nameElement.textContent.trim() : '';
                if (!tooltipKey || !name) return;
                const template = this.tooltipTemplates[tooltipKey];
                if (!template) return;
                const cnText = template.cn.replace('{name}', name);
                const enText = template.en.replace('{name}', name);
                if (isMobile) {
                    icon.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.ShowTooltipForElement(icon, cnText, enText);
                    });
                } else {
                    icon.addEventListener('mouseenter', () => {
                        this.ShowTooltipForElement(icon, cnText, enText);
                    });
                    icon.addEventListener('mouseleave', () => {
                        this.HideGlobalTooltip();
                    });
                }
            };
            // 绑定教练和选手图标
            const coachIcon = row.querySelector('.coach-icon');
            const playerIcon = row.querySelector('.player-icon');
            setupIconTooltip(coachIcon);
            setupIconTooltip(playerIcon);
        }
        // BindNamePopovers方法已移除，现在统一使用title-cn和title-en属性
        /**
         * 是否显示题目统计信息（可被子类重写）
         * @returns {boolean} 是否显示统计信息
         */
        ShouldShowProblemStats() {
            return true;
        }
        
        /**
         * 创建表头基础列（排名、题数、罚时）
         *  - 普通模式：排名 / 题数 / 罚时 三列
         *  - 滚榜模式：复用同一基础三列（CSS 在 [data-rank-mode="roll"] 下重排为
         *    "成绩"一格 + "标志/Logo"一格），并额外渲染一个真实的 .rank-col-roll-logo
         *    DOM 列，让"标志/Logo"双语字号能直接复用 .header-cell / en-text 的基础样式
         * @returns {string} HTML字符串
         */
        CreateHeaderRowBase() {
            const isRoll = (this.currentMode || '') === 'roll';
            const logoCol = isRoll
                ? `<div class="rank-col rank-col-roll-logo"><div class="header-cell">${this.CreateBilingualText('标志', 'Logo')}</div></div>`
                : '';
            return `
                <div class="rank-col rank-col-rank"><div class="header-cell">${this.CreateBilingualText('排名', 'Rank')}</div></div>
                <div class="rank-col rank-col-solve"><div class="header-cell">${this.CreateBilingualText('题数', 'Solved')}</div></div>
                <div class="rank-col rank-col-penalty"><div class="header-cell">${this.CreateBilingualText('罚时', 'Penalty')}</div></div>
                ${logoCol}
            `;
        }
        
        /**
         * 创建单个题目列的表头HTML
         * @param {Object} problem - 题目对象
         * @param {Object} stats - 题目统计信息（可选）
         * @returns {string} HTML字符串
         */
        CreateProblemHeaderColumn(problem, stats = null) {
            const problemAlphabetIdx = RankToolGetProblemAlphabetIdx(problem.num);
            const color = RankToolParseColor(problem.color);
            const showStats = this.ShouldShowProblemStats() && stats !== null;
            
            let tooltipAttributes = '';
            let statsHtml = '';
            
            if (showStats) {
                // 生成tooltip文本：显示两套统计数据
                const tooltipCn = `AC队伍数：${stats.acTeams} / 总提交队伍数：${stats.totalTeams}\nAC提交数：${stats.ac} / 总提交数：${stats.total}`;
                const tooltipEn = `AC Teams: ${stats.acTeams} / Total Tried Teams: ${stats.totalTeams}\nAC Submissions: ${stats.ac} / Total Submissions: ${stats.total}`;
                tooltipAttributes = RankToolGenerateBilingualAttributes(tooltipCn, tooltipEn);
                statsHtml = `
                    <div class="problem-header-stats">
                        ${stats.acTeams}/${stats.totalTeams}
                    </div>
                `;
            }
            
            const balloonIconClass = this.rankSkin === 'dark_stage' ? 'bi bi-balloon' : 'bi bi-balloon-fill';
            return `
                <div class="rank-col rank-col-problem" style="--rank-problem-color: ${color}">
                    <div class="problem-header-color-bg">
                        <i class="${balloonIconClass}" title-cn="${color}"></i>
                    </div>
                    <div class="problem-header-content" ${tooltipAttributes}>
                        <div class="problem-header-title">${problemAlphabetIdx}</div>
                        ${statsHtml}
                    </div>
                </div>
            `;
        }
        
        /**
         * 创建题目组表头HTML
         * @returns {string} HTML字符串
         */
        CreateProblemHeaderGroup() {
            let headerHtml = '<div class="pro-header-group">\n';
            
            if (this.data && this.data.problem) {
                let problemStats = null;
                if (this.ShouldShowProblemStats()) {
                    // 只在需要显示统计信息时才计算
                    problemStats = this.CalculateProblemStats();
                }
                
                this.data.problem.forEach(problem => {
                    const stats = problemStats ? (problemStats[problem.problem_id] || { 
                        ac: 0, 
                        total: 0, 
                        acTeams: 0, 
                        totalTeams: 0 
                    }) : null;
                    headerHtml += this.CreateProblemHeaderColumn(problem, stats);
                });
            }
            
            headerHtml += '</div>\n';
            return headerHtml;
        }
        
        /**
         * 创建表头行
         * @returns {HTMLElement} 表头行元素
         */
        CreateHeaderRow() {
            const headerRow = document.createElement('div');
            headerRow.className = 'rank-header-row';
            headerRow.setAttribute('data-rank-mode', this.currentMode || 'team');
            // z-index 已在 CSS 中通过 .rank-header-row 类设置
            
            let headerHtml = this.CreateHeaderRowBase();
            headerHtml += this.CreateProblemHeaderGroup();
            
            headerRow.innerHTML = headerHtml;
            return headerRow;
        }

        /**
         * 榜单行主队名单行跑马：`csg_marquee_plain.enableMarqueeIfNeeded`（与 `cpc_team_cards` 队名槽同源）。
         */
        ApplyTeamNameMarqueeForRow(row) {
            if (!row || !window.CsgMarqueePlain || typeof window.CsgMarqueePlain.enableMarqueeIfNeeded !== 'function') {
                return;
            }
            var el = row.querySelector('.team-names .team-name-cn.rank-team-name-mq');
            if (!el) {
                return;
            }
            var plain = el.getAttribute('data-rank-mq-plain');
            if (plain == null || String(plain).trim() === '') {
                plain = String(el.textContent || '').trim();
                if (plain) {
                    el.setAttribute('data-rank-mq-plain', plain);
                }
            } else {
                plain = String(plain).trim();
            }
            if (!plain) {
                return;
            }
            window.CsgMarqueePlain.enableMarqueeIfNeeded(el, plain, { overflowSlackRatio: 0.02 });
        }

        async CreateRankRow(item, rank, index) {
            const row = document.createElement('div');
            row.className = this.GetRowClassName(index);
            row.setAttribute('data-row-id', item.item_key);
            row.setAttribute('data-rank-mode', this.currentMode || 'team');
            row.id = `rank-grid-${item.item_key}`;
            const rankDisplay = item.isStar ? '*' : rank;
            const displayOrder = item?.displayOrder;
            const rankClass = this.GetRankClass(rank);
            // 顶部跨列信息： 学校/组织 名与国家副标题
            const schoolName = RankToolEscapeHtml(item.team?.school || item.school || '');
            const region = RankToolEscapeHtml(item.team?.region || item.region || '');
            const flagBase = this.config.region_flag_url || '/static/image/region_flag';
            // 在生成HTML时判断旗帜是否存在
            let flagDisplay = 'none';
            let regionTextDisplay = 'none';
            if (region) {
                try {
                    const mapping = await this.LoadFlagMapping();
                    if (mapping.has(region.trim())) {
                        // 旗帜存在，显示旗帜
                        flagDisplay = 'inline-block';
                    } else {
                        // 旗帜不存在，显示地区名
                        regionTextDisplay = 'flex';
                    }
                } catch (error) {
                    console.error('Error checking flag mapping:', error);
                    // 出错时显示地区名
                    regionTextDisplay = 'flex';
                }
            }
            // 队伍信息（已移除，使用新的HTML结构）
                row.innerHTML = `
                    <div class="rank-award-lintel" role="presentation" aria-hidden="true" hidden>
                        <div class="rank-award-lintel-track"></div>
                    </div>
                    <div class="rank-main-content">
                        <!-- 前三列背景区域，横跨三列纵跨两行 -->
                        <div class="school-logo" data-school="${schoolName}"></div>
                        <div class="top-section">
                            ${this.CreateCoachPlayerSection(item.team, item)}
                            <div class="team-info-section">
                                <div class="team-info">
                                    <div class="team-type-icon">${this.GetTeamTypeIcon(item.team?.tkind || 0)}</div>
                                    ${region ? `<img class="flag-icon" data-flag="${region}" alt="${region}" title="${region}" style="display: ${flagDisplay}; opacity: 0;" onload="this.style.opacity='1'" onerror="this.style.opacity='0'">` : ''}
                                    ${this.CreateSchoolName(schoolName, item.team)}
                                    <div class="team-names ${this.GetTeamNamesLayoutClass(item.team)}" ${(() => {
                                        const tooltip = this.CreateTeamNamesTooltip(item.team);
                                        return RankToolGenerateBilingualAttributes(tooltip.titleCn, tooltip.titleEn);
                                    })()}>
                                        ${this.CreateTeamNameCn(item.team)}
                                        ${this.CreateTeamNameEn(item.team)}
                                    </div>
                                </div>
                                ${this.currentMode === 'school' ? `
                                    <div class="team-watermark" aria-hidden="true">
                                        <div class="watermark-text-cn">第一队</div>
                                        <div class="watermark-text-en">Top Team</div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                        <div class="stats-section">
                            <div class="rank-col rank-col-rank">
                                <div class="rank-item ${rankClass}">
                                    ${this.GetRankEmoji(rankClass)}
                                    <span class="rank-number" order="${displayOrder}">${rankDisplay}</span>
                                </div>
                            </div>
                            <div class="rank-col rank-col-solve">
                                <div class="solve-item" ${RankToolGenerateBilingualAttributes(`解题数：${item.solved}`, `Solved: ${item.solved}`)}>
                                    <div class="problem-content">
                                        <span class="problem-label">${item.solved}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="rank-col rank-col-penalty">
                                <div class="penalty-item" ${RankToolGenerateBilingualAttributes(`罚时：${RankjsFormatSecondsToMinutes(item.penalty)} 分钟（${RankjsFormatSecondsToHMS(item.penalty)}）`, `Penalty: ${RankjsFormatSecondsToMinutes(item.penalty)} min (${RankjsFormatSecondsToHMS(item.penalty)})`)}>
                                    <div class="penalty-content">
                                        <span class="penalty-time-brief">${RankjsFormatSecondsToMinutes(item.penalty)}</span>
                                        <span class="penalty-time-full">${RankjsFormatSecondsToHMS(item.penalty)}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="problem-group">
                                ${this.CreateProblemGroup(item.problemStats, item)}
                            </div>
                        </div>
                    </div>
                `;
            // 懒加载校徽背景到前三列背景区域
            const firstThreeColsBg = row.querySelector('.school-logo');
            if (firstThreeColsBg) {
                const school = schoolName;
                if (school) {
                    this.LoadSchoolLogoBackground(firstThreeColsBg, school);
                }
            }
            // 懒加载旗帜（与校徽类似）
            const flagImg = row.querySelector('img.flag-icon');
            if (flagImg && !flagImg.getAttribute('src')) {
                const code = flagImg.getAttribute('data-flag');
                this.LazyLoadFlag(flagImg, flagBase, code);
            }
            // BindNamePopovers已移除，现在统一使用title-cn和title-en属性
            // 绑定图标tooltip
            this.BindIconTooltips(row);
            this.SyncTeamIdTag(row, item);
            if (typeof RankAwardLintel !== 'undefined') {
                RankAwardLintel.syncRow(row, this, item);
            }
            var self = this;
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    self.ApplyTeamNameMarqueeForRow(row);
                });
            });
            return row;
        }
        // 获取排名行的className（保留滚榜相关类）
        GetRowClassName(index, row = null) {
            // 基础类名
            let className = `rank-row ${index % 2 === 0 ? 'even' : 'odd'}`;
            if (this.currentMode === 'roll') {
                className += ' rank-row-roll';
            }
            
            // 如果提供了row元素，检查并保留滚榜相关的类
            if (row) {
                // 保留roll-judging类（正在揭晓的队伍）
                if (row.classList.contains('roll-judging')) {
                    className += ' roll-judging';
                }
            }
            
            return className;
        }
        // 更新排名行内容（与CreateRankRow逻辑对应）
        async UpdateRankRow(item, rank, index) {
            const team_id = item.team.team_id;
            const row = document.getElementById(`rank-grid-${team_id}`);
            if (!row) {
                return;
            }
            // // 添加更新动画类
            // row.classList.add('rank-updating');
            // 检查排名变化（使用order属性判断）
            const rankNumberElement = row.querySelector('.rank-number');
            const oldOrder = parseInt(rankNumberElement?.getAttribute('order') || '0');
            const newOrder = item?.displayOrder || 0;
            // const rankChanged = oldOrder !== newOrder && oldOrder > 0; // oldOrder > 0 确保不是初次创建
            // if (rankChanged) {
            //     // 排名变化，添加特殊动画
            //     row.classList.add('rank-changed');
            //     if (newOrder < oldOrder) {
            //         row.classList.add('rank-improved');
            //     } else if (newOrder > oldOrder) {
            //         row.classList.add('rank-declined');
            //     }
            // }
            // 更新行样式（使用GetRowClassName保留滚榜相关类）
            row.className = this.GetRowClassName(index, row);
            const rankDisplay = item.isStar ? '*' : rank;
            const displayOrder = item?.displayOrder;
            const rankClass = this.GetRankClass(rank);
            // 更新排名显示
            const rankCell = row.querySelector('.rank-item');
            if (rankCell) {
                // // 排名数字变化动画
                // if (rankChanged) {
                //     const rankNumber = rankCell.querySelector('.rank-number');
                //     if (rankNumber) {
                //         rankNumber.style.transform = 'scale(1.2)';
                //         rankNumber.style.color = newOrder < oldOrder ? '#10b981' : '#f59e0b';
                //     }
                // }
                rankCell.innerHTML = `${this.GetRankEmoji(rankClass)}<span class="rank-number" order="${displayOrder}">${rankDisplay}</span>`;
                rankCell.className = `rank-item ${rankClass}`;
            }
            // 更新解题数
            const solveCell = row.querySelector('.solve-item .problem-label');
            if (solveCell) {
                solveCell.textContent = item.solved;
            }
            // 更新解题数tooltip
            const solveItem = row.querySelector('.solve-item');
            if (solveItem) {
                solveItem.setAttribute('title-cn', `解题数：${item.solved}`);
                solveItem.setAttribute('title-en', `Solved: ${item.solved}`);
            }
            // 更新罚时
            const penaltyBrief = row.querySelector('.penalty-time-brief');
            const penaltyFull = row.querySelector('.penalty-time-full');
            if (penaltyBrief) penaltyBrief.textContent = RankjsFormatSecondsToMinutes(item.penalty);
            if (penaltyFull) penaltyFull.textContent = RankjsFormatSecondsToHMS(item.penalty);
            // 更新罚时tooltip
            const penaltyItem = row.querySelector('.penalty-item');
            if (penaltyItem) {
                penaltyItem.setAttribute('title-cn', `罚时：${RankjsFormatSecondsToMinutes(item.penalty)} 分钟（${RankjsFormatSecondsToHMS(item.penalty)}）`);
                penaltyItem.setAttribute('title-en', `Penalty: ${RankjsFormatSecondsToMinutes(item.penalty)} min (${RankjsFormatSecondsToHMS(item.penalty)})`);
            }
            // 更新题目组
            const problemGroup = row.querySelector('.problem-group');
            if (problemGroup) {
                problemGroup.innerHTML = this.CreateProblemGroup(item.problemStats, item);
            }
            if (typeof RankAwardLintel !== 'undefined') {
                RankAwardLintel.syncRow(row, this, item);
            }
            this.SyncTeamIdTag(row, item);
            // // 清理动画类（0.5秒后清理）
            // setTimeout(() => {
            //     row.classList.remove('rank-updating', 'rank-changed', 'rank-improved', 'rank-declined');
            //     const rankNumber = row.querySelector('.rank-number');
            //     if (rankNumber) {
            //         rankNumber.style.transform = '';
            //         rankNumber.style.color = '';
            //     }
            // }, 500);
        }
        // 通用动态加载方法
        LoadImageElement(element, identifier, attributeName, observerProperty, initMethod) {
            if (!identifier) return;
            // 设置标识符
            element.setAttribute(attributeName, identifier);
            // 确保观察器已初始化
            if (!this[observerProperty]) {
                this[initMethod]();
            }
            // 观察元素（避免重复观察）
            if (!element.dataset.observed) {
                this[observerProperty].observe(element);
                element.dataset.observed = 'true';
            }
        }
        // 旗帜懒加载（使用通用方案）
        LazyLoadFlag(img, base, code) {
            this.LoadImageElement(img, code, 'data-flag', '_flagObserver', 'InitFlagLoader');
        }
        // 显示旗帜（当旗帜加载成功时）
        ShowFlag(img) {
            // 确保旗帜显示（与榜单行内联 onload 一致；懒加载写入 data: URL 时不会触发该行 onload）
            img.style.display = 'inline-block';
            img.style.opacity = '1';
            // 确保地区名被隐藏
            const regionInfo = img.closest('.region-info');
            if (regionInfo) {
                const regionText = regionInfo.querySelector('.region-text');
                if (regionText) {
                    regionText.style.display = 'none';
                }
            }
        }
        // 显示地区名（当旗帜加载失败时）
        ShowRegionText(img, code) {
            // 确保旗帜隐藏
            img.style.display = 'none';
            // 确保地区名显示
            const regionInfo = img.closest('.region-info');
            if (regionInfo) {
                const regionText = regionInfo.querySelector('.region-text');
                if (regionText) {
                    regionText.style.display = 'flex';
                }
            }
        }
        // 检查字符串是否为空（已迁移到 rank_tool.js）
        IsEmptyString(str) {
            return RankToolIsEmptyString(str);
        }
        // 生成校名HTML
        CreateSchoolName(schoolName, team = null) {
            const hasTeamId = this.config.flg_show_team_id && team && team.team_id;
            const teamIdPlain = hasTeamId ? String(team.team_id) : '';
            const teamId = hasTeamId ? RankToolEscapeHtml(team.team_id) : '';
            const isEmpty = RankToolIsEmptyString(schoolName);
            const idInCorner = hasTeamId && this.currentMode !== 'school';

            // 构建基础title（根据校名是否为空）
            let titleCn = isEmpty ? "校名：缺失" : `学校/组织：${schoolName}`;
            let titleEn = isEmpty ? "School Name: Missing" : `School/Organization: ${schoolName}`;
            // 学校榜仍内联显示账号时，tooltip 带 ID；队伍/滚榜由右上标签承载账号说明
            if (hasTeamId && !idInCorner) {
                titleCn = `登录账号：${teamIdPlain}\n${titleCn}`;
                titleEn = `Account: ${teamIdPlain}\n${titleEn}`;
            }

            let schoolNameContent = isEmpty ? '' : schoolName;
            if (!isEmpty && hasTeamId && !idInCorner) {
                schoolNameContent = `<span class="team-id-display">${teamId}</span><span class="team-id-separator"> | </span>${schoolName}`;
            }

            const placeholderClass = isEmpty ? ' tinfo-placeholder' : '';
            return `<div class="school-name${placeholderClass}" title-cn="${RankToolEscapeHtml(titleCn)}" title-en="${RankToolEscapeHtml(titleEn)}">${schoolNameContent}</div>`;
        }

        /**
         * 取当前比赛的 contest_type（private % 10）。
         * 优先 rank_account_link_ctx.contest_type（模板已注入）；兜底用 data.contest.private。
         * 与 GetTeaminfoPageHref 内部逻辑保持一致；返回 NaN 表示未知。
         */
        _GetContestTypeNumber() {
            const ctx = (this.config || {}).rank_account_link_ctx;
            if (ctx && ctx.contest_type != null && ctx.contest_type !== '') {
                const t = parseInt(ctx.contest_type, 10);
                if (!Number.isNaN(t)) return t;
            }
            const p = this.data?.contest?.private;
            if (p != null) {
                const t = parseInt(p, 10) % 10;
                if (!Number.isNaN(t)) return t;
            }
            return NaN;
        }

        /**
         * 是否把登录账号（user_id → team_id）放到 coach+player 区域以大字号展示。
         * 区分口径与后端 **`contest.private % 10`**（见 **`ContestBaseTrait::ResolveContestTargetModule`**、
         * **`csgoj/controller/Status.php`** 注释：0=普通 OJ 赛、1=私有、2=CPC 标准、4=练习、5=考试）一致：
         * - **%10 ∈ {0,1}**：OJ 赛时榜，参赛主体为系统用户，`team_id` 实为登录账号，无 coach/tmember 列语义，
         *   coach-player 区空置，账号放大于此（「加密」由 `password` 判定，仍多为 %10=0，同属此类）。
         * - **%10 === 2**：CPC 标准场（`cpc_team`，coach/tmember 为正式字段），须标准布局；账号仅右上胶囊。
         * - **其它 %10**（如 4/5）：保守不占 coach-player，避免未覆盖类型误判；学校榜走校名内联。
         */
        _ShouldUseAccountAsCoachPlayer(team) {
            if (!this.config || !this.config.flg_show_team_id) return false;
            if (!team || !team.team_id) return false;
            if (this.currentMode === 'school') return false;
            const t = this._GetContestTypeNumber();
            if (Number.isNaN(t)) return false;
            return t === 0 || t === 1;
        }

        /**
         * 登录账号可点击目标（站点根相对路径）。优先 rank_account_link.js + 页面注入的 rank_account_link_ctx，
         * 与 status 页 FormatterStatusUser 一致；无 ctx 时回退为仅 teaminfo 的旧推导。
         * @param {string} teamId
         * @returns {string}
         */
        GetTeaminfoPageHref(teamId) {
            if (this.externalMode || !teamId) return '';
            if (this.currentMode !== 'team') return '';
            const cfg = this.config || {};
            const ctx = cfg.rank_account_link_ctx;
            if (typeof window.RankAccountLinkResolveHref === 'function' && ctx && String(ctx.module || '').trim()) {
                let contestId =
                    String(ctx.contest_id != null ? ctx.contest_id : '')
                        .trim()
                        .split(/[\s,]+/)
                        .filter(Boolean)[0] || '';
                if (!contestId) {
                    contestId =
                        String(cfg.cid_list ?? cfg.key ?? this.data?.contest?.contest_id ?? '')
                            .split(/[\s,]+/)
                            .map((s) => s.trim())
                            .filter(Boolean)[0] || '';
                }
                let contestType = ctx.contest_type;
                if (contestType == null || contestType === '') {
                    const p = this.data?.contest?.private;
                    contestType = p != null ? parseInt(p, 10) % 10 : NaN;
                } else {
                    contestType = parseInt(contestType, 10);
                }
                return (
                    window.RankAccountLinkResolveHref({
                        module: String(ctx.module || '').trim(),
                        contestId,
                        contestType,
                        userId: String(teamId)
                    }) || ''
                );
            }
            const api = String(cfg.api_url || '').trim();
            const lower = api.toLowerCase();
            const marker = '/contest/contest_data_ajax';
            const pos = lower.lastIndexOf(marker);
            if (pos < 0) return '';
            const base = api.slice(0, pos) + '/contest/teaminfo';
            let cid = cfg.cid_list ?? cfg.key ?? this.data?.contest?.contest_id ?? '';
            cid = String(cid)
                .split(/[\s,]+/)
                .map((s) => s.trim())
                .filter(Boolean)[0] || '';
            if (!cid) return '';
            try {
                const q = new URLSearchParams();
                q.set('cid', cid);
                q.set('team_id', String(teamId));
                return `${base}?${q.toString()}`;
            } catch (e) {
                return '';
            }
        }

        /**
         * 登录账号（team_id）右上胶囊标签：队伍榜 / 滚榜；学校榜仍走校名行内联。
         * 仅在赛时榜单「队伍」模式下为可点击链至队伍资料页；滚榜、外榜等无链接。
         */
        SyncTeamIdTag(row, item) {
            const section = row && row.querySelector && row.querySelector('.team-info-section');
            if (!section || !item || !item.team) return;
            const team = item.team;
            const show =
                this.config.flg_show_team_id &&
                team.team_id &&
                this.currentMode !== 'school' &&
                // 账号已经在 coach-player 区大字号显示时，右上胶囊隐藏，避免一行两处账号冗余
                !this._ShouldUseAccountAsCoachPlayer(team);
            let el = section.querySelector('.rank-team-id-tag');
            if (!show) {
                if (el) el.remove();
                return;
            }
            const id = String(team.team_id);
            const href = this.GetTeaminfoPageHref(id);
            const useLink = !!href;
            if (el && el.tagName.toLowerCase() !== (useLink ? 'a' : 'div')) {
                el.remove();
                el = null;
            }
            if (!el) {
                el = document.createElement(useLink ? 'a' : 'div');
                el.className = 'rank-team-id-tag';
                section.appendChild(el);
            }
            if (useLink) {
                el.href = href;
                el.removeAttribute('role');
                const userProfile = href.indexOf('/user/userinfo') !== -1;
                el.setAttribute(
                    'title-cn',
                    userProfile
                        ? `登录账号\n${id}\n（点击进入用户资料）`
                        : `登录账号\n${id}\n（点击进入队伍资料）`
                );
                el.setAttribute(
                    'title-en',
                    userProfile
                        ? `Account\n${id}\n(Click to open user profile)`
                        : `Account\n${id}\n(Click to open team profile)`
                );
            } else {
                el.removeAttribute('href');
                el.setAttribute('role', 'note');
                el.setAttribute('title-cn', `登录账号\n${id}`);
                el.setAttribute('title-en', `Account\n${id}`);
            }
            el.textContent = id;
        }
        // 生成主队名HTML（缺失时输出 tinfo-placeholder 细线占位，CSS 由 ::before 画）
        CreateTeamNameCn(team) {
            const nameCn = RankToolEscapeHtml(team.name || '');
            const isEmptyCn = RankToolIsEmptyString(nameCn);
            if (isEmptyCn) {
                return `<div class="team-name-cn tinfo-placeholder" aria-hidden="true"></div>`;
            }
            return `<div class="team-name-cn rank-team-name-mq">${nameCn}</div>`;
        }
        // 生成副队名HTML
        CreateTeamNameEn(team) {
            const nameCn = RankToolEscapeHtml(team.name || '');
            const nameEn = RankToolEscapeHtml(team.name_en || '');
            const isEmptyCn = RankToolIsEmptyString(nameCn);
            const isEmptyEn = RankToolIsEmptyString(nameEn);
            if (isEmptyCn && isEmptyEn) {
                return ``;
            }
            if (isEmptyEn) {
                return ``;
            }
            return `<div class="team-name-en">${nameEn}</div>`;
        }
        // 生成队伍名称区域的tooltip内容
        CreateTeamNamesTooltip(team) {
            const nameCn = RankToolEscapeHtml(team.name || '');
            const nameEn = RankToolEscapeHtml(team.name_en || '');
            const isEmptyCn = RankToolIsEmptyString(team.name);
            const isEmptyEn = RankToolIsEmptyString(team.name_en);
            let titleCn = '';
            let titleEn = '';
            if (isEmptyCn && isEmptyEn) {
                titleCn = '队名缺失';
                titleEn = 'Secondary Language Name Missing';
            } else if (isEmptyCn) {
                titleCn = '队名缺失';
                titleEn = `Secondary Language Name：${nameEn}`;
            } else if (isEmptyEn) {
                titleCn = `队名：${nameCn}`;
                titleEn = 'Secondary Language Name Missing';
            } else {
                titleCn = `队名：${nameCn}`;
                titleEn = `Secondary Language Name：${nameEn}`;
            }
            return { titleCn, titleEn };
        }
        // 计算队名区域布局类
        GetTeamNamesLayoutClass(team) {
            const hasCn = !RankToolIsEmptyString(team?.name);
            const hasEn = !RankToolIsEmptyString(team?.name_en);
            if (!hasCn && !hasEn) {
                return 'team-names-empty';
            }
            if (hasCn && hasEn) {
                return 'team-names-double';
            }
            return 'team-names-single';
        }
        // 生成教练信息HTML
        CreateCoachInfo(team) {
            const coachName = RankToolEscapeHtml(team.coach || '');
            const isEmpty = RankToolIsEmptyString(team.coach);
            if (isEmpty) {
                return ``;
            }
            return `<div class="coach-info">
                <span class="coach-icon" tooltip-key="coach" title-cn="教练" title-en="Coach">${RankToolGenerateIcon('coach')}</span>
                <span class="coach-name" title-cn="教练：${coachName}" title-en="Coach: ${coachName}">${coachName}</span>
            </div>`;
        }
        // 生成选手信息HTML
        CreatePlayerInfo(team) {
            const playerName = RankToolEscapeHtml(team.tmember || '');
            const isEmpty = RankToolIsEmptyString(team.tmember);
            if (isEmpty) {
                return ``;
            }
            return `<div class="player-info">
                <span class="player-icon" tooltip-key="player" title-cn="选手" title-en="Player">${RankToolGenerateIcon('player')}</span>
                <span class="player-name" title-cn="选手：${playerName}" title-en="Player: ${playerName}">${playerName}</span>
            </div>`;
        }
        // 生成登录账号信息HTML（公开/私有/加密赛专用，占位 coach-player 区）
        CreateAccountInfo(team) {
            const idPlain = String(team.team_id);
            const id = RankToolEscapeHtml(idPlain);
            const href = this.GetTeaminfoPageHref(idPlain);
            const useLink = !!href;
            const userProfile = useLink && href.indexOf('/user/userinfo') !== -1;
            let titleCn;
            let titleEn;
            if (useLink) {
                titleCn = userProfile
                    ? `登录账号\n${idPlain}\n（点击进入用户资料）`
                    : `登录账号\n${idPlain}\n（点击进入队伍资料）`;
                titleEn = userProfile
                    ? `Account\n${idPlain}\n(Click to open user profile)`
                    : `Account\n${idPlain}\n(Click to open team profile)`;
            } else {
                titleCn = `登录账号\n${idPlain}`;
                titleEn = `Account\n${idPlain}`;
            }
            const titleAttrs = `title-cn="${RankToolEscapeHtml(titleCn)}" title-en="${RankToolEscapeHtml(titleEn)}"`;
            const inner = `<span class="account-icon">${RankToolGenerateIconOnly('account')}</span><span class="account-id">${id}</span>`;
            if (useLink) {
                return `<a class="account-display" href="${RankToolEscapeHtml(href)}" ${titleAttrs}>${inner}</a>`;
            }
            return `<div class="account-display" role="note" ${titleAttrs}>${inner}</div>`;
        }
        // 生成教练选手区域HTML
        CreateCoachPlayerSection(team, item = null) {
            // 学校排名模式下显示队伍信息合计
            if (this.currentMode === 'school' && item) {
                const topTeamCount = this.GetTopTeamCount();
                const actualTeamCount = item.teamCount || 0;
                let summaryTextCn, summaryTextEn;
                if (topTeamCount === 1) {
                    // 如果只需要1队，显示"第1队"
                    summaryTextCn = '计入第 1 队';
                    summaryTextEn = '1st Team Counted';
                } else if (actualTeamCount >= topTeamCount) {
                    // 有足够队伍，显示"前X队合计"
                    summaryTextCn = `前 ${topTeamCount} 队合计`;
                    summaryTextEn = `Top ${topTeamCount} Teams Counted`;
                } else {
                    // 队伍不足，显示"全部X队合计"
                    summaryTextCn = `全部 ${actualTeamCount} 队合计`;
                    summaryTextEn = `All ${actualTeamCount} Teams Counted`;
                }
                return `<div class="coach-player-section school-summary">
                    <div class="team-summary-info">
                        <div class="summary-text-cn">${summaryTextCn}</div>
                        <div class="summary-text-en">${summaryTextEn}</div>
                    </div>
                </div>`;
            }
            // OJ 赛（private%10 为 0/1）：team_id 实为 user_id，用大字号占 coach-player 区
            if (this._ShouldUseAccountAsCoachPlayer(team)) {
                return `<div class="coach-player-section coach-player-account">
                    ${this.CreateAccountInfo(team)}
                </div>`;
            }
            // 队伍排名模式下显示教练和队员信息
            const hasCoach = !RankToolIsEmptyString(team.coach);
            const hasPlayer = !RankToolIsEmptyString(team.tmember);
            let layoutClass = 'coach-player-empty';
            if (hasCoach && hasPlayer) {
                layoutClass = 'coach-player-double';
            } else if (hasCoach || hasPlayer) {
                layoutClass = 'coach-player-single';
            }
            return `<div class="coach-player-section ${layoutClass}">
                ${this.CreateCoachInfo(team)}
                ${this.CreatePlayerInfo(team)}
            </div>`;
        }
        CreateSchoolInfo(item) {
            // 检查数据是否存在
            if (!item || !item.problemStats) {
                return `
                    <div class="team-name-cn">${RankToolEscapeHtml(item?.school || '')}</div>
                `;
            }
            return `
                <div class="team-name-cn">${RankToolEscapeHtml(item.school)}</div>
            `;
        }
        CreateProblemGroup(problemStats, item = null) {
            let html = '';
            // 检查problemMap是否存在且不为空
            if (!this.problemMap || Object.keys(this.problemMap).length === 0) {
                return '<div class="problem-group"><!-- 题目数据加载中 --></div>';
            }
            const problemIds = Object.keys(this.problemMap).sort((a, b) => 
                this.problemMap[a].num - this.problemMap[b].num
            );
            problemIds.forEach(problemId => {
                const stats = problemStats[problemId] || {
                    status: 'none',
                    submitCount: 0,
                    lastSubmitTime: '',
                    problemAlphabetIdx: RankToolGetProblemAlphabetIdx(this.problemMap[problemId].num)
                };
                // 计算总分钟数：将 HH:MM:SS 转换为总分钟数
                // 支持 H:MM:SS, HH:MM:SS, HHH:MM:SS 等格式（支持超过99小时）
                let briefMinute = '';
                if (stats.lastSubmitTime && /^\d{1,4}:\d{1,2}:\d{2}$/.test(stats.lastSubmitTime)) {
                    const timeParts = stats.lastSubmitTime.split(':');
                    let totalMinutes = 0;
                    if (timeParts.length === 3) {
                        // H:MM:SS 或 HH:MM:SS 或 HHH:MM:SS 格式
                        const hours = parseInt(timeParts[0]) || 0;
                        const minutes = parseInt(timeParts[1]) || 0;
                        totalMinutes = hours * 60 + minutes;
                    }
                    briefMinute = totalMinutes + "'";
                } else if (stats.lastSubmitTime && /^\d{1,2}:\d{2}$/.test(stats.lastSubmitTime)) {
                    // MM:SS 格式（兼容旧格式）
                    const timeParts = stats.lastSubmitTime.split(':');
                    if (timeParts.length === 2) {
                        const totalMinutes = parseInt(timeParts[0]) || 0;
                        briefMinute = totalMinutes + "'";
                    }
                }
                // 生成简化的tooltip内容
                const statusText = stats.status === 'ac' ? '已通过' : 
                                stats.status === 'wa' ? '未通过' : '未知';
                const statusTextEn = stats.status === 'ac' ? 'Accepted' : 
                                    stats.status === 'wa' ? 'Wrong Answer' : 'Unknown';
                // 智能显示分隔符：只要有提交次数>0且有最后提交时间就显示分隔符（与榜单逻辑保持一致）
                const shouldShowSeparator = (stats.submitCount > 0) && (stats.lastSubmitTime && stats.lastSubmitTime.trim() !== '');
                const separatorHtml = shouldShowSeparator ? '<span class="problem-separator">|</span>' : '';
     
                // 检查一血状态
                let isGlobalFirstBlood = false;
                let isRegularFirstBlood = false;
                
                if (this.currentMode === 'school') {
                    // 学校排名模式：检查一血队伍的学校是否与当前item的学校相同
                    const globalFirstBloodTeam = this.map_fb?.global?.[problemId];
                    const regularFirstBloodTeam = this.map_fb?.regular?.[problemId];
                    
                    if (globalFirstBloodTeam) {
                        const firstBloodTeam = this.teamMap[globalFirstBloodTeam.team_id];
                        isGlobalFirstBlood = firstBloodTeam?.school === item?.school;
                    }
                    
                    if (regularFirstBloodTeam) {
                        const firstBloodTeam = this.teamMap[regularFirstBloodTeam.team_id];
                        isRegularFirstBlood = firstBloodTeam?.school === item?.school;
                    }
                } else {
                    // 队伍排名模式：直接比较team_id
                    isGlobalFirstBlood = this.map_fb?.global?.[problemId]?.team_id === item?.team_id;
                    isRegularFirstBlood = this.map_fb?.regular?.[problemId]?.team_id === item?.team_id;
                }
                
                // 构建一血相关的CSS类：仅在与格子语义为 AC 时叠加。
                // 封榜/滚榜未揭晓为 pending（黄）时不得被一血蓝底盖住（CalculateRealRankMap 里
                // ProcessData(true) 会按终榜重算 map_fb，与格子 pending 语义不一致）。
                let firstBloodClasses = '';
                if (stats.status === 'ac') {
                    if (isRegularFirstBlood) {
                        firstBloodClasses += ' pro-first-blood-regular';
                    }
                    if (isGlobalFirstBlood) {
                        firstBloodClasses += ' pro-first-blood-global';
                    }
                }
                
                // 根据 briefMinute 长度添加类名（超过4位时缩小字号）
                const briefMinuteLength = briefMinute.length;
                const briefMinuteClass = briefMinuteLength > 4 ? 'time-brief-long' : '';
                
                html += `
                    <div class="rank-col rank-col-problem">
                        <div class="${this.GetProblemStatusClass(stats)}${firstBloodClasses}" 
                            d-pro-idx="${stats.problemAlphabetIdx}"
                            d-sub-cnt="${stats.submitCount || 0}"
                            d-last-sub="${this.GetLastSubmitTimeDisplay(stats)}">
                            <div class="problem-content">
                                <span class="pro-submit-cnt">${this.GetSubmitCountDisplay(stats)}</span>
                                ${separatorHtml}
                                <span class="time-brief ${briefMinuteClass}">${briefMinute}</span>
                                <span class="time-full">${this.GetLastSubmitTimeDisplay(stats)}</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            return html;
        }
        GetTeamTypeIcon(tkind, flg_render=true) {
            const iconKeyMap = {
                0: 'team-regular',    // 常规队
                1: 'team-girl',         // 女队
                2: 'team-star'          // 打星队
            };
            const iconKey = iconKeyMap[tkind] || 'team-regular';
            const labels = {
                0: { cn: '常规队', en: 'Regular' },
                1: { cn: '女队', en: 'Girl' },
                2: { cn: '打星队', en: 'Star' }
            };
            const label = labels[tkind] || labels[0];
            const iconHtml = RankToolGenerateIcon(iconKey, label.cn, label.en);
            if(flg_render) {
                return `<span class="team-type-icon ${iconKey.replace('team-', '')}">${iconHtml}</span>`;
            } else {
                return {
                    iconKeyMap,
                    iconKey,
                    labels,
                    label,
                    iconHtml
                }
            }
        }
        GetRankClass(rank) {
            // 多赛事归属混合榜单时，排名列不显示获奖配色，避免语义歧义
            if (this.IsMultiGroupEnabled() && Array.isArray(this.selectedGroupIds) && this.selectedGroupIds.length > 1) {
                return '';
            }
            if (rank === '*') return 'star';
            if (rank <= this.rankGold) return 'gold';
            if (rank <= this.rankSilver) return 'silver';
            if (rank <= this.rankBronze) return 'bronze';
            return '';
        }
        UpdateFilterQuickInfo(filteredTeamList = null) {
            const infoEl = this.elements?.filterQuickInfo;
            if (!infoEl) return;
            const groups = this.GetContestGroups();
            const selectedGroupCount = this.IsMultiGroupEnabled()
                ? Math.max(1, (this.selectedGroupIds || []).length)
                : Math.max(1, groups.length || 1);

            const teamList = Array.isArray(filteredTeamList) ? filteredTeamList : this.FilterByStarMode(this.rankList);
            const teamCount = teamList.length;
            const schoolCount = this.CalculateSchoolRank(teamList).length;

            infoEl.textContent = `G${selectedGroupCount} · T${teamCount} · S${schoolCount}`;
            infoEl.setAttribute('title-cn', `赛事归属 ${selectedGroupCount} · 队伍 ${teamCount} · 学校 ${schoolCount}`);
            infoEl.setAttribute('title-en', `Groups ${selectedGroupCount} · Teams ${teamCount} · Schools ${schoolCount}`);
        }
        // 获取排名对应的奖牌emoji
        GetRankEmoji(rankClass) {
            switch (rankClass) {
                case 'gold':
                    return '<span class="rank-emoji">🥇</span>';
                case 'silver':
                    return '<span class="rank-emoji">🥈</span>';
                case 'bronze':
                    return '<span class="rank-emoji">🥉</span>';
                case 'star':
                    return '<span class="rank-emoji">⭐</span>';
                default:
                    return '';
            }
        }
        // 解析奖牌比例数据（已迁移到 rank_tool.js）
        ParseAwardRatio(awardRatio) {
            return RankToolParseAwardRatio(awardRatio);
        }
        /**
         * 当前视图下排名列金/银/铜阈值所用的比例与 qtyMode（与 {@link FilterByStarMode} 的归属勾选严格对齐）。
         * - 非多归属 contest_group 或未启用多归属：contest.award_ratio + contest.flg_award_qty_mode。
         * - 多归属且 selectedGroupIds 恰为 1 个：该行的 award_ratio_* + flg_award_qty_mode（与 RankToolApplyMedalFlagsByGroupFromList 同源）。
         * - 多归属且勾选数量≠1：排名列不涂奖牌色；比例仍取赛事主表（仅作非列用途，基数已由 FilterByStarMode 限定为当前勾选并集）。
         */
        GetAwardRatioPackForCurrentView() {
            const contest = this.data?.contest;
            if (!contest) {
                return { gold: 10, silver: 20, bronze: 30, qtyMode: 0 };
            }
            const groups = this.GetContestGroups();
            const master = RankToolParseAwardRatio(contest.award_ratio);
            const masterQty = parseInt(contest.flg_award_qty_mode, 10) === 1 ? 1 : 0;
            if (!this.IsMultiGroupEnabled() || groups.length <= 1) {
                return { gold: master.gold, silver: master.silver, bronze: master.bronze, qtyMode: masterQty };
            }
            const sel = Array.isArray(this.selectedGroupIds) ? this.selectedGroupIds.map(String) : [];
            if (sel.length === 1) {
                const gid = sel[0];
                const hit = groups.find((g) => String(g.group_id) === gid);
                if (hit) {
                    return {
                        gold: parseInt(hit.award_ratio_gold ?? 10, 10) || 0,
                        silver: parseInt(hit.award_ratio_silver ?? 15, 10) || 0,
                        bronze: parseInt(hit.award_ratio_bronze ?? 20, 10) || 0,
                        qtyMode: parseInt(hit.flg_award_qty_mode, 10) === 1 ? 1 : 0,
                    };
                }
            }
            return { gold: master.gold, silver: master.silver, bronze: master.bronze, qtyMode: masterQty };
        }
        // ********** 通用逻辑 - 获奖信息计算 **********
        // 用途：计算金、银、铜牌名次线
        // 涉及功能：队伍榜、学校榜、统计（用于显示获奖信息）
        // 功能：解析获奖比例、计算有效队伍数、计算各奖项名次线
        GetAwardRanks(options = {}) {
            const {
                flg_ac_team_base = true,     // 是否以总数为基数
                customBaseCount = null,    // 自定义基数（优先级最高）
                starMode = null
            } = options;
            if (!this.data || !this.data.contest) {
                console.error("数据未初始化");
                return { rankGold: 0, rankSilver: 0, rankBronze: 0, total: 0 };
            }
            const pack = this.GetAwardRatioPackForCurrentView();
            const tmp_star_mode = starMode === null || starMode === undefined ? this.starMode : starMode;

            // 先调用 FilterByStarMode 设置 isStar 属性，然后再计算有效队伍数
            // FilterByStarMode 会根据 starMode 设置 isStar 属性或过滤掉打星队
            const filteredList = this.FilterByStarMode(this.rankList, tmp_star_mode);

            // 获取有效队伍数（排除打星队和0题队伍）
            // 注意：starMode === 1 时，打星队已被 FilterByStarMode 过滤掉，所以这里只需要检查 isStar
            // starMode === 0 时，打星队 isStar=true，会被排除
            // starMode === 2 时，打星队 isStar=false，会被计入
            const validTeamNum = customBaseCount ? customBaseCount :
                (flg_ac_team_base ?
                    filteredList.filter(item => item.solved > 0 && !item.isStar):
                    filteredList.filter(item => !item.isStar)
                ).length;
            return RankToolGetAwardRank(validTeamNum, pack.gold, pack.silver, pack.bronze, pack.qtyMode);
        }
        /**
         * 将 rankGold/rankSilver/rankBronze 与当前 starMode、赛事归属筛选、获奖比例口径对齐。
         * @param {number} [starModeOverride] 传入时与 UpdateRank(..., starMode) 一致，避免 starMode=0 被当作 falsy。
         */
        UpdateAwardInfo(starModeOverride) {
            const opts = {};
            if (starModeOverride !== null && starModeOverride !== undefined) {
                opts.starMode = starModeOverride;
            }
            const awardRank = this.GetAwardRanks(opts);
            this.rankGold = awardRank.rankGold;
            this.rankSilver = awardRank.rankSilver;
            this.rankBronze = awardRank.rankBronze;
        }
        // 将题目编号转换为字母标识（已迁移到 rank_tool.js）
        GetProblemAlphabetIdx(problemNum) {
            return RankToolGetProblemAlphabetIdx(problemNum);
        }
        // ==========================================
        // 外部调用接口 (Outer API)
        // ==========================================
        // 获取比赛信息
        OuterGetContest() {
            return this.data?.contest || null;
        }
        // 获取队伍列表
        OuterGetTeams() {
            return this.data?.team || [];
        }
        // 获取题目列表
        OuterGetProblems() {
            return this.data?.problem || [];
        }
        // 获取提交记录
        OuterGetSolutions() {
            return this.data?.solution || [];
        }
        // 获取排名列表
        OuterGetRankList(starMode=null) {
            // 针对 starMode 进行 filter，不提供则基于 this.starMode
            const ret_rank_list = this.UpdateRank(false, starMode); // false 表示不执行 render，用于外部调用
            // 针对 starMode 计算实际显示的排名
            return this.CalculateRankInfo(ret_rank_list);
        }
        // 获取获奖比例
        OuterGetAwardRatio() {
            if (!this.data?.contest?.award_ratio) return null;
            return RankToolParseAwardRatio(this.data.contest.award_ratio);
        }
        // 检查数据是否已加载
        OuterIsDataLoaded() {
            return this.data !== null;
        }
        // 获取提交次数显示文本
        GetSubmitCountDisplay(stats) {
            // 如果没有尝试过（submitCount为0），显示题号
            if (!stats.submitCount || stats.submitCount === 0) {
                return stats.problemAlphabetIdx || '?';
            }
            return stats.submitCount;
        }
        // 获取最后提交时间显示文本
        GetLastSubmitTimeDisplay(stats) {
            return stats.lastSubmitTime || '';
        }
        // 获取题目状态类名
        GetProblemStatusClass(stats) {
            return `problem-item pro-${stats.status}`;
        }
        // #########################################
        //  时间回放功能模块
        // #########################################
        // 绑定时间进度条事件
        BindTimeProgressEvents() {
            // header 现在在容器外部
            const header = this.GetHeaderElement();
            const slider = header ? header.querySelector('#time-progress-slider') : null;
            const resetBtn = header ? header.querySelector('#time-reset-btn') : null;
            if (!slider || !resetBtn) return;
            
            // 滑块拖动事件（实时更新显示）
            slider.addEventListener('input', (e) => {
                const progress = parseFloat(e.target.value);
                this.SetReplayTime(progress);
                this.UpdateTimeDisplay();
                this.UpdateTimeProgressTrack();
            });
            
            // 滑块拖动开始事件（进入回放模式，停止自动更新）
            slider.addEventListener('mousedown', () => {
                this.StopTimeProgressAutoUpdate();
            });
            // 触摸设备支持
            slider.addEventListener('touchstart', () => {
                this.StopTimeProgressAutoUpdate();
            });
            
            // 处理滑块拖动结束逻辑
            const handleSliderEnd = (progress) => {
                this.SetReplayTime(progress);
                
                // 检查是否拖动到比当前时间晚的位置
                const totalDuration = this.contestEndTime - this.contestStartTime;
                const progressTime = new Date(this.contestStartTime.getTime() + (progress / 100) * totalDuration);
                const actualCurrentTime = this.GetActualCurrentTime();
                
                if (progressTime >= actualCurrentTime || progress >= 100) {
                    // 如果拖动到当前时间或之后，重置到最新时间
                    this.ResetTimeReplay();
                } else {
                    // 否则进入回放模式
                    // 先设置回放模式标志，这样 UpdateTimeDisplay 才能正确显示回放时间
                    this.timeReplayMode = true;
                    // 直接调用 ApplyTimeReplay，它会先快速更新UI，然后异步处理数据
                    this.ApplyTimeReplay();
                }
            };
            
            // 滑块拖动结束事件（鼠标）
            slider.addEventListener('change', (e) => {
                const progress = parseFloat(e.target.value);
                handleSliderEnd(progress);
            });
            
            // 触摸设备拖动结束事件
            slider.addEventListener('touchend', (e) => {
                const progress = parseFloat(e.target.value);
                handleSliderEnd(progress);
            });
            
            // 重置按钮事件
            resetBtn.addEventListener('click', () => {
                this.ResetTimeReplay();
            });
        }
        // 获取实际当前时间（前端时间 + 后端时间差）
        GetActualCurrentTime() {
            return new Date(new Date().getTime() + this.backendTimeDiff);
        }
        
        // 初始化时间进度条
        InitializeTimeProgress() {
            if (!this.data || !this.data.contest) return;
            this.contestStartTime = this._rankNaiveSqlToDate(this.data.contest.start_time);
            this.contestEndTime = this._rankNaiveSqlToDate(this.data.contest.end_time);
            const totalDuration = this.contestEndTime - this.contestStartTime;
            
            // 更新总时间显示（header 现在在容器外部）
            const header = this.GetHeaderElement();
            const totalTimeSpan = header ? header.querySelector('#time-progress-total') : null;
            if (totalTimeSpan) {
                totalTimeSpan.textContent = RankToolFormatDuration(totalDuration);
            }
            
            // 更新进度条位置和时间显示
            this.UpdateTimeProgress();
            
            // 启动自动更新定时器（每秒更新）
            this.StartTimeProgressAutoUpdate();
        }
        
        // 更新进度条位置和时间显示
        UpdateTimeProgress() {
            if (!this.contestStartTime || !this.contestEndTime) return;
            
            // 如果处于回放模式，不自动更新
            if (this.timeReplayMode) return;
            
            const totalDuration = this.contestEndTime - this.contestStartTime;
            const actualCurrentTime = this.GetActualCurrentTime();
            
            // 计算已过时间：早于开始时间为0，晚于结束时间为总时长
            let elapsedTime = 0;
            if (actualCurrentTime < this.contestStartTime) {
                elapsedTime = 0;
            } else if (actualCurrentTime > this.contestEndTime) {
                elapsedTime = totalDuration;
            } else {
                elapsedTime = actualCurrentTime - this.contestStartTime;
            }
            
            // 更新滑块位置（header 现在在容器外部）
            const header = this.GetHeaderElement();
            const slider = header ? header.querySelector('#time-progress-slider') : null;
            if (slider) {
                const progress = Math.min(100, Math.max(0, (elapsedTime / totalDuration) * 100));
                slider.value = progress;
            }
            
            // 更新时间显示
            this.UpdateTimeDisplay();
            
            // 更新进度条背景色
            this.UpdateTimeProgressTrack();
        }
        
        // 更新进度条背景色（基于实际当前时间，而不是滑块位置）
        UpdateTimeProgressTrack() {
            // header 现在在容器外部
            const header = this.GetHeaderElement();
            const track = header ? header.querySelector('.time-progress-track') : null;
            const slider = header ? header.querySelector('#time-progress-slider') : null;
            if (!track || !slider) return;
            
            if (!this.contestStartTime || !this.contestEndTime) return;
            
            const actualCurrentTime = this.GetActualCurrentTime();
            const totalDuration = this.contestEndTime - this.contestStartTime;
            
            // 计算实际当前时间对应的进度百分比
            let currentProgress = 0;
            if (actualCurrentTime < this.contestStartTime) {
                currentProgress = 0;
            } else if (actualCurrentTime > this.contestEndTime) {
                currentProgress = 100;
            } else {
                const elapsedTime = actualCurrentTime - this.contestStartTime;
                currentProgress = Math.min(100, Math.max(0, (elapsedTime / totalDuration) * 100));
            }
            
            // 设置背景色的宽度为当前时间对应的进度
            track.style.width = `${currentProgress}%`;
            track.style.opacity = '1';
            
            // 轮廓始终覆盖整个进度条，无需调整位置
        }
        
        // 启动时间进度条自动更新
        StartTimeProgressAutoUpdate() {
            // 清除已有定时器
            this.StopTimeProgressAutoUpdate();
            // 每秒更新一次
            this.timeProgressInterval = setInterval(() => {
                if (!this.timeReplayMode) {
                    this.UpdateTimeProgress();
                }
            }, 1000);
        }
        
        // 停止时间进度条自动更新
        StopTimeProgressAutoUpdate() {
            if (this.timeProgressInterval) {
                clearInterval(this.timeProgressInterval);
                this.timeProgressInterval = null;
            }
        }
        // 设置回放时间
        SetReplayTime(progress) {
            if (!this.contestStartTime || !this.contestEndTime) return;
            const totalDuration = this.contestEndTime - this.contestStartTime;
            const replayDuration = (progress / 100) * totalDuration;
            this.replayTime = new Date(this.contestStartTime.getTime() + replayDuration);
        }
        // 更新时间显示
        UpdateTimeDisplay() {
            // header 现在在容器外部
            const header = this.GetHeaderElement();
            const currentTimeSpan = header ? header.querySelector('#time-progress-current') : null;
            if (!currentTimeSpan) return;
            
            // 根据回放模式添加/移除样式类，用于视觉区分
            if (this.timeReplayMode && this.replayTime) {
                // 回放模式：显示回放时间，添加回放样式类
                const elapsedTime = this.replayTime - this.contestStartTime;
                currentTimeSpan.textContent = RankToolFormatDuration(elapsedTime);
                currentTimeSpan.classList.add('time-replay-mode');
            } else {
                // 正常模式：显示实际当前时间，移除回放样式类
                const actualCurrentTime = this.GetActualCurrentTime();
                const totalDuration = this.contestEndTime - this.contestStartTime;
                let elapsedTime = 0;
                if (actualCurrentTime < this.contestStartTime) {
                    elapsedTime = 0;
                } else if (actualCurrentTime > this.contestEndTime) {
                    elapsedTime = totalDuration;
                } else {
                    elapsedTime = actualCurrentTime - this.contestStartTime;
                }
                currentTimeSpan.textContent = RankToolFormatDuration(elapsedTime);
                currentTimeSpan.classList.remove('time-replay-mode');
            }
        }
        // 应用时间回放
        ApplyTimeReplay() {
            // timeReplayMode 已在调用前设置，这里只确保状态正确
            if (!this.timeReplayMode) {
                this.timeReplayMode = true;
            }
            // 确保停止自动更新
            this.StopTimeProgressAutoUpdate();
            
            // 先快速更新UI（时间显示和进度条），让用户立即看到反馈
            this.UpdateTimeDisplay();
            this.UpdateTimeProgressTrack();
            
            // 然后进行耗时的数据处理和榜单更新（异步执行，不阻塞UI）
            // 使用 requestAnimationFrame 或 setTimeout 让浏览器先渲染UI更新
            requestAnimationFrame(() => {
                // 重新处理数据（包括重新计算一血），只处理回放时间之前的提交
                this.ProcessData();
                // 更新header统计信息（根据回放时间更新题目统计）
                this.RecreateHeaderRow();
                this.UpdateRank();
            });
        }
        // 重置时间回放
        ResetTimeReplay() {
            const start = new Date().getTime()
            this.timeReplayMode = false;
            this.replayTime = null;
            
            // 先快速更新UI（进度条和时间显示），让用户立即看到反馈
            this.UpdateTimeProgress();
            
            // 重新启动自动更新
            this.StartTimeProgressAutoUpdate();
            
            // 然后进行耗时的数据处理和榜单更新（异步执行，不阻塞UI）
            requestAnimationFrame(() => {
                // 重新处理数据（包括重新计算一血），处理所有提交
                this.ProcessData();
                // 更新header统计信息（恢复为所有提交的统计）
                this.RecreateHeaderRow();
                this.UpdateRank();
            });
        }
        // 格式化持续时间（已迁移到 rank_tool.js）
        FormatDuration(milliseconds) {
            return RankToolFormatDuration(milliseconds);
        }
        // 计算动画持续时间（已迁移到 rank_tool.js）
        CalculateAnimationDuration(baseDuration = null) {
            const base = baseDuration !== null ? baseDuration : this.baseAnimationDuration;
            const speedMultiplier = this.rollSpeedMultiplier || 1.0; // rollSpeedMultiplier 由子类 RankRollSystem 提供
            return RankToolCalculateAnimationDuration(base, speedMultiplier, this.minAnimationDuration, this.maxAnimationDuration);
        }
        // 平滑滚动到底部（带加减速动画，有仪式感）
        // 用途：启动滚榜时，以优雅的方式滚动到榜单底部
        // #########################################
        //  工具方法和辅助功能模块
        // #########################################
        // ********** 统计 - 题目统计计算 **********
        // 用途：计算每个题目的提交统计（AC、WA、TLE等）
        // 涉及功能：统计（主功能）、队伍榜（表头显示统计）
        // 功能：统计每题的总提交数、各结果类型的提交数、参与提交的队伍数
        CalculateProblemStats() {
            const problemStats = {};
            if (!this.data || !this.data.problem || !this.data.solution) {
                return problemStats;
            }
            // 初始化所有题目的统计
            this.data.problem.forEach(problem => {
                problemStats[problem.problem_id] = {
                    ac: 0,              // AC提交数
                    total: 0,           // 总提交数
                    acTeams: 0,         // AC队伍数
                    totalTeams: 0       // 总提交队伍数
                };
            });
            
            // 用于记录每个题目的队伍集合（用于统计队伍数）
            const teamSets = {};
            const acTeamSets = {};
            this.data.problem.forEach(problem => {
                teamSets[problem.problem_id] = new Set();
                acTeamSets[problem.problem_id] = new Set();
            });
            
            // 统计每个题目的提交情况
            this.data.solution.forEach(solution => {
                const problemId = solution.problem_id;
                if (!problemStats[problemId]) return;
                
                // 如果处于回放模式，只统计回放时间之前的提交
                if (this.timeReplayMode && this.replayTime) {
                    const submitTime = this._rankNaiveSqlToDate(solution.in_date);
                    if (submitTime > this.replayTime) {
                        return; // 跳过回放时间之后的提交
                    }
                }
                
                const teamId = solution.team_id;
                
                // 统计提交数（原来的逻辑）
                problemStats[problemId].total++;
                if (solution.result === 4) { // AC
                    problemStats[problemId].ac++;
                    // 记录AC的队伍
                    acTeamSets[problemId].add(teamId);
                }
                
                // 记录尝试过该题目的队伍（无论是否AC）
                teamSets[problemId].add(teamId);
            });
            
            // 计算队伍数
            this.data.problem.forEach(problem => {
                const problemId = problem.problem_id;
                problemStats[problemId].acTeams = acTeamSets[problemId].size;
                problemStats[problemId].totalTeams = teamSets[problemId].size;
            });
            
            return problemStats;
        }
        // 解析颜色（已迁移到 rank_tool.js）
        ParseColor(colorString) {
            return RankToolParseColor(colorString);
        }
        // 重新创建表头（数据加载完成后调用）
        RecreateHeaderRow() {
            const existingHeaderRow = this.container.querySelector('.rank-header-row');
            if (existingHeaderRow) {
                const newHeaderRow = this.CreateHeaderRow();
                existingHeaderRow.parentNode.replaceChild(newHeaderRow, existingHeaderRow);
            }
        }
        // 创建美观的鼠标悬停提示信息
        CreateTooltipTitle(titlecn, titleen) {
            if (!titlecn && !titleen) return '';
            let tooltip = '';
            if (titlecn && titleen) {
                tooltip = `${titlecn}\n${titleen}`;
            } else if (titlecn) {
                tooltip = titlecn;
            } else if (titleen) {
                tooltip = titleen;
            }
            return tooltip;
        }
        // 生成双语title属性（已迁移到 rank_tool.js）
        GenerateBilingualTitle(titlecn, titleen) {
            return RankToolGenerateBilingualTitle(titlecn, titleen);
        }
        // 生成双语HTML属性（已迁移到 rank_tool.js）
        GenerateBilingualAttributes(titlecn, titleen) {
            return RankToolGenerateBilingualAttributes(titlecn, titleen);
        }
        // 专用tooltip处理函数：problem-item
        GenerateProblemItemTooltip(element) {
            // 从class中提取状态信息
            const classList = element.classList;
            let status = 'none';
            let statusText = '未知';
            let statusTextEn = 'Unknown';
            if (classList.contains('pro-ac')) {
                status = 'ac';
                statusText = '已通过';
                statusTextEn = 'Accepted';
            } else if (classList.contains('pro-wa')) {
                status = 'wa';
                statusText = '未通过';
                statusTextEn = 'Wrong Answer';
            } else if (classList.contains('pro-pending')) {
                status = 'pending';
                statusText = '等待或封榜';
                statusTextEn = 'Pending or Frozen';
            }
            // 从data属性中提取信息
            const problemAlphabetIdx = element.getAttribute('d-pro-idx') || '?';
            const submitCount = element.getAttribute('d-sub-cnt') || '0';
            const lastSubmitTime = element.getAttribute('d-last-sub') || '';
            // 生成tooltip内容
            const titlecn = `题目${problemAlphabetIdx}: ${statusText}，${submitCount}次提交, 最后提交: ${lastSubmitTime || '无'}`;
            const titleen = `Problem ${problemAlphabetIdx}: ${statusTextEn}, ${submitCount} submission(s), Last submit: ${lastSubmitTime || 'None'}`;
            return { titlecn, titleen };
        }
        // 检查元素是否有专用tooltip处理函数
        HasSpecialTooltipHandler(element) {
            // 检查元素是否有注册的专用处理函数
            for (const className in this.specialTooltipHandlers) {
                if (element.classList.contains(className)) {
                    return className;
                }
            }
            return null;
        }
        // 获取专用tooltip内容
        GetSpecialTooltipContent(element, handlerKey) {
            const handler = this.specialTooltipHandlers[handlerKey];
            if (handler) {
                return handler(element);
            }
            return null;
        }
        // 确保tooltip可用（智能重建）
        EnsureTooltipReady() {
            // 如果tooltip不存在，直接创建
            if (!this.globalTooltip) {
                this.CreateTooltip();
                return;
            }
            
            // 检查tooltip是否正常（通过getBoundingClientRect判断）
            this.globalTooltip.style.display = 'block';
            this.globalTooltip.style.visibility = 'visible';
            this.globalTooltip.style.opacity = '1';
            this.globalTooltip.style.left = '0px';
            this.globalTooltip.style.top = '0px';
            
            // 强制重新计算布局
            this.globalTooltip.offsetHeight;
            this.globalTooltip.offsetWidth;
            
            const rect = this.globalTooltip.getBoundingClientRect();
            
            // 如果尺寸为0，说明tooltip状态异常，需要重建
            if (rect.width === 0 && rect.height === 0) {
                this.DestroyTooltip();
                this.CreateTooltip();
            }
        }
        
        // 创建tooltip
        CreateTooltip() {
            this.globalTooltip = document.createElement('div');
            this.globalTooltip.className = 'rank-tooltip rank-tooltip-top';
            this.globalTooltip.style.position = 'fixed';
            this.globalTooltip.style.zIndex = '100009';
            this.globalTooltip.style.display = 'none';
            
            // 创建tooltip内容结构
            this.globalTooltipContent = document.createElement('div');
            this.globalTooltipContent.className = 'rank-tooltip-content';
            this.globalTooltip.appendChild(this.globalTooltipContent);
            
            // 添加到container
            this.container.appendChild(this.globalTooltip);
        }
        
        // 销毁tooltip
        DestroyTooltip() {
            if (this.globalTooltip && this.globalTooltip.parentNode) {
                this.globalTooltip.parentNode.removeChild(this.globalTooltip);
            }
            this.globalTooltip = null;
            this.globalTooltipContent = null;
        }
        // 显示tooltip到指定元素
        ShowTooltipForElement(element, titlecn, titleen, event = null) {
            if (!titlecn && !titleen) return;
            
            // 确保tooltip可用（智能重建）
            this.EnsureTooltipReady();
            
            // 更新内容
            this.globalTooltipContent.innerHTML = '';
            if (titlecn) {
                const cnDiv = document.createElement('div');
                cnDiv.className = 'rank-tooltip-cn';
                cnDiv.textContent = titlecn;
                this.globalTooltipContent.appendChild(cnDiv);
            }
            if (titleen) {
                const enDiv = document.createElement('div');
                enDiv.className = 'rank-tooltip-en';
                enDiv.textContent = titleen;
                this.globalTooltipContent.appendChild(enDiv);
            }
            
            // 显示tooltip
            this.globalTooltip.style.display = 'block';
            this.globalTooltip.style.opacity = '1';
            this.globalTooltip.style.visibility = 'visible';
            this.globalTooltip.classList.add('show');
            
            // 计算并设置位置
            this.UpdateTooltipPosition(this.globalTooltip, element, event);
        }
        // 隐藏tooltip
        HideGlobalTooltip() {
            if (this.globalTooltip) {
                this.globalTooltip.style.display = 'none';
                this.globalTooltip.classList.remove('show');
            }
        }
        // 检测是否为可点击的功能对象
        IsClickableElement(element) {
            // 检查是否在controls-toolbar内
            const toolbar = element.closest('.controls-toolbar');
            if (toolbar) return true;
            // 检查是否有点击事件监听器
            const hasClickHandler = element.onclick || 
                element.getAttribute('onclick') || 
                element.classList.contains('control-btn') ||
                element.classList.contains('custom-select-btn') ||
                element.classList.contains('toolbar-item');
            return hasClickHandler;
        }
        // 显示tooltip (保留兼容性)
        ShowTooltip(tooltip, element) {
            if (this.globalTooltip) {
                this.globalTooltip.classList.add('show');
                this.UpdateTooltipPosition(this.globalTooltip, element);
            }
        }
        // 隐藏tooltip (保留兼容性)
        HideTooltip(tooltip) {
            if (this.globalTooltip) {
                this.globalTooltip.classList.remove('show');
            }
        }
        // 更新tooltip位置
        UpdateTooltipPosition(tooltip, element, event = null) {
            if (!tooltip) return;
            
            // 获取tooltip尺寸
            const tooltipRect = tooltip.getBoundingClientRect();
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            
            // 计算位置
            this.CalculateTooltipPosition(tooltip, element, event, tooltipRect, viewport);
        }
        // 计算tooltip位置的核心逻辑
        CalculateTooltipPosition(tooltip, element, event, tooltipRect, viewport) {
            let position = 'top';
            let left;
            let top;
            // 优先使用鼠标位置，如果没有则使用元素位置
            if (event && event.clientX !== undefined && event.clientY !== undefined) {
                // 默认：tooltip在鼠标上方，箭头指向鼠标
                // 箭头在tooltip底部中央，所以tooltip的left应该是鼠标X - tooltip宽度的一半
                left = event.clientX - tooltipRect.width / 2;
                top = event.clientY - tooltipRect.height - 12; // 鼠标上方12px
            } else {
                // 回退到元素位置
                const rect = element.getBoundingClientRect();
                left = rect.left + rect.width / 2 - tooltipRect.width / 2;
                top = rect.top - tooltipRect.height - 12;
            }
            // 边界检测和调整
            // 检查上边界
            if (top < 10) {
                position = 'bottom';
                if (event && event.clientY !== undefined) {
                    // tooltip在鼠标下方，箭头在tooltip顶部中央指向鼠标
                    top = event.clientY + 12; // 鼠标下方12px
                    left = event.clientX - tooltipRect.width / 2; // 箭头指向鼠标
                } else {
                    const rect = element.getBoundingClientRect();
                    top = rect.bottom + 12;
                }
            }
            // 检查左边界
            if (left < 10) {
                left = 10;
            }
            // 检查右边界
            if (left + tooltipRect.width > viewport.width - 10) {
                if (event && event.clientX !== undefined) {
                    // tooltip在鼠标左侧，箭头在tooltip右侧中央指向鼠标
                    left = event.clientX - tooltipRect.width - 12; // 鼠标左侧12px
                    top = event.clientY - tooltipRect.height / 2; // 箭头指向鼠标
                } else {
                    left = viewport.width - tooltipRect.width - 10;
                }
            }
            // 检查下边界
            if (top + tooltipRect.height > viewport.height - 10) {
                position = 'top';
                if (event && event.clientY !== undefined) {
                    // tooltip在鼠标上方，箭头在tooltip底部中央指向鼠标
                    top = event.clientY - tooltipRect.height - 12; // 鼠标上方12px
                    left = event.clientX - tooltipRect.width / 2; // 箭头指向鼠标
                } else {
                    const rect = element.getBoundingClientRect();
                    top = rect.top - tooltipRect.height - 12;
                }
            }
            // 最终边界检查
            left = Math.max(10, Math.min(left, viewport.width - tooltipRect.width - 10));
            top = Math.max(10, Math.min(top, viewport.height - tooltipRect.height - 10));
            // 应用位置（使用fixed定位，不需要滚动偏移）
            tooltip.className = `rank-tooltip rank-tooltip-${position} show`;
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        }
        // 简单的GET请求封装
        async GetRequest(url, params = {}) {
            try {
                const urlParams = new URLSearchParams();
    
                // 遍历参数，自动处理数组
                Object.entries(params).forEach(([key, value]) => {
                  // 跳过 undefined、null 和空字符串（但保留数字 0）
                  if (value === undefined || value === null || (typeof value === 'string' && value === '')) {
                    return;
                  }
                  
                  if (Array.isArray(value)) {
                    // 数组参数：逐个 append，生成 key[]=v1&key[]=v2
                    value.forEach(v => {
                      if (v !== undefined && v !== null && v !== '') {
                        urlParams.append(key, v);
                      }
                    });
                  } else {
                    // 普通参数：直接添加
                    urlParams.append(key, value);
                  }
                });
                const joinChar = String(url).includes('?') ? '&' : '?';
                const fullUrl = urlParams.toString() ? `${url}${joinChar}${urlParams}` : url;
                const response = await fetch(fullUrl, {
                    method: 'GET',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/json'
                    }
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                console.error('GET请求失败:', error);
                throw error;
            }
        }
        SwitchMode(mode) {
            // 设置新模式
            this.currentMode = mode;
            // 更新URL anchor参数
            this.UpdateAnchor(mode);
            this.SaveViewPrefs();
            // 重置初始加载标志，确保切换模式时显示白色蒙版
            this.isInitialLoad = true;
            // 重新初始化整个系统（推倒重来）
            this.Init();
        }
        // 更新header中的表头
        UpdateHeaderTableHeader() {
            const tableHeaderRow = this.container.querySelector('.rank-header-row');
            if (!tableHeaderRow) return;
            const teamLabel = this.currentMode === 'school' ? 
                this.CreateBilingualText(' 学校/组织 ', 'School') : 
                this.CreateBilingualText('队伍', 'Team');
            const teamCol = tableHeaderRow.querySelector('.rank-col-team');
            if (teamCol) {
                teamCol.innerHTML = teamLabel;
            }
        }
        UpdatePageTitle() {
            if (!this.data) return;
            // 根据当前模式决定是否显示标题
            const shouldShowTitle = this.isFullscreen 
                ? this.config.flg_show_fullscreen_contest_title 
                : this.config.flg_show_page_contest_title;
            if (!shouldShowTitle) return;
            const title = this.data.contest.title;
            const modeText = {
                team: '队伍排名',
                school: ' 学校/组织 排名',
                roll: '滚榜'
            };
            if (this.elements.pageTitle) {
                // 如果currentMode不是有效模式，使用默认的team模式
                const displayMode = modeText[this.currentMode] || modeText['team'];
                this.elements.pageTitle.textContent = `${title} - ${displayMode}`;
            }
        }
        // ********** 统计 - 显示统计信息 **********
        // 用途：显示题目提交统计表格
        // 涉及功能：统计（主功能）
        // 功能：生成统计表格HTML、显示各题目各结果类型的统计、显示合计
        ShowSummary() {
            if (!this.data) return;
            const summaryHtml = this.GenerateSummaryHtml();
            this.elements.summaryContent.innerHTML = summaryHtml;
            this.ShowModal('summary');
        }
        GenerateSummaryHtml() {
            const problems = this.data.problem;
            const solutions = this.data.solution || [];
            // 统计每个题目的提交情况
            const problemStats = {};
            problems.forEach(problem => {
                problemStats[problem.problem_id] = {
                    total: 0,
                    ac: 0,
                    wa: 0,
                    tle: 0,
                    mle: 0,
                    re: 0,
                    ce: 0,
                    pe: 0
                };
            });
            solutions.forEach(solution => {
                const problemId = solution.problem_id;
                if (problemStats[problemId]) {
                    problemStats[problemId].total++;
                    switch (solution.result) {
                        case 4: problemStats[problemId].ac++; break;
                        case 5: problemStats[problemId].pe++; break;
                        case 6: problemStats[problemId].wa++; break;
                        case 7: problemStats[problemId].tle++; break;
                        case 8: problemStats[problemId].mle++; break;
                        case 9: problemStats[problemId].re++; break;
                        case 10: problemStats[problemId].re++; break;
                        case 11: problemStats[problemId].ce++; break;
                    }
                }
            });
            let html = '<table class="summary-table"><thead><tr><th><div class="bilingual-header"><span class="header-cn">结果</span><span class="header-en">Result</span></div></th>';
            problems.forEach(problem => {
                html += `<th>${RankToolGetProblemAlphabetIdx(problem.num)}</th>`;
            });
            html += '<th><div class="bilingual-header"><span class="header-cn">合计</span><span class="header-en">Total</span></div></th></tr></thead><tbody>';
            const resultTypes = [
                { key: 'ac', name: 'AC', class: 'success' },
                { key: 'wa', name: 'WA', class: 'danger' },
                { key: 'tle', name: 'TLE', class: 'warning' },
                { key: 'mle', name: 'MLE', class: 'warning' },
                { key: 're', name: 'RE', class: 'warning' },
                { key: 'ce', name: 'CE', class: 'info' },
                { key: 'pe', name: 'PE', class: 'danger' }
            ];
            resultTypes.forEach(result => {
                html += `<tr><td>${result.name}</td>`;
                let total = 0;
                problems.forEach(problem => {
                    const count = problemStats[problem.problem_id][result.key];
                    total += count;
                    html += `<td>${count}</td>`;
                });
                html += `<td>${total}</td></tr>`;
            });
            html += '<tr><td><div class="bilingual-header"><span class="header-cn">合计</span><br/><span class="header-en">Total</span></div></td>';
            let grandTotal = 0;
            problems.forEach(problem => {
                const total = problemStats[problem.problem_id].total;
                grandTotal += total;
                html += `<td>${total}</td>`;
            });
            html += `<td>${grandTotal}</td></tr></tbody></table>`;
            return html;
        }
        ToggleFullscreen() {
            if (!document.fullscreenElement) {
                // 进入全屏
                try {
                    if (this.container.requestFullscreen) {
                        this.container.requestFullscreen();
                    } else if (this.container.webkitRequestFullscreen) { /* Safari */
                        this.container.webkitRequestFullscreen();
                    } else if (this.container.msRequestFullscreen) { /* IE11 */
                        this.container.msRequestFullscreen();
                    }
                    this.isFullscreen = true;
                    this.container.classList.add('fullscreen');
                } catch(e) {
                    console.error('Error attempting to enable full-screen mode:', e);
                }
            } else {
                // 退出全屏
                try {
                    if (document.exitFullscreen) {
                        document.exitFullscreen();
                    } else if (document.webkitExitFullscreen) { /* Safari */
                        document.webkitExitFullscreen();
                    } else if (document.msExitFullscreen) { /* IE11 */
                        document.msExitFullscreen();
                    }
                    this.isFullscreen = false;
                    this.container.classList.remove('fullscreen');
                } catch(e) {
                    console.error('Error attempting to exit full-screen mode:', e);
                }
            }
        }
        // 监听全屏状态变化
        BindFullscreenEvents() {
            // 监听全屏状态变化事件
            document.addEventListener('fullscreenchange', () => {
                this.HandleFullscreenChange();
            });
            document.addEventListener('webkitfullscreenchange', () => {
                this.HandleFullscreenChange();
            });
            document.addEventListener('mozfullscreenchange', () => {
                this.HandleFullscreenChange();
            });
            document.addEventListener('MSFullscreenChange', () => {
                this.HandleFullscreenChange();
            });
        }
        // 处理全屏状态变化
        HandleFullscreenChange() {
            const isCurrentlyFullscreen = !!document.fullscreenElement || 
                                        !!document.webkitFullscreenElement || 
                                        !!document.mozFullScreenElement || 
                                        !!document.msFullscreenElement;
            if (isCurrentlyFullscreen !== this.isFullscreen) {
                this.isFullscreen = isCurrentlyFullscreen;
            if (this.isFullscreen) {
                if (this.currentMode === 'roll') {
                    const rankContainer = this.container;
                    if (rankContainer) {
                        rankContainer.classList.add('fullscreen');
                    }
                } else {
                    this.container.classList.add('fullscreen');
                }
            } else {
                // 退出全屏时：关闭并重置倒计时与滚动
                this.StopTimeOverlay();
                this.showTimeOverlay = false;
                this.StopAutoScroll();
                this.autoScrollMode = 0;
                // 滚榜模式：移除全屏类
                if (this.currentMode === 'roll') {
                    const rankContainer = this.container;
                    if (rankContainer) {
                        rankContainer.classList.remove('fullscreen');
                    }
                }
                this.container.classList.remove('fullscreen');
            }
                // 重新创建header以应用新的标题显示配置
                this.RecreateHeader();
            }
        }
        // 重新创建header（用于全屏切换时更新标题显示）
        RecreateHeader() {
            // 移除旧的header（从容器外部查找）
            const oldHeader = this.GetHeaderElement();
            if (oldHeader) {
                oldHeader.remove();
            }
            // 重新创建header（会自动插入到容器外部）
            this.CreateHeader();
            // UpdateHeaderVisibility 已经在 CreateHeader 中调用了
            
            // 重新初始化elements，确保按钮引用正确
            this.InitElements();
            // 重新绑定事件
            this.BindHeaderEvents();
            // 按当前模式同步队伍/学校排名按钮高亮（避免全屏退出后高亮错位）
            this.InitializeMode();
            // 为新建的 header 绑定动态 tooltip（与 Init 中一致）
            const newHeader = this.GetHeaderElement();
            if (newHeader) this.SetupDynamicTooltips(newHeader);
            // 更新页面标题
            this.UpdatePageTitle();
        }
        BindRankModeIndicatorXlsxEaster() {
            if (!this._rankXlsxEasterHandlerBound) {
                this._rankXlsxEasterHandlerBound = (e) => {
                    const el = e.target && e.target.closest && e.target.closest('#rank-mode-indicator');
                    if (!el) return;
                    const hdr = this.GetHeaderElement();
                    if (!hdr || !hdr.contains(el)) return;
                    this.ExportRankXlsxEaster().catch((err) => {
                        console.error('[RankSystem] rank xlsx export', err);
                        if (typeof this.ShowMessage === 'function') {
                            this.ShowMessage('导出失败，请稍后重试');
                        }
                    });
                };
            }
            if (this._rankXlsxEasterDocBound) {
                document.removeEventListener('dblclick', this._rankXlsxEasterDocBound, true);
            }
            document.addEventListener('dblclick', this._rankXlsxEasterHandlerBound, true);
            this._rankXlsxEasterDocBound = this._rankXlsxEasterHandlerBound;
        }
        _GetOrderedProblemIdsForExport() {
            if (!this.problemMap || Object.keys(this.problemMap).length === 0) return [];
            return Object.keys(this.problemMap).sort(
                (a, b) => this.problemMap[a].num - this.problemMap[b].num
            );
        }
        _RankExportSheetNameSafe(base) {
            let s = String(base || 'sheet').replace(/[:\\/?*[\\]]/g, '_');
            if (typeof csg !== 'undefined' && csg.sanitizeFilename) {
                s = csg.sanitizeFilename(s);
            }
            if (s.length > 31) s = s.slice(0, 31);
            return s || 'sheet';
        }
        _RankExportBuildFilename(cid, contestTitle) {
            const ts = Date.now();
            const titleRaw = String(contestTitle || '').trim() || 'contest';
            let titleSeg = titleRaw.replace(/\s+/g, '_').replace(/[<>:"/\\|?*]/g, '');
            if (typeof csg !== 'undefined' && csg.sanitizeFilename) {
                titleSeg = csg.sanitizeFilename(titleRaw);
            }
            const cidSeg = String(cid || '0').replace(/[^\w.-]+/g, '');
            return `${cidSeg}-${titleSeg}-${ts}.xlsx`;
        }
        /**
         * 彩蛋：双击 #rank-mode-indicator 导出当前筛选与打星口径下的队伍榜、学校榜 xlsx。
         */
        async ExportRankXlsxEaster() {
            if (this.currentMode === 'roll') {
                if (typeof this.ShowMessage === 'function') {
                    this.ShowMessage('滚榜模式下请切换到队伍排名后再导出');
                }
                return;
            }
            if (typeof ExcelJS === 'undefined') {
                if (typeof this.ShowMessage === 'function') {
                    this.ShowMessage('导出组件未加载');
                }
                return;
            }
            if (!this.data || !this.data.contest) {
                if (typeof this.ShowMessage === 'function') {
                    this.ShowMessage('暂无比赛数据');
                }
                return;
            }
            if (!Array.isArray(this.rankList) || this.rankList.length === 0) {
                if (typeof this.ShowMessage === 'function') {
                    this.ShowMessage('暂无榜单数据');
                }
                return;
            }
            if (this._rankXlsxExporting) return;
            this._rankXlsxExporting = true;
            try {
                const problemIds = this._GetOrderedProblemIdsForExport();
                const probHeaders = problemIds.map((pid) =>
                    RankToolGetProblemAlphabetIdx(this.problemMap[pid].num)
                );
                const contest = this.data.contest;
                const contestTitle = String(contest.title || '').trim() || 'contest';
                const cid = String(contest.contest_id ?? this.config.key ?? '0');

                const filteredSorted = this.FilterByStarMode(this.rankList, this.starMode).slice();
                filteredSorted.sort((a, b) => this.CompareTeamsForRanking(a, b));
                const teamRows = this.CalculateRankInfo(this.ApplyKeywordFilters(filteredSorted, 'team'));
                const schoolSource = this.CalculateSchoolRank(filteredSorted);
                const schoolRows = this.CalculateRankInfo(this.ApplyKeywordFilters(schoolSource, 'school'));

                const thin = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
                const headerFill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE7EEF7' },
                };
                const titleFont = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1F2937' } };
                const headerFont = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF111827' } };
                const bodyFont = { name: 'Calibri', size: 11, color: { argb: 'FF374151' } };

                const wb = new ExcelJS.Workbook();
                wb.creator = 'CSGOJ2';
                wb.created = new Date();
                wb.modified = new Date();

                const teamHeaders = [
                    '排名', '学校', '队伍', '英文队名', '教练', '选手', '题数', '罚时(分钟)', ...probHeaders,
                ];
                this._WriteRankExportWorksheet(wb.addWorksheet(this._RankExportSheetNameSafe('队伍排名')), {
                    sheetTitle: `队伍排名 · ${contestTitle}`,
                    headers: teamHeaders,
                    numericCols1Based: new Set([7, 8]),
                    colWidths: [6, 22, 22, 20, 14, 28, 7, 12, ...problemIds.map(() => 12)],
                    thin,
                    headerFill,
                    titleFont,
                    headerFont,
                    bodyFont,
                    rows: teamRows,
                    rowValues: (item) => {
                        const team = item.team || {};
                        const rankDisp = item.isStar ? '*' : String(item.displayRank ?? '');
                        const penMin = parseInt(RankjsFormatSecondsToMinutes(item.penalty), 10);
                        const vals = [
                            rankDisp,
                            String(team.school || ''),
                            String(team.name || ''),
                            String(team.name_en || '').trim() ? String(team.name_en) : '',
                            String(team.coach || ''),
                            String(team.tmember || ''),
                            item.solved,
                            Number.isFinite(penMin) ? penMin : 0,
                        ];
                        problemIds.forEach((pid) => {
                            const stats = item.problemStats[pid] || {
                                status: 'none',
                                submitCount: 0,
                                lastSubmitTime: '',
                            };
                            vals.push(RankjsRankExportProblemCell(stats));
                        });
                        return vals;
                    },
                });

                const schoolHeaders = [
                    '排名', '学校', '队伍数', '队伍', '英文队名', '教练', '选手', '题数', '罚时(分钟)', ...probHeaders,
                ];
                this._WriteRankExportWorksheet(wb.addWorksheet(this._RankExportSheetNameSafe('学校排名')), {
                    sheetTitle: `学校排名 · ${contestTitle}`,
                    headers: schoolHeaders,
                    numericCols1Based: new Set([8, 9]),
                    colWidths: [6, 22, 8, 22, 20, 14, 28, 7, 12, ...problemIds.map(() => 12)],
                    thin,
                    headerFill,
                    titleFont,
                    headerFont,
                    bodyFont,
                    rows: schoolRows,
                    rowValues: (item) => {
                        const team = item.team || {};
                        const rankDisp = item.isStar ? '*' : String(item.displayRank ?? '');
                        const penMin = parseInt(RankjsFormatSecondsToMinutes(item.penalty), 10);
                        const vals = [
                            rankDisp,
                            String(item.school || ''),
                            item.teamCount != null && item.teamCount !== undefined
                                ? String(item.teamCount)
                                : '',
                            String(team.name || ''),
                            String(team.name_en || '').trim() ? String(team.name_en) : '',
                            String(team.coach || ''),
                            String(team.tmember || ''),
                            item.solved,
                            Number.isFinite(penMin) ? penMin : 0,
                        ];
                        problemIds.forEach((pid) => {
                            const stats = item.problemStats[pid] || {
                                status: 'none',
                                submitCount: 0,
                                lastSubmitTime: '',
                            };
                            vals.push(RankjsRankExportProblemCell(stats));
                        });
                        return vals;
                    },
                });

                const buffer = await wb.xlsx.writeBuffer();
                const blob = new Blob([buffer], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = this._RankExportBuildFilename(cid, contestTitle);
                a.click();
                URL.revokeObjectURL(url);
            } finally {
                this._rankXlsxExporting = false;
            }
        }
        _WriteRankExportWorksheet(ws, opts) {
            const {
                sheetTitle,
                headers,
                numericCols1Based,
                colWidths,
                thin,
                headerFill,
                titleFont,
                headerFont,
                bodyFont,
                rows,
                rowValues,
            } = opts;
            const totalCols = headers.length;
            ws.views = [{ state: 'frozen', ySplit: 2, xSplit: 0, topLeftCell: 'A3' }];
            const tRow = ws.addRow([sheetTitle]);
            ws.mergeCells(1, 1, 1, totalCols);
            tRow.height = 30;
            tRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.font = titleFont;
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = thin;
                cell.numFmt = '@';
                cell.value = String(sheetTitle);
            });
            const hRow = ws.addRow(headers);
            hRow.height = 28;
            hRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.font = headerFont;
                cell.fill = headerFill;
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = thin;
                cell.numFmt = numericCols1Based.has(colNumber) ? '0' : '@';
                if (!numericCols1Based.has(colNumber) && cell.value != null) {
                    cell.value = String(cell.value);
                }
            });
            rows.forEach((item) => {
                const raw = rowValues(item);
                const r = ws.addRow(raw);
                r.height = 24;
                r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    cell.font = bodyFont;
                    cell.alignment = { vertical: 'top', wrapText: true };
                    cell.border = thin;
                    if (numericCols1Based.has(colNumber)) {
                        cell.numFmt = '0';
                        const v = cell.value;
                        if (v == null || v === '') {
                            cell.value = 0;
                        } else if (typeof v !== 'number') {
                            const n = parseInt(String(v), 10);
                            cell.value = Number.isFinite(n) ? n : 0;
                        }
                    } else {
                        cell.numFmt = '@';
                        if (cell.value == null || cell.value === '') {
                            cell.value = '';
                        } else {
                            cell.value = String(cell.value);
                        }
                    }
                });
            });
            for (let i = 0; i < colWidths.length; i++) {
                ws.getColumn(i + 1).width = colWidths[i] != null ? colWidths[i] : 10;
            }
        }
        GetAutoRefreshIntervalMs() {
            return 60000;
        }
        ToggleAutoRefresh() {
            this.autoRefresh = !this.autoRefresh;
            if (this.autoRefresh) {
                // 开启前先清除可能存在的旧定时器
                if (this.refreshInterval) {
                    clearInterval(this.refreshInterval);
                }
                const pollMs = typeof this.GetAutoRefreshIntervalMs === 'function' ? this.GetAutoRefreshIntervalMs() : 60000;
                const allow = typeof this.ShouldScheduleAutoRefreshInterval !== 'function' || this.ShouldScheduleAutoRefreshInterval();
                if (allow && pollMs > 0) {
                    this.refreshInterval = setInterval(() => {
                        // 自动刷新时不是初始加载
                        this.isInitialLoad = false;
                        this.LoadData();
                    }, pollMs);
                }
                this.ShowMessage('开启自动刷新');
            } else {
                // 关闭时清除定时器并重置引用
                if (this.refreshInterval) {
                    clearInterval(this.refreshInterval);
                    this.refreshInterval = null;
                }
                this.ShowMessage('关闭自动刷新');
            }
        }
        // 切换倒计时（仅在全屏模式下支持，使用全屏时间遮罩层；退出全屏时已重置 showTimeOverlay）
        ToggleCountdown() {
            if (!this.isFullscreen || !this.container) {
                return; // 非全屏模式不支持倒计时
            }
            this.showTimeOverlay = !this.showTimeOverlay;
            if (this.showTimeOverlay) {
                this.StartTimeOverlay();
            } else {
                this.StopTimeOverlay();
            }
        }
        HandleKeydown(e) {
            if (e.key === 'F5' && !e.ctrlKey) {
                e.preventDefault();
                this.RefreshData();
                return;
            }

            // 滚榜页由 RankRollSystem 自己接管 A/N/F/G/U/I 等快捷键；
            // 父类的 A 是普通榜单"自动刷新"，不能在滚榜页同时响应。
            if (this.currentMode === 'roll') {
                return;
            }

            const fsTimer = this.isFullscreen && this.showTimeOverlay;
            const timerTyping = fsTimer && this._rankTimerIsTypingTarget(e.target);

            if (fsTimer && !timerTyping && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
                e.preventDefault();
                this._rankTimerSelectDisplayPack(parseInt(e.key, 10) - 1);
                return;
            }

            if (fsTimer && !timerTyping && (e.key === 'h' || e.key === 'H')) {
                e.preventDefault();
                this._toggleRankTimerOverlayTitle();
                return;
            }
            if (fsTimer && !timerTyping && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                this._toggleRankTimerOverlayState();
                return;
            }
            if (fsTimer && !timerTyping && (e.key === '-' || e.key === 'Minus' || e.key === 'NumpadSubtract')) {
                e.preventDefault();
                this._rankTimerOverlayBumpRemainStep(-1);
                return;
            }
            if (
                fsTimer &&
                !timerTyping &&
                (e.key === '=' || e.key === '+' || e.key === 'NumpadAdd' || e.key === 'Equal')
            ) {
                e.preventDefault();
                this._rankTimerOverlayBumpRemainStep(1);
                return;
            }
            if (fsTimer && !timerTyping && e.key === '\\') {
                e.preventDefault();
                this._rankTimerOverlayResetRemainStepOnly();
                return;
            }

            // 非滚榜模式的快捷键
            if (e.key === 'a' || e.key === 'A') {
                this.ToggleAutoRefresh();
            } else if (e.key === 'b' || e.key === 'B') {
                if (this.isFullscreen) this.ToggleAutoScroll();
            } else if (e.key === 't' || e.key === 'T') {
                if (this.isFullscreen) {
                    e.preventDefault();
                    this.ToggleCountdown();
                }
            } else if (e.key === 'h' || e.key === 'H') {
                this.ToggleHelp();
            } else if (this.isFullscreen && !this.showTimeOverlay && (e.key === '1' || e.key === '2' || e.key === '3')) {
                const m = parseInt(e.key, 10);
                this.autoScrollMode = m;
                this.lastAutoScrollMode = m;
                this.StopAutoScroll();
                this.StartAutoScroll();
                const msg = { 1: '自动滚动：缓慢滚动', 2: '自动滚动：半页滚动', 3: '自动滚动：单行滚动' };
                this.ShowMessage(msg[m]);
            }
        }
        ToggleAutoScroll() {
            if (!this.isFullscreen) {
                this.autoScrollMode = 0;
                this.StopAutoScroll();
                return;
            }
            if (this.autoScrollMode === 0) {
                this.autoScrollMode = this.lastAutoScrollMode;
                this.StartAutoScroll();
                const msg = { 1: '自动滚动：缓慢滚动', 2: '自动滚动：半页滚动', 3: '自动滚动：单行滚动' };
                this.ShowMessage(msg[this.autoScrollMode] || '开启自动滚动');
            } else {
                this.lastAutoScrollMode = this.autoScrollMode;
                this.autoScrollMode = 0;
                this.StopAutoScroll();
                this.ShowMessage('关闭自动滚动');
            }
        }
        StartAutoScroll() {
            if (!this.isFullscreen || !this.container) {
                return;
            }
            if (this.autoScrollMode === 1) {
                this.StartAutoScrollSlow();
            } else if (this.autoScrollMode === 2) {
                this.StartAutoScrollHalfPage();
            } else if (this.autoScrollMode === 3) {
                this.StartAutoScrollSingleRow();
            }
        }
        StartAutoScrollSlow() {
            const scrollStep = 2;
            const scrollDelay = 50;
            this.autoScrollInterval = setInterval(() => {
                if (!this.isFullscreen || !this.container) {
                    this.StopAutoScroll();
                    return;
                }
                const el = this.container;
                el.scrollTop += scrollStep;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight) {
                    el.scrollTop = 0;
                }
            }, scrollDelay);
        }
        // 半页滚动：每隔几秒滚动半页后停住，时间与距离保证不跳过内容且观看舒适
        StartAutoScrollHalfPage() {
            const HALF_PAGE_INTERVAL_MS = 5200;   // 两次滚动之间的间隔（含动画时间）
            const HALF_PAGE_ANIMATION_MS = 400;   // 半页滚动动画时长
            const runStep = () => {
                if (!this.isFullscreen || !this.container) {
                    this.StopAutoScroll();
                    return;
                }
                const el = this.container;
                const maxScroll = el.scrollHeight - el.clientHeight;
                if (maxScroll <= 0) return;
                const startTop = el.scrollTop;
                let targetTop;
                if (startTop >= maxScroll - 2) {
                    targetTop = 0;
                } else {
                    const halfPage = Math.max(1, Math.floor(el.clientHeight * 0.5));
                    targetTop = Math.min(startTop + halfPage, maxScroll);
                }
                const startTime = performance.now();
                const animate = (now) => {
                    if (!this.isFullscreen || !this.container) {
                        this.autoScrollHalfPageAnimationId = null;
                        return;
                    }
                    const elapsed = now - startTime;
                    const t = Math.min(1, elapsed / HALF_PAGE_ANIMATION_MS);
                    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                    this.container.scrollTop = startTop + (targetTop - startTop) * ease;
                    if (t < 1) {
                        this.autoScrollHalfPageAnimationId = requestAnimationFrame(animate);
                    } else {
                        this.autoScrollHalfPageAnimationId = null;
                    }
                };
                this.autoScrollHalfPageAnimationId = requestAnimationFrame(animate);
            };
            runStep();
            this.autoScrollHalfPageInterval = setInterval(runStep, HALF_PAGE_INTERVAL_MS);
        }
        // 单行滚动：按行坐标滚动到下一行顶部（动画），整体速度与模式1一致（40px/s）
        StartAutoScrollSingleRow() {
            const PX_PER_SEC = 40; // 与模式1一致
            const SINGLE_ROW_ANIMATION_MS = 280; // 单行滚动动画时长
            const runStep = () => {
                if (!this.isFullscreen || !this.container) {
                    this.StopAutoScroll();
                    return;
                }
                const el = this.container;
                const maxScroll = el.scrollHeight - el.clientHeight;
                if (maxScroll <= 0) return;
                const scrollTop = el.scrollTop;
                const containerRect = el.getBoundingClientRect();
                const rows = el.querySelectorAll('#rank-grid .rank-row');
                if (!rows.length) return;
                // 动态读取每行在滚动内容中的顶部坐标
                const rowTops = [];
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i].getBoundingClientRect();
                    const topInContent = scrollTop + (r.top - containerRect.top);
                    rowTops.push(topInContent);
                }
                // 找到下一行：第一个 top > 当前 scrollTop + 小阈值
                const threshold = 2;
                let targetTop = null;
                for (let i = 0; i < rowTops.length; i++) {
                    if (rowTops[i] > scrollTop + threshold) {
                        targetTop = rowTops[i];
                        break;
                    }
                }
                if (targetTop === null) {
                    targetTop = 0; // 到底，回到顶部
                }
                targetTop = Math.min(targetTop, maxScroll);
                const startTop = scrollTop;
                const distance = Math.abs(targetTop - startTop);
                if (this.autoScrollSingleRowAnimationId != null) {
                    cancelAnimationFrame(this.autoScrollSingleRowAnimationId);
                    this.autoScrollSingleRowAnimationId = null;
                }
                const startTime = performance.now();
                const animate = (now) => {
                    if (!this.isFullscreen || !this.container) {
                        this.autoScrollSingleRowAnimationId = null;
                        return;
                    }
                    const elapsed = now - startTime;
                    const t = Math.min(1, elapsed / SINGLE_ROW_ANIMATION_MS);
                    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                    this.container.scrollTop = startTop + (targetTop - startTop) * ease;
                    if (t < 1) {
                        this.autoScrollSingleRowAnimationId = requestAnimationFrame(animate);
                    } else {
                        this.autoScrollSingleRowAnimationId = null;
                        // 按实际滚动距离控制下一轮时间，保持约 40px/s
                        const delayMs = Math.max(0, (distance / PX_PER_SEC) * 1000 - SINGLE_ROW_ANIMATION_MS);
                        if (delayMs > 0) {
                            this.autoScrollSingleRowTimeout = setTimeout(runStep, delayMs);
                        } else {
                            runStep();
                        }
                    }
                };
                this.autoScrollSingleRowAnimationId = requestAnimationFrame(animate);
            };
            runStep();
        }
        StopAutoScroll() {
            if (this.autoScrollInterval) {
                clearInterval(this.autoScrollInterval);
                this.autoScrollInterval = null;
            }
            if (this.autoScrollHalfPageInterval) {
                clearInterval(this.autoScrollHalfPageInterval);
                this.autoScrollHalfPageInterval = null;
            }
            if (this.autoScrollHalfPageAnimationId != null) {
                cancelAnimationFrame(this.autoScrollHalfPageAnimationId);
                this.autoScrollHalfPageAnimationId = null;
            }
            if (this.autoScrollSingleRowInterval) {
                clearInterval(this.autoScrollSingleRowInterval);
                this.autoScrollSingleRowInterval = null;
            }
            if (this.autoScrollSingleRowTimeout != null) {
                clearTimeout(this.autoScrollSingleRowTimeout);
                this.autoScrollSingleRowTimeout = null;
            }
            if (this.autoScrollSingleRowAnimationId != null) {
                cancelAnimationFrame(this.autoScrollSingleRowAnimationId);
                this.autoScrollSingleRowAnimationId = null;
            }
        }
        ShowModal(type) {
            if (type === 'help') {
                const modal = this.elements.helpModal;
                if (modal) {
                    modal.style.display = 'flex';
                }
            } else if (type === 'filter') {
                const modal = this.elements.filterModal;
                if (modal) {
                    modal.style.display = 'flex';
                }
            } else {
                const modal = this.elements[`${type}Modal`];
                if (modal) {
                    modal.style.display = 'flex';
                }
            }
        }
        HideModal(type) {
            if (type === 'help') {
                const modal = this.elements.helpModal;
                if (modal) {
                    modal.style.display = 'none';
                }
            } else if (type === 'filter') {
                const modal = this.elements.filterModal;
                if (modal) {
                    modal.style.display = 'none';
                }
            } else {
                const modal = this.elements[`${type}Modal`];
                if (modal) {
                    modal.style.display = 'none';
                }
            }
        }
        ShowFilterModal() {
            this.SyncFilterModalFromState();
            this.ShowModal('filter');
        }
        SyncFilterModalFromState() {
            if (this.elements.filterStarModeSelect) {
                this.elements.filterStarModeSelect.value = String(this.starMode ?? 0);
            }
            if (this.elements.filterSchoolSearch) {
                this.elements.filterSchoolSearch.value = '';
            }
            if (this.elements.filterTeamSearch) {
                this.elements.filterTeamSearch.value = '';
            }
            if (this.elements.filterGroupSelect) {
                this.EnsureGroupSelection();
                const selectedSet = new Set(this.selectedGroupIds || []);
                Array.from(this.elements.filterGroupSelect.options).forEach(op => {
                    op.selected = selectedSet.has(op.value);
                });
            }
            this.RenderFilterTags();
            this.UpdateSchoolCandidates();
            this.UpdateTeamCandidates();
        }
        ApplyFilterModal() {
            if (this.elements.filterStarModeSelect) {
                const nextStar = parseInt(this.elements.filterStarModeSelect.value, 10);
                if (Number.isInteger(nextStar)) {
                    this.starMode = nextStar;
                }
            }
            if (this.IsMultiGroupEnabled() && this.elements.filterGroupSelect) {
                let selected = Array.from(this.elements.filterGroupSelect.selectedOptions).map(op => op.value);
                if (selected.length === 0) {
                    selected = this.GetDefaultSelectedGroupIds();
                }
                this.selectedGroupIds = selected;
            } else {
                this.selectedGroupIds = this.GetDefaultSelectedGroupIds();
            }
            this.SaveViewPrefs();
            this.UpdateRank();
            this.HideModal('filter');
        }
        ShowLoading() {
            if(this.externalMode) {
                return; // 外部调用模式，不需要dom调整
            }
            if (this.isInitialLoad) {
                // 初始加载时显示白色蒙版
                if (this.externalMode || !this.elements.loading) return;
                this.elements.loading.style.display = 'flex';
            } else {
                // 刷新时只显示按钮动效
                this.ShowRefreshButtonLoading();
            }
        }
        HideLoading() {
            if(this.externalMode) {
                return; // 外部调用模式，不需要dom调整
            }
            if (this.isInitialLoad) {
                // 初始加载时隐藏白色蒙版
                if (this.externalMode || !this.elements.loading) return;
                this.elements.loading.style.display = 'none';
            } else {
                // 刷新时隐藏按钮动效
                this.HideRefreshButtonLoading();
            }
        }
        
        /** 与本实例 `#${containerId}` 配对的 `.rank-header` 内的刷新按钮（宽屏工具栏 + 折叠菜单各一份） */
        _queryRefreshButtons() {
            if (this.externalMode || !this.container) {
                return [];
            }
            const header = this.GetHeaderElement();
            if (!header) {
                return [];
            }
            return Array.from(header.querySelectorAll('#refresh-btn'));
        }

        // 显示刷新按钮加载状态
        ShowRefreshButtonLoading() {
            if (this.externalMode) {
                return; // 外部调用模式，不需要DOM调整
            }
            this._queryRefreshButtons().forEach((btn) => {
                if (!btn) {
                    return;
                }
                btn.classList.remove('rank-refresh-heartbeat');
                void btn.offsetWidth;
                btn.classList.add('rank-refresh-heartbeat', 'loading');
                window.setTimeout(() => btn.classList.remove('rank-refresh-heartbeat'), 700);
            });
        }
        
        // 隐藏刷新按钮加载状态
        HideRefreshButtonLoading() {
            if (this.externalMode) {
                return; // 外部调用模式，不需要DOM调整
            }
            this._queryRefreshButtons().forEach((btn) => {
                if (btn) {
                    btn.classList.remove('loading', 'rank-refresh-heartbeat');
                }
            });
        }
        
        // 刷新数据方法
        async RefreshData() {
            try {
                // 刷新时不是初始加载
                this.isInitialLoad = false;
                // 显示刷新按钮的加载状态
                this.ShowRefreshButtonLoading();
                this.ShowLoading();
                await this.LoadData();
            } catch (error) {
                console.error('刷新数据失败:', error);
                this.ShowError('刷新失败，请重试');
            } finally {
                this.HideLoading();
                this.HideRefreshButtonLoading();
            }
        }
        ShowError(message) {
            this.HideLoading();
            // 输出详细错误信息到控制台
            console.error('RankSystem Error:', message);
            // 使用浮动提示显示用户友好的消息
            this.ShowMessage('数据尚未准备好');
        }
        ShowMessage(message) {
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
            const inRankFullscreen = !!fsEl && this.container && (fsEl === this.container || fsEl.contains(this.container));
            const parent = inRankFullscreen ? this.container : document.body;
            RankToolShowToast(message, parent);
        }
        ShowKeyHint(msg, key) {
            // TODO
            return this.ShowMessage(`${msg} (${key})`);
        }
        // 显示帮助模态框
        ShowHelp() {
            this.ShowModal('help');
        }
        // H 键切换帮助：打开时再按 H 可关闭
        ToggleHelp() {
            const modal = this.elements.helpModal;
            if (modal && modal.style.display === 'flex') {
                this.HideModal('help');
            } else {
                this.ShowHelp();
            }
        }
        // 切换全屏时间遮罩层（与 ToggleCountdown 相同语义）
        ToggleTimeOverlay() {
            this.ToggleCountdown();
        }
        _rankTimerIsTypingTarget(el) {
            if (!el || !el.tagName) {
                return false;
            }
            const t = el.tagName;
            if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') {
                return true;
            }
            return !!el.isContentEditable;
        }
        _getRankTimerStorageId() {
            if (this.config.is_outrank_standalone) {
                const raw = String(this.config.key || this.config.cid_list || '').replace(/^outrank_/, '');
                return raw ? 'o_' + raw : 'o_unknown';
            }
            const c = this.data && this.data.contest;
            const idNum = parseInt(String(c && c.contest_id != null ? c.contest_id : this.config.cid_list || this.config.key || 0), 10);
            if (!isNaN(idNum) && idNum > 0) {
                return String(idNum);
            }
            return String(this.config.key || '0');
        }
        _getRankContestTimerOverlayRoot() {
            return (this.timeOverlay && this.timeOverlay.timerRoot) || document.getElementById('rank-timer-overlay-root');
        }
        /** 榜单全屏计时器：数字键选套装索引 0～3（与 contestlive_contest_timer DISPLAY_PACKS 一致） */
        _rankTimerSelectDisplayPack(index0) {
            const list = window.ContestliveContestTimerDisplayPackUiList;
            const maxIdx = Array.isArray(list) && list.length ? list.length - 1 : 3;
            const idx = Math.max(0, Math.min(maxIdx, parseInt(String(index0), 10) || 0));
            const sid = this._getRankTimerStorageId();
            try {
                window.localStorage.setItem('contestlive_timer_display_pack_' + sid, String(idx));
            } catch (eLs) {
                /* ignore */
            }
            if (window.ContestliveContestTimer && typeof window.ContestliveContestTimer.refresh === 'function') {
                window.ContestliveContestTimer.refresh();
            }
            const remainEl = this.container && this.container.querySelector('#time-overlay-text');
            const meta = Array.isArray(list) ? list[idx] : null;
            if (meta && typeof window.ContestliveContestTimerShowPackToast === 'function') {
                window.ContestliveContestTimerShowPackToast(meta.nameCn, meta.nameEn, remainEl);
            }
        }
        _fillRankTimerOverlayTitle() {
            const titleEl = this.container && this.container.querySelector('#time-overlay-title');
            const c = this.data && this.data.contest;
            if (!titleEl || !c) {
                return;
            }
            const cn = String(c.title || '').trim() || '—';
            let enRaw =
                c.title_en != null && String(c.title_en).trim()
                    ? String(c.title_en).trim()
                    : c.name_en != null && String(c.name_en).trim()
                      ? String(c.name_en).trim()
                      : '';
            const hasDistinctEn = enRaw !== '' && enRaw !== cn;
            if (!hasDistinctEn) {
                titleEl.textContent = cn;
                return;
            }
            titleEl.innerHTML =
                '<span class="cn-text">' +
                RankToolEscapeHtml(cn) +
                '</span><span class="en-text">' +
                RankToolEscapeHtml(enRaw) +
                '</span>';
        }
        _ensureRankTimerOverlayStorageDefaults() {
            const sid = this._getRankTimerStorageId();
            if (!sid) {
                return;
            }
            const keys = [
                'contestlive_timer_ui_title_' + sid,
                'contestlive_timer_ui_state_' + sid,
                'contestlive_timer_remain_step_' + sid,
            ];
            try {
                keys.forEach(k => {
                    if (typeof localStorage.getItem !== 'function' || localStorage.getItem(k) != null) {
                        return;
                    }
                    localStorage.setItem(k, '0');
                });
            } catch (eLs) {
                /* ignore */
            }
        }
        _applyRankTimerOverlayUiFromStorage() {
            const root = this._getRankContestTimerOverlayRoot();
            if (!root) {
                return;
            }
            const sid = this._getRankTimerStorageId();
            const kTitle = 'contestlive_timer_ui_title_' + sid;
            const kState = 'contestlive_timer_ui_state_' + sid;
            const kStep = 'contestlive_timer_remain_step_' + sid;
            let titleOn = false;
            let stateOn = false;
            let step = 0;
            try {
                titleOn = localStorage.getItem(kTitle) === '1';
                stateOn = localStorage.getItem(kState) === '1';
                const raw = localStorage.getItem(kStep);
                if (raw !== null && raw !== '') {
                    const n = parseInt(String(raw), 10);
                    if (n >= -3 && n <= 3) {
                        step = n;
                    }
                }
            } catch (eR) {
                /* ignore */
            }
            root.classList.toggle('contestlive-timer-ui-title', titleOn);
            root.classList.toggle('contestlive-timer-ui-state', stateOn);

            const STEP_TO_MUL = {
                '-3': '0.72',
                '-2': '0.82',
                '-1': '0.90',
                '1': '1.22',
                '2': '1.55',
                '3': '2.07',
            };
            if (step === 0) {
                root.classList.remove('contestlive-timer-page--size-custom');
                root.style.removeProperty('--csg-live-remain-mul');
            } else {
                const mul = STEP_TO_MUL[String(step)];
                if (mul) {
                    root.classList.add('contestlive-timer-page--size-custom');
                    root.style.setProperty('--csg-live-remain-mul', mul);
                }
            }
        }
        _rankTimerLsSet(k, v) {
            try {
                if (v === null || v === undefined || v === '') {
                    localStorage.removeItem(k);
                } else {
                    localStorage.setItem(k, String(v));
                }
            } catch (e) {
                /* ignore */
            }
        }
        _toggleRankTimerOverlayTitle() {
            const root = this._getRankContestTimerOverlayRoot();
            if (!root) return;
            root.classList.toggle('contestlive-timer-ui-title');
            const on = root.classList.contains('contestlive-timer-ui-title');
            this._rankTimerLsSet('contestlive_timer_ui_title_' + this._getRankTimerStorageId(), on ? '1' : '0');
            if (typeof window.ContestliveContestTimer.refresh === 'function') {
                window.ContestliveContestTimer.refresh();
            }
        }
        _toggleRankTimerOverlayState() {
            const root = this._getRankContestTimerOverlayRoot();
            if (!root) return;
            root.classList.toggle('contestlive-timer-ui-state');
            const on = root.classList.contains('contestlive-timer-ui-state');
            this._rankTimerLsSet('contestlive_timer_ui_state_' + this._getRankTimerStorageId(), on ? '1' : '0');
            if (typeof window.ContestliveContestTimer.refresh === 'function') {
                window.ContestliveContestTimer.refresh();
            }
        }
        _readRankTimerRemainStep() {
            const k = 'contestlive_timer_remain_step_' + this._getRankTimerStorageId();
            try {
                const raw = localStorage.getItem(k);
                if (raw === null || raw === '') return 0;
                const n = parseInt(String(raw), 10);
                if (n >= -3 && n <= 3) return n;
            } catch (e) {
                /* ignore */
            }
            return 0;
        }
        _rankTimerOverlayBumpRemainStep(delta) {
            const cur = this._readRankTimerRemainStep();
            const next = Math.min(3, Math.max(-3, cur + delta));
            if (next === cur) return;
            this._rankTimerLsSet('contestlive_timer_remain_step_' + this._getRankTimerStorageId(), String(next));
            this._applyRankTimerOverlayUiFromStorage();
            if (typeof window.ContestliveContestTimer.refresh === 'function') {
                window.ContestliveContestTimer.refresh();
            }
        }
        _rankTimerOverlayResetRemainStepOnly() {
            this._rankTimerLsSet('contestlive_timer_remain_step_' + this._getRankTimerStorageId(), '0');
            this._applyRankTimerOverlayUiFromStorage();
            if (typeof window.ContestliveContestTimer.refresh === 'function') {
                window.ContestliveContestTimer.refresh();
            }
        }
        _disposeRankContestTimerEngine() {
            if (this._rankTimerDispose && typeof this._rankTimerDispose.dispose === 'function') {
                try {
                    this._rankTimerDispose.dispose();
                } catch (eD) {
                    /* ignore */
                }
            }
            this._rankTimerDispose = null;
        }
        _mountRankContestTimerEngine() {
            if (!window.ContestliveContestTimer || typeof window.ContestliveContestTimer.init !== 'function') {
                return;
            }
            if (!this.data || !this.data.contest) {
                return;
            }
            const c = this.data.contest;
            const startMs = this._rankWireInstantMs(c.start_time);
            const endMs = this._rankWireInstantMs(c.end_time);
            const nowMs = this.GetActualCurrentTime().getTime();
            const cid = parseInt(String(c.contest_id || 0), 10) || 0;
            const storageId = this._getRankTimerStorageId();
            const remainEl = this.container.querySelector('#time-overlay-text');
            const stateEl = this.container.querySelector('#time-overlay-label');
            const self = this;
            this._disposeRankContestTimerEngine();
            const ret = window.ContestliveContestTimer.init({
                cid: this.config.is_outrank_standalone ? 0 : cid,
                storage_id: storageId,
                start_ms: startMs,
                end_ms: endMs,
                now_ms: nowMs,
                get_now_ms: () => self.GetActualCurrentTime().getTime(),
                remain_el: remainEl,
                state_el: stateEl,
                wall_el: null,
                keyboard_t_cycle_pack: false,
            });
            if (ret && typeof ret.dispose === 'function') {
                this._rankTimerDispose = ret;
            }
        }
        _syncRankContestTimerOverlayAfterContestDataRefresh() {
            if (
                !this.externalMode &&
                this.isFullscreen &&
                this.showTimeOverlay &&
                this.timeOverlay &&
                this.data &&
                this.data.contest
            ) {
                this.timeOverlay.show();
                this.showTimeOverlay = true;
                this._mountRankContestTimerEngine();
                this._fillRankTimerOverlayTitle();
                this._ensureRankTimerOverlayStorageDefaults();
                this._applyRankTimerOverlayUiFromStorage();
            }
        }
        StartTimeOverlay() {
            if (!this.timeOverlay || !this.data || !this.data.contest) {
                return;
            }
            this._mountRankContestTimerEngine();
            this._fillRankTimerOverlayTitle();
            this._ensureRankTimerOverlayStorageDefaults();
            this._applyRankTimerOverlayUiFromStorage();
            this.timeOverlay.show();
            this.showTimeOverlay = true;
        }
        StopTimeOverlay() {
            this._disposeRankContestTimerEngine();
            if (this.timeOverlay) {
                this.timeOverlay.hide();
            }
            this.showTimeOverlay = false;
        }
        IsFrozen(solution) {
            // 是否显示为封榜状态
            if (!this.data) return false;
            if(solution.result < 0) {
                return true;    // 后端没给结果，属于封榜状态
            }
            return false;
            // *** 由后端数据控制，有数据就显示，以下注释掉 ***
            // // 判断提交是否在封榜期间
            // const inDate = solution.in_date;
            // const submitTime = new Date(inDate).getTime();
            // const endTime = new Date(this.data.contest.end_time).getTime();
            // const frozenMinutes = this.data.contest.frozen_minute || 0;
            // const frozenAfter = this.data.contest.frozen_after || 0;
            // const frozenStartTime = endTime - frozenMinutes * 60 * 1000;
            // const frozenEndTime = endTime + frozenAfter * 60 * 1000;
            // // 不在封榜时间内的提交
            // if (submitTime <= frozenStartTime) {
            //     return false;
            // }
            // // 在封榜期间，且当前时间仍在封榜或揭晓期间内
            // const now = this.GetActualCurrentTime().getTime();
            // return frozenStartTime <= now && now <= frozenEndTime;
        }
        // HTML转义（已迁移到 rank_tool.js）
        EscapeHtml(text) {
            return RankToolEscapeHtml(text);
        }
        // 旗帜映射缓存
        // 加载旗帜映射数据
        async LoadFlagMapping() {
            if (this._flagMapping) return this._flagMapping;
            if (this._flagMappingPromise) return this._flagMappingPromise;
            this._flagMappingPromise = this._LoadFlagMappingInternal();
            this._flagMapping = await this._flagMappingPromise;
            return this._flagMapping;
        }
        async _LoadFlagMappingInternal() {
            const flagBaseUrl = this.config.region_flag_url || '/static/image/region_flag';
            const mappingUrl = `${flagBaseUrl}/region_mapping.json`;
            try {
                const response = await fetch(mappingUrl);
                if (!response.ok) throw new Error('Failed to load mapping');
                const data = await response.json();
                // 构建映射表：中英文名称和缩写都映射到文件名
                const mapping = new Map();
                data.forEach(region => {
                    // 中文名映射
                    if (region['中文名']) mapping.set(region['中文名'], region['文件名']);
                    if (region['中文简称']) mapping.set(region['中文简称'], region['文件名']);
                    // 英文名映射
                    if (region['英文名']) mapping.set(region['英文名'], region['文件名']);
                    if (region['英文简称']) mapping.set(region['英文简称'], region['文件名']);
                    // 英文缩写映射
                    if (region['英文缩写']) mapping.set(region['英文缩写'], region['文件名']);
                });
                return mapping;
            } catch (error) {
                console.warn('Failed to load flag mapping:', error);
                return new Map(); // 返回空映射
            }
        }
        // 计算旗帜加载地址
        async CalculateFlagUrl(region) {
            if (!region || typeof region !== 'string') return null;
            const trimmedRegion = region.trim();
            if (!trimmedRegion) return null;
            const flagBaseUrl = this.config.region_flag_url || '/static/image/region_flag';
            const mapping = await this.LoadFlagMapping();
            // 先尝试从映射表查找
            if (mapping.has(trimmedRegion)) {
                const fileName = mapping.get(trimmedRegion);
                return `${flagBaseUrl}/${fileName}`;
            }
            // 映射表没找到，直接尝试 region.png
            return `${flagBaseUrl}/${encodeURIComponent(trimmedRegion)}.png`;
        }
        // #########################################
        //  通用图片懒加载模块
        // #########################################
        // 通用图片懒加载方案
        // 缓存策略：
        // - 成功图片：缓存1小时
        // - 失败图片：缓存10分钟，标记失败状态，避免重复请求
        CreateImageLazyLoader(config) {
            const {
                type,           // 'logo' 或 'flag'
                getFn,          // 缓存获取函数
                setFn,          // 缓存设置函数
                baseUrl,        // 基础URL
                fetchFn,        // 获取图片数据的函数
                calculateFn,    // 计算图片URL的函数（可选）
                onSuccess,      // 成功回调
                onError,        // 错误回调
                rootMargin = '50px'
            } = config;
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(async (entry) => {
                    if (!entry.isIntersecting) return;
                    const element = entry.target;
                    observer.unobserve(element);
                    // 获取图片标识符
                    const identifier = this.GetImageIdentifier(element, type);
                    if (!identifier) {
                        this.HandleImageError(element, type);
                        return;
                    }
                    // 校徽：IDB + fetch 与 `rank_tool.RankToolSchoolLogoResolveDataUrlWithIdb` 单一路径（避免与队伍卡片等重复造轮子）
                    if (
                        type === 'logo' &&
                        !calculateFn &&
                        typeof window.RankToolSchoolLogoResolveDataUrlWithIdb === 'function'
                    ) {
                        try {
                            const resolved = await window.RankToolSchoolLogoResolveDataUrlWithIdb(
                                { get: (k) => getFn(k), set: (k, v, e) => setFn(k, v, e) },
                                baseUrl,
                                identifier,
                                fetchFn
                            );
                            this.ApplyImageToElement(element, resolved.dataUrl, type, onSuccess, {
                                fileKey: resolved.fileKey,
                            });
                        } catch (error) {
                            this.HandleImageError(element, type, onError);
                        }
                        return;
                    }
                    // 计算图片URL（旗帜等）
                    let imageUrl;
                    if (calculateFn) {
                        imageUrl = await calculateFn(identifier);
                        if (!imageUrl) {
                            this.HandleImageError(element, type);
                            return;
                        }
                    } else {
                        imageUrl = `${baseUrl}/${encodeURIComponent(identifier)}`;
                    }
                    // 尝试从缓存加载
                    const cacheKey = `${type}_${baseUrl}_${encodeURIComponent(identifier)}`;
                    const cached = await this.LoadFromCache(cacheKey, getFn);
                    if (cached) {
                        // 检查是否是失败状态
                        if (cached.flg_success === false) {
                            // 缓存中标记为失败，直接处理错误
                            this.HandleImageError(element, type, onError);
                            return;
                        }
                        // 成功状态，应用图片
                        this.ApplyCachedImage(element, cached, type, onSuccess);
                        return;
                    }
                    // 从网络加载
                    try {
                        const dataUrl = await fetchFn(imageUrl);
                        const payload = {
                            dataUrl,
                            fileKey: type === 'logo' ? imageUrl : undefined,
                            ts: Date.now(),
                            flg_success: true
                        };
                        // 成功图片缓存1小时
                        setFn(cacheKey, payload, 60 * 60 * 1000);
                        this.ApplyImageToElement(element, dataUrl, type, onSuccess, { fileKey: payload.fileKey });
                    } catch (error) {
                        // 加载失败，缓存失败状态10分钟
                        const failurePayload = { 
                            dataUrl: null, 
                            ts: Date.now(), 
                            flg_success: false,
                            error: error.message || 'Load failed'
                        };
                        setFn(cacheKey, failurePayload, 10 * 60 * 1000);
                        this.HandleImageError(element, type, onError);
                    }
                });
            }, { rootMargin });
            return observer;
        }
        // 获取图片标识符
        GetImageIdentifier(element, type) {
            switch (type) {
                case 'logo':
                    return element.getAttribute('data-school') || '';
                case 'flag':
                    return element.getAttribute('data-flag') || '';
                default:
                    return '';
            }
        }
        // 从缓存加载图片
        async LoadFromCache(cacheKey, getFn) {
            try {
                const cached = await getFn(cacheKey);
                if (!cached) return null;
                // IndexedDBCache已自动处理JSON解析，直接返回
                return cached;
            } catch (e) {
                // 缓存读取失败
                console.warn('Cache read failed:', cacheKey, e.message);
            }
            return null;
        }
        // 应用缓存的图片
        ApplyCachedImage(element, cached, type, onSuccess) {
            if (cached.dataUrl) {
                let fileKey = cached.fileKey;
                if (!fileKey && type === 'logo' && this._logoBase) {
                    const id = this.GetImageIdentifier(element, 'logo');
                    if (id) {
                        fileKey = `${this._logoBase}/${encodeURIComponent(id)}`;
                    }
                }
                this.ApplyImageToElement(element, cached.dataUrl, type, onSuccess, { fileKey });
            } else {
                // 失败缓存，不应用图片（保持默认状态）
                // 这里不需要做任何操作，因为失败时应该保持元素的默认状态
            }
        }
        // 应用图片到元素
        ApplyImageToElement(element, dataUrl, type, onSuccess, meta) {
            if (type === 'logo' && typeof RankToolLoadSchoolBadgeProcessedPack === 'function') {
                const fileKey = meta && meta.fileKey;
                (async () => {
                    try {
                        const pack = await RankToolLoadSchoolBadgeProcessedPack(fileKey || dataUrl, dataUrl);
                        this.SetBackgroundImage(element, pack.displayUrl);
                        /* 榜单行校徽展示区域由 rank.css 固定（128px auto / 滚榜 contain），不写 --rank-badge-bg-size，避免改变可视区域 */
                        if (typeof RankToolDisconnectSchoolBadgeResizeObserver === 'function') {
                            RankToolDisconnectSchoolBadgeResizeObserver(element, '--rank-badge-bg-size');
                        }
                    } catch (e) {
                        if (typeof RankToolDisconnectSchoolBadgeResizeObserver === 'function') {
                            RankToolDisconnectSchoolBadgeResizeObserver(element, '--rank-badge-bg-size');
                        }
                        this.SetBackgroundImage(element, dataUrl);
                    }
                    if (onSuccess) {
                        onSuccess(element, dataUrl);
                    }
                })();
                return;
            }
            switch (type) {
                case 'logo':
                    this.SetBackgroundImage(element, dataUrl);
                    break;
                case 'flag':
                    element.src = dataUrl;
                    break;
            }
            if (onSuccess) {
                onSuccess(element, dataUrl);
            }
        }
        // 处理图片加载错误
        HandleImageError(element, type, onError) {
            switch (type) {
                case 'logo':
                    // logo 加载失败时保持透明
                    break;
                case 'flag':
                    element.style.display = 'none';
                    break;
            }
            if (onError) {
                onError(element);
            }
        }
        // 重新观察旗帜图标（在数据渲染完成后调用）
        ReobserveFlags() {
            if (!this._flagObserver) {
                this.InitFlagLoader();
            }
            // 观察新添加的旗帜图标
            this.container.querySelectorAll('img.flag-icon').forEach(img => {
                if (!img.dataset.observed) {
                    this._flagObserver.observe(img);
                    img.dataset.observed = 'true';
                }
            });
        }
        // 重新观察校徽图标（在数据渲染完成后调用）
        ReobserveLogos() {
            if (!this._logoObserver) {
                this.InitSchoolLogoLoader();
            }
            // 观察新添加的校徽图标
            this.container.querySelectorAll('.school-logo').forEach(element => {
                if (!element.dataset.observed) {
                    this._logoObserver.observe(element);
                    element.dataset.observed = 'true';
                }
            });
        }
        // 获取旗帜数据URL
        async FetchFlagDataUrl(url) {
            // 检查离线图片数据（优先使用，避免CORS问题）
            if (window.OFFLINE_IMAGES?.region_flag) {
                // 从URL中提取文件名
                const fileName = url.substring(url.lastIndexOf('/') + 1);
                const base64Data = window.OFFLINE_IMAGES.region_flag[fileName];
                if (base64Data) {
                    return base64Data; // 直接返回base64 data URL
                }
            }
            
            // 离线模式没有找到，尝试在线加载
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load flag');
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
        // 加载校徽背景（动态添加元素时调用）
        LoadSchoolLogoBackground(element, school) {
            this.LoadImageElement(element, school, 'data-school', '_logoObserver', 'InitSchoolLogoLoader');
        }
        // 设置背景图片
        SetBackgroundImage(element, dataUrl) {
            element.style.setProperty('--rank-school-logo-bg', `url(${JSON.stringify(dataUrl)})`);
            element.classList.add('has-background');
        }
        
        // 复制到剪贴板 - 优化版本
        async CopyToClipboard(text) {
            if (!text || text.trim() === '') {
                return false;
            }
            
            // 方法1: 现代 Clipboard API (需要 HTTPS 或 localhost)
            if (navigator.clipboard && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(text);
                    return true;
                } catch (error) {
                    // 如果 Clipboard API 失败，继续尝试传统方法
                }
            }
            
            // 方法2: 传统 document.execCommand 方法
            try {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                
                // 设置样式使其不可见但可选择
                Object.assign(textArea.style, {
                    position: 'fixed',
                    top: '0',
                    left: '0',
                    width: '2em',
                    height: '2em',
                    padding: '0',
                    border: 'none',
                    outline: 'none',
                    boxShadow: 'none',
                    background: 'transparent',
                    opacity: '0',
                    zIndex: '-1'
                });
                
                // 添加到 DOM
                document.body.appendChild(textArea);
                
                // 选择文本
                textArea.focus();
                textArea.select();
                textArea.setSelectionRange(0, 99999); // 移动端兼容
                
                // 执行复制
                const successful = document.execCommand('copy');
                
                // 清理
                document.body.removeChild(textArea);
                
                return successful;
            } catch (error) {
                console.error('Copy to clipboard failed:', error);
                return false;
            }
        }
        
        // 显示复制成功气泡
        ShowCopySuccessBubble(event) {
            // 创建气泡元素
            const bubble = document.createElement('div');
            bubble.className = 'copy-success-bubble';
            bubble.innerHTML = '<i class="bi bi-check-circle-fill"></i>';
            
            // 设置样式
            Object.assign(bubble.style, {
                position: 'fixed',
                left: `${event.clientX}px`,
                top: `${event.clientY - 30}px`,
                zIndex: '10000',
                background: '#28a745',
                color: 'white',
                borderRadius: '50%',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                pointerEvents: 'none',
                transform: 'scale(0)',
                transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                boxShadow: '0 2px 8px rgba(40, 167, 69, 0.3)'
            });
            
            // 添加到页面
            document.body.appendChild(bubble);
            
            // 触发动画
            requestAnimationFrame(() => {
                bubble.style.transform = 'scale(1)';
            });
            
            // 自动移除
            setTimeout(() => {
                bubble.style.transform = 'scale(0)';
                bubble.style.opacity = '0';
                setTimeout(() => {
                    if (bubble.parentNode) {
                        bubble.parentNode.removeChild(bubble);
                    }
                }, 300);
            }, 1500);
        }
    }
    window.RankSystem = RankSystem;
    if (typeof window !== 'undefined') {
        window.__CSGOJ_RANK_JS_READY = true;
    }
}
// #########################################
//  全局调用接口
// #########################################
// 使用示例：
// 1. 使用全局配置：RankSystemInit('my-container')
// 2. 使用自定义配置：RankSystemInit('my-container', { cid_list: '123,456' })
// 3. 混合配置：RankSystemInit('my-container', { api_url: '/custom/api' })
function RankSystemInit(containerId, config = {}) {
    // 如果没有传入配置，尝试从全局获取
    if (!config || Object.keys(config).length === 0) {
        config = window.RANK_CONFIG || {};
    }
    return new RankSystem(containerId, config);
};

function RankjsFormatSecondsToHMS(seconds) {
    if (seconds == null || isNaN(seconds)) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}
function RankjsFormatSecondsToMinutes(seconds) {
    if (seconds == null || isNaN(seconds)) return '0';
    return Math.floor(seconds / 60).toString();
}

/**
 * 榜单 xlsx 题块（参考 board.ac replay 文档主流格式，并扩展保留 WA/pending 的最后提交时间）：
 *   - 没提交：           ''           （空白单元格）
 *   - AC：               N/H:MM:SS
 *   - WA + 时间：        -N/H:MM:SS
 *   - WA 无时间：        -N
 *   - pending + 时间：   ?N/H:MM:SS
 *   - pending 无时间：   ?N
 * 时间均为相对比赛开始的「时:分:秒」。
 */
function RankjsRankExportProblemCell(stats) {
    const sc = stats.submitCount || 0;
    const st = stats.status || 'none';
    if (st === 'none' || sc <= 0) return '';
    const hms = (typeof stats.lastSubmitTime === 'string'
        && /^\d{1,4}:\d{1,2}:\d{2}$/.test(stats.lastSubmitTime))
        ? stats.lastSubmitTime
        : '';
    if (st === 'ac') {
        return hms ? `${sc}/${hms}` : String(sc);
    }
    if (st === 'pending') {
        return hms ? `?${sc}/${hms}` : `?${sc}`;
    }
    return hms ? `-${sc}/${hms}` : `-${sc}`;
}

// #########################################
//  OutrankRankSystem 外榜专用子类
// #########################################
if(typeof OutrankRankSystem == 'undefined') {
    class OutrankRankSystem extends RankSystem {
        constructor(containerId, config = {}) {
            // 设置默认配置
            const defaultConfig = {
                cache_duration: 60 * 1000, // 60秒缓存
                request_t_param: true, // 启用 t 参数
            };
            const mergedConfig = RankToolMergeConfig(defaultConfig, config);
            super(containerId, mergedConfig);
        }
        
        /**
         * 外榜静态 rank.json：与 OutrankPageSystem / OutrankRollSystem 共用 RankToolLoadStaticRankData（缓存、t 参数、404 占位）。
         */
        async LoadData() {
            try {
                this.ShowLoading();
                this.data = await RankToolLoadStaticRankData(this);
                this.OriInit(this.data);
            } catch (error) {
                console.error('数据加载错误:', error);
                this.ShowError('网络错误，请检查连接');
            }
        }
    }
    window.OutrankRankSystem = OutrankRankSystem;
}

// 外榜初始化函数
function OutrankRankSystemInit(containerId, config = {}) {
    // 如果没有传入配置，尝试从全局获取
    if (!config || Object.keys(config).length === 0) {
        config = window.RANK_CONFIG || {};
    }
    return new OutrankRankSystem(containerId, config);
}