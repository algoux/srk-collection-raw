/**
 * RankPageSystem — 标准榜单页面增强层
 *
 * 继承 RankSystem，为需要 Bootstrap5 / 项目组件 UI 的页面提供：
 *   - 筛选功能（学校 + 队伍，并集关系）
 *   - 三种显示模式（仅筛选 / 全部高亮 / 筛选置顶）
 *   - 工具栏按钮重排（team-rank + school-rank 相邻，filter 紧随）
 *   - 学校排名模式下只显示学校筛选
 *
 * 使用：
 *   RankPageSystemInit('rank-container', window.RANK_CONFIG);
 *
 * 外榜继承：
 *   OutrankPageSystem extends RankPageSystem（仅覆写 LoadData）
 *
 * 依赖：rank_tool.js、rank.js、csg_switch.js/.css、global 已引入的 idb.js（window.idb.get/set）
 *
 * 站内比赛榜（.contest-rank-page-shell）：皮肤下拉双栏 + 榜单列表松紧档位，与 `contestRankDensityLevel` 一并写入 GetViewPrefsKey() 的 IndexedDB。
 */

function RankPageSystemBootFail(containerId) {
    console.error(
        '[RankPageSystem] rank.js 未完整加载（多为网络中断或浏览器缓存了残缺响应）。请强制刷新（Ctrl+Shift+R）；仍失败请在 Network 中检查 /static/csgoj/contest/rank.js 是否完整下载。'
    );
    const root = containerId && document.getElementById(containerId);
    if (root) {
        root.innerHTML =
            '<div class="alert alert-danger mb-0" role="alert">' +
            '榜单脚本加载失败，请强制刷新页面（Ctrl+Shift+R）后重试。' +
            '<span class="en-text d-block mt-1">Rank script failed to load. Hard-refresh (Ctrl+Shift+R) and retry.</span>' +
            '</div>';
    }
    return null;
}

if (typeof RankSystem === 'undefined' || window.__CSGOJ_RANK_JS_READY !== true) {
    function RankPageSystemInit(containerId) {
        return RankPageSystemBootFail(containerId);
    }
    function OutrankPageSystemInit(containerId) {
        return RankPageSystemBootFail(containerId);
    }
} else {

class RankPageSystem extends RankSystem {
    static get FILTER_MODAL_ID() {
        return 'rank-page-filter-modal';
    }

    // ─── Init ──────────────────────────────────────────────────────
    Init() {
        this.filterSchools = this.filterSchools || new Set();
        this.filterTeams   = this.filterTeams   || new Set();
        this.filterDisplayMode = this.filterDisplayMode || 'filtered';
        this._rankFilterSaveTimer = null;
        this._rankFilterIdbRestoreScheduled = false;
        this._filterPopoverHideTimer = null;
        super.Init();
    }

    /** 数据就绪后从 IndexedDB 恢复筛选（按比赛 cid / key） */
    OriInit(raw_data) {
        super.OriInit(raw_data);
        if (this.externalMode || this._rankFilterIdbRestoreScheduled) return;
        this._rankFilterIdbRestoreScheduled = true;
        this._restoreRankFilterFromIdb()
            .then((applied) => {
                if (applied) {
                    this._syncFilterBtnState();
                    this._syncFilterSwitchVisibility();
                    this.UpdateRank();
                }
            })
            .catch((err) => console.warn('[RankPageSystem] filter idb restore', err));
    }

    // ─── Header：重排按钮 + 注入筛选控件 ──────────────────────────
    CreateHeader() {
        super.CreateHeader();
        this._rearrangeToolbarButtons();
        this._injectFilterControls();
        this._maybeInstallContestRankDensityUi();
    }

    /**
     * 站内比赛榜页：皮肤下拉改为双栏（左主题、右榜单列表松紧），外榜无 contest-rank-page-shell 时不执行。
     */
    _maybeInstallContestRankDensityUi() {
        const shell = this.container && this.container.closest('.contest-rank-page-shell');
        if (!shell || this.currentMode === 'roll' || this.externalMode) return;
        const dd = document.getElementById('rank-skin-dropdown');
        if (!dd || dd.dataset.csgRankSkinTwoCol === '1') return;
        const opts = Array.from(dd.querySelectorAll(':scope > .custom-select-option'));
        if (!opts.length) return;
        dd.dataset.csgRankSkinTwoCol = '1';
        dd.classList.add('rank-skin-dropdown--two-col');
        while (dd.firstChild) {
            dd.removeChild(dd.firstChild);
        }
        const wrap = document.createElement('div');
        wrap.className = 'rank-skin-panel-two-col';
        const left = document.createElement('div');
        left.className = 'rank-skin-panel-col rank-skin-panel-col-themes';
        opts.forEach((o) => left.appendChild(o));
        const right = document.createElement('div');
        right.className = 'rank-skin-panel-col rank-skin-panel-col-density';
        right.innerHTML = `
            <div class="rank-skin-density-label">
                <span class="rank-skin-density-label-cn">榜单列表</span><en-text>Ranking list</en-text>
            </div>
            <div class="rank-skin-density-controls rank-skin-density-controls--cross" role="group" aria-label="榜单列表疏密调节 · Ranking list density">
                <button type="button" class="rank-skin-density-shortcut-btn rank-skin-density-shortcut-btn--axis" id="rank-skin-density-to-max"
                    ${RankToolGenerateBilingualAttributes('一步调到最疏（最大字号与行距）', 'Jump to sparsest: largest text & row spacing')}>
                    ${this.CreateBilingualText('最疏', 'Sparsest')}
                </button>
                <div class="rank-skin-density-cross-mid">
                    <button type="button" class="rank-skin-density-btn" id="rank-skin-density-minus"
                        ${RankToolGenerateBilingualAttributes('更紧一档（字号与行距略小）', 'Tighter: slightly smaller text & row spacing')}>&minus;</button>
                    <span id="rank-skin-density-level" class="rank-skin-density-level" aria-live="polite">2</span>
                    <button type="button" class="rank-skin-density-btn" id="rank-skin-density-plus"
                        ${RankToolGenerateBilingualAttributes('更松一档（字号与行距略大）', 'Looser: slightly larger text & row spacing')}>+</button>
                </div>
                <button type="button" class="rank-skin-density-shortcut-btn rank-skin-density-shortcut-btn--axis" id="rank-skin-density-to-min"
                    ${RankToolGenerateBilingualAttributes('一步调到最密（最小字号与行距）', 'Jump to densest: smallest text & row spacing')}>
                    ${this.CreateBilingualText('最密', 'Densest')}
                </button>
            </div>`;
        wrap.appendChild(left);
        wrap.appendChild(right);
        dd.appendChild(wrap);
        const minus = document.getElementById('rank-skin-density-minus');
        const plus = document.getElementById('rank-skin-density-plus');
        const toMin = document.getElementById('rank-skin-density-to-min');
        const toMax = document.getElementById('rank-skin-density-to-max');
        if (minus) {
            minus.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._adjustContestRankDensityLevel(-1);
            });
        }
        if (plus) {
            plus.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._adjustContestRankDensityLevel(1);
            });
        }
        if (toMin) {
            toMin.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._setContestRankDensityAbsolute(0);
            });
        }
        if (toMax) {
            toMax.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._setContestRankDensityAbsolute(3);
            });
        }
        this.ApplyContestRankDensityLevel();
    }

    _applyContestRankDensityLevelIfChanged(n) {
        const parsed = parseInt(n, 10);
        if (Number.isNaN(parsed)) return;
        const v = Math.max(0, Math.min(3, parsed));
        const cur = parseInt(this.contestRankDensityLevel, 10);
        const base = Number.isNaN(cur) ? 2 : cur;
        if (v === base) return;
        this.ShowRankSkinBusyOverlay('density');
        this.contestRankDensityLevel = v;
        this.ScheduleContestRankDensityApplyAndHideBusy();
        this.SaveViewPrefs();
    }

    _adjustContestRankDensityLevel(delta) {
        const cur = parseInt(this.contestRankDensityLevel, 10);
        const base = Number.isNaN(cur) ? 2 : cur;
        const n = Math.max(0, Math.min(3, base + delta));
        this._applyContestRankDensityLevelIfChanged(n);
    }

    /** 一键跳到指定档位（0 最密 … 3 最疏），避免逐级等待多次重算 */
    _setContestRankDensityAbsolute(target) {
        this._applyContestRankDensityLevelIfChanged(target);
    }

    /**
     * 将 school-rank-btn 移到 team-rank-btn 所在分组，
     * 使「队伍排名 / 学校排名」两个模式切换按钮相邻
     */
    _rearrangeToolbarButtons() {
        const header = this.GetHeaderElement();
        if (!header) return;

        const rearrange = (scope) => {
            if (!scope) return;
            const teamBtn   = scope.querySelector('#team-rank-btn');
            const schoolBtn = scope.querySelector('#school-rank-btn');
            if (!teamBtn || !schoolBtn) return;
            teamBtn.insertAdjacentElement('afterend', schoolBtn);
        };

        rearrange(header.querySelector('#header-controls'));
        rearrange(header.querySelector('#controls-dropdown'));
    }

    _injectFilterControls() {
        const header = this.GetHeaderElement();
        if (!header) return;

        const removeDefaultFilterButtons = (container) => {
            if (!container) return;
            const defaultBtn = container.querySelector('#filter-btn, #filter-btn-dd');
            if (!defaultBtn) return;
            const item = defaultBtn.closest('.toolbar-item');
            if (item) item.remove();
            else defaultBtn.remove();
        };

        const filterGroupHtml = (idSuffix, withLabel) => {
            const isPrimary = idSuffix === '';
            const btnCls = `${withLabel ? 'control-btn with-text' : 'control-btn'} filter-btn${isPrimary ? ' filter-info-btn' : ''}`;
            const labelSpan = withLabel
                ? `<span class="button-text">${this.CreateBilingualText('筛选', 'Filter')}</span>`
                : '';
            const quickInfoSpan = isPrimary
                ? '<span id="filter-quick-info" class="filter-quick-info">G0 · T0 · S0</span>'
                : '';
            return `
                <div class="toolbar-item filter-control-item">
                    <button class="${btnCls}" id="rank-filter-btn${idSuffix}"
                        ${RankToolGenerateBilingualAttributes('筛选', 'Filter')}>
                        ${RankToolGenerateIconOnly('filter')}${labelSpan}${quickInfoSpan}
                    </button>
                    <div class="filter-popover" id="filter-popover${idSuffix}"></div>
                </div>`;
        };

        const injectInto = (container, idSuffix, withLabel) => {
            if (!container) return;
            removeDefaultFilterButtons(container);
            const group = document.createElement('div');
            group.className = 'toolbar-group toolbar-group-filter';
            group.innerHTML = filterGroupHtml(idSuffix, withLabel);
            // 插入到 school-rank-btn 所在 group 之后
            const schoolBtn = container.querySelector('#school-rank-btn');
            const targetGroup = schoolBtn ? schoolBtn.closest('.toolbar-group') : null;
            if (targetGroup) {
                targetGroup.insertAdjacentElement('afterend', group);
            } else {
                container.appendChild(group);
            }
        };

        injectInto(header.querySelector('#header-controls'), '', true);
        injectInto(header.querySelector('#controls-dropdown'), '-dd', true);
    }

    // ─── Modal ─────────────────────────────────────────────────────
    CreateModals() {
        super.CreateModals();
        // 子类使用独立筛选 modal，移除基类默认筛选 modal，避免重复 id / 事件冲突
        const baseModal = this.container.querySelector('#rank-filter-modal');
        if (baseModal) baseModal.remove();
        this._createFilterModal();
    }

    _createFilterModal() {
        const isSchoolMode = this.currentMode === 'school';
        const modal = document.createElement('div');
        modal.id = RankPageSystem.FILTER_MODAL_ID;
        modal.className = 'modal-overlay rank-filter-modal-overlay';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content rank-filter-modal-content">
                <div class="modal-header">
                    <h3>${this.CreateBilingualText('筛选', 'Filter')}</h3>
                    <button id="close-filter-modal" class="close-btn">&times;</button>
                </div>
                <div class="modal-body rank-filter-modal-body">
                    <div class="rank-filter-top-controls">
                        <div class="filter-card filter-card-star-mode">
                            <div class="filter-card-title">${this.CreateBilingualText('打星视图', 'Star Mode')}</div>
                            <div class="rank-radio-group" id="star-mode-group" role="group" aria-label="打星视图 / Star Mode">
                                <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-star-mode="0" title="打星不排名 / Star No Rank" aria-label="打星不排名 / Star No Rank"><i class="bi bi-slash-circle" aria-hidden="true"></i></button>
                                <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-star-mode="1" title="不含打星 / Exclude Star" aria-label="不含打星 / Exclude Star"><i class="bi bi-eye-slash" aria-hidden="true"></i></button>
                                <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-star-mode="2" title="打星参与排名 / Star Participate" aria-label="打星参与排名 / Star Participate"><i class="bi bi-stars" aria-hidden="true"></i></button>
                            </div>
                        </div>
                        <div class="filter-card filter-card-display-mode">
                            <div class="filter-card-title">${this.CreateBilingualText('筛选显示', 'Filter View')}</div>
                            <div class="rank-radio-group" id="filter-display-mode-group" role="group" aria-label="筛选显示 / Filter View">
                                <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-filter-mode="filtered" title="仅显示符合筛选的队伍 / Show only teams matching filters" aria-label="仅显示符合筛选的队伍 / Show only teams matching filters"><i class="bi bi-funnel-fill" aria-hidden="true"></i></button>
                                <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-filter-mode="highlight" title="显示全部队伍，高亮符合筛选的 / Show all teams, highlight matches" aria-label="显示全部队伍，高亮符合筛选的 / Show all teams, highlight matches"><i class="bi bi-eye" aria-hidden="true"></i></button>
                                <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-filter-mode="pinned" title="将符合筛选的队伍置顶显示 / Pin matching teams to the top" aria-label="将符合筛选的队伍置顶显示 / Pin matching teams to the top"><i class="bi bi-pin-angle-fill" aria-hidden="true"></i></button>
                            </div>
                        </div>
                    </div>
                    <div class="filter-columns${isSchoolMode ? ' filter-columns-single' : ''}">
                        <div class="filter-column" id="filter-col-school">
                            <div class="filter-column-title-row">
                                <div class="filter-column-title-main">
                                    <span class="filter-column-title-text">学校筛选 / School Filter</span>
                                    <span class="filter-title-count" id="filter-school-count">0</span>
                                </div>
                                <div class="filter-title-actions">
                                    <button type="button" class="filter-title-clear" id="filter-school-clear" title="清空学校筛选 / Clear school filter">&times;</button>
                                </div>
                            </div>
                            <div class="filter-search-wrapper">
                                <input type="text" class="filter-search-input" id="filter-school-search"
                                    placeholder="搜索学校… / Search school…" autocomplete="off">
                                <div class="filter-candidates filter-candidates-dropdown" id="filter-school-candidates"></div>
                            </div>
                            <div class="filter-tags" id="filter-school-tags"></div>
                        </div>
                        <div class="filter-column-divider" id="filter-col-divider"${isSchoolMode ? ' style="display:none"' : ''}></div>
                        <div class="filter-column" id="filter-col-team"${isSchoolMode ? ' style="display:none"' : ''}>
                            <div class="filter-column-title-row">
                                <div class="filter-column-title-main">
                                    <span class="filter-column-title-text">队名筛选 / Team Name Filter</span>
                                    <span class="filter-title-count" id="filter-team-count">0</span>
                                </div>
                                <div class="filter-title-actions">
                                    <button type="button" class="filter-title-clear" id="filter-team-clear" title="清空队伍筛选 / Clear team filter">&times;</button>
                                </div>
                            </div>
                            <div class="filter-search-wrapper">
                                <input type="text" class="filter-search-input" id="filter-team-search"
                                    placeholder="ID、队名、译名、学校、教练、队员… / ID, names, school, coach, roster…" autocomplete="off">
                                <div class="filter-candidates filter-candidates-dropdown" id="filter-team-candidates"></div>
                            </div>
                            <div class="filter-tags" id="filter-team-tags"></div>
                        </div>
                    </div>
                    <div class="rank-filter-group-controls ${this.IsMultiGroupEnabled() ? '' : 'd-none'}" id="filter-group-card">
                        <div class="filter-column-title-row">
                            <div class="filter-column-title-main">
                                <span class="filter-column-title-text">赛事归属筛选 / Affiliation Filter</span>
                            </div>
                            <div class="filter-title-actions">
                                <button type="button" class="btn btn-outline-secondary btn-sm" id="filter-group-select-all">全选<span class="en-text">All</span></button>
                                <button type="button" class="btn btn-outline-secondary btn-sm" id="filter-group-clear">清空<span class="en-text">None</span></button>
                            </div>
                        </div>
                        <div id="filter-group-multiselect"></div>
                        <select id="filter-group-select" class="form-select form-select-sm d-none" multiple size="6"></select>
                    </div>
                </div>
                <div class="modal-footer rank-filter-modal-footer">
                    <div class="rank-filter-modal-footer-left"></div>
                    <div class="rank-filter-modal-footer-actions"></div>
                </div>
            </div>`;
        this.container.appendChild(modal);
    }

    // ─── Elements ──────────────────────────────────────────────────
    InitElements() {
        super.InitElements();
        const h = this.GetHeaderElement();
        const q = (sel) => h ? h.querySelector(sel) : null;
        const c = (sel) => this.container.querySelector(sel);

        Object.assign(this.elements, {
            filterBtn:          q('#rank-filter-btn'),
            filterBtnDd:        q('#rank-filter-btn-dd'),
            filterPopover:      q('#filter-popover'),
            filterPopoverDd:    q('#filter-popover-dd'),
            filterModal:        c(`#${RankPageSystem.FILTER_MODAL_ID}`),
            filterColSchool:    c('#filter-col-school'),
            filterColTeam:      c('#filter-col-team'),
            filterColDivider:   c('#filter-col-divider'),
            schoolSearch:       c('#filter-school-search'),
            teamSearch:         c('#filter-team-search'),
            schoolCandidates:   c('#filter-school-candidates'),
            teamCandidates:     c('#filter-team-candidates'),
            schoolTags:         c('#filter-school-tags'),
            teamTags:           c('#filter-team-tags'),
            schoolCount:        c('#filter-school-count'),
            teamCount:          c('#filter-team-count'),
            schoolClear:        c('#filter-school-clear'),
            teamClear:          c('#filter-team-clear'),
            filterGroupCard:    c('#filter-group-card'),
            filterGroupSelect:  c('#filter-group-select'),
            filterGroupMulti:   c('#filter-group-multiselect'),
            filterGroupSelectAll: c('#filter-group-select-all'),
            filterGroupClear:   c('#filter-group-clear'),
        });
    }

    // ─── Events ────────────────────────────────────────────────────
    BindHeaderEvents() {
        super.BindHeaderEvents();
        this._bindFilterEvents();
    }

    _bindFilterEvents() {
        const el = this.elements;

        // 打开 modal
        [el.filterBtn, el.filterBtnDd].forEach(btn => {
            if (btn) this.AddButtonEventListeners(btn, () => this.OpenFilterModal());
        });

        // Hover popover（仅宽屏按钮）
        if (el.filterBtn) {
            const item = el.filterBtn.closest('.filter-control-item');
            el.filterBtn.addEventListener('mouseenter', () => this._showFilterPopover(''));
            if (item) item.addEventListener('mouseleave', () => this._hideFilterPopover(''));
            if (el.filterPopover) {
                el.filterPopover.addEventListener('mouseenter', () => this._showFilterPopover(''));
                el.filterPopover.addEventListener('mouseleave', () => this._hideFilterPopover(''));
            }
        }

        // 关闭 modal
        const closeBtn = this.container.querySelector('#close-filter-modal');
        if (closeBtn) closeBtn.addEventListener('click', () => this.CloseFilterModal());
        if (el.filterModal) {
            el.filterModal.addEventListener('click', (e) => {
                if (e.target === el.filterModal) this.CloseFilterModal();
                const starBtn = e.target.closest('.rank-radio-btn[data-star-mode]');
                if (starBtn) this._setStarMode(parseInt(starBtn.dataset.starMode, 10));
                const modeBtn = e.target.closest('.rank-radio-btn[data-filter-mode]');
                if (modeBtn) this._setFilterDisplayMode(String(modeBtn.dataset.filterMode || 'filtered'));
            });
        }

        // 列内清空（即时生效）
        if (el.schoolClear) {
            el.schoolClear.addEventListener('click', () => {
                this.filterSchools.clear();
                this._renderFilterTags();
                this.ApplyFilter();
            });
        }
        if (el.teamClear) {
            el.teamClear.addEventListener('click', () => {
                this.filterTeams.clear();
                this._renderFilterTags();
                this.ApplyFilter();
            });
        }
        if (el.filterGroupSelectAll) {
            el.filterGroupSelectAll.addEventListener('click', () => {
                if (this._groupMultiSelect) {
                    this._groupMultiSelect.selectAll();
                } else {
                    const select = el.filterGroupSelect;
                    if (!select) return;
                    Array.from(select.options).forEach(op => { op.selected = true; });
                    this._applyGroupSelectionNow();
                }
            });
        }
        if (el.filterGroupClear) {
            el.filterGroupClear.addEventListener('click', () => {
                if (this._groupMultiSelect) {
                    const select = el.filterGroupSelect;
                    const first = select && select.options[0] ? select.options[0].value : '';
                    if (first) this._groupMultiSelect.setSelectedValues([first]);
                    else this._groupMultiSelect.clear();
                } else {
                    const select = el.filterGroupSelect;
                    if (!select) return;
                    const first = select.options[0] ? select.options[0].value : '';
                    Array.from(select.options).forEach(op => { op.selected = (op.value === first); });
                    this._applyGroupSelectionNow();
                }
            });
        }
        if (el.filterGroupMulti && window.csgMultiSelect) {
            this._groupMultiSelect = window.csgMultiSelect.create(el.filterGroupMulti, {
                placeholder: '选择赛事归属 / Select affiliations',
                searchPlaceholder: '搜索分组 / Search groups',
                selectedSuffix: 'selected',
                maxChips: 3,
                onChange: (values) => {
                    this._syncNativeGroupSelectByValues(values);
                    this._applyGroupSelectionNow();
                }
            });
        }
        if (el.filterGroupSelect && !this._groupMultiSelect) {
            el.filterGroupSelect.addEventListener('change', () => this._applyGroupSelectionNow());
        }

        // 搜索输入 — focus 显示浮动候选，blur 延迟隐藏
        this._setupSearchDropdown(el.schoolSearch, el.schoolCandidates, () => this._updateSchoolCandidates());
        this._setupSearchDropdown(el.teamSearch,   el.teamCandidates,   () => this._updateTeamCandidates());

    }

    _setupSearchDropdown(input, dropdown, updateFn) {
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

    // ─── Filter 核心逻辑 ──────────────────────────────────────────
    HasActiveFilter() {
        return (this.filterSchools && this.filterSchools.size > 0) ||
               (this.filterTeams && this.filterTeams.size > 0);
    }

    IsFilterMatch(item) {
        if (!this.HasActiveFilter()) return false;
        const school = item.team?.school || item.school || '';
        const teamId = String(item.team_id || item.item_key || '');
        return this.filterSchools.has(school) || this.filterTeams.has(teamId);
    }

    _isFilterMatchByKey(itemKey) {
        if (!this.HasActiveFilter()) return false;
        const team = this.teamMap[itemKey];
        if (!team) return false;
        return this.filterSchools.has(team.school || '') || this.filterTeams.has(String(itemKey));
    }

    /**
     * 与学校筛选共用 RankToolSchoolFilterColors：有校名用校名哈希；无校名用稳定 team:id，避免与真实学校名撞车
     */
    _rankFilterColorKeyForTeamId(teamId) {
        const tid = String(teamId || '');
        const t = this.teamMap[tid];
        const s = t && String(t.school || '').trim();
        if (s) return s;
        return `team:${tid}`;
    }

    /** 传入 RankToolSchoolFilterColors 的字符串（学校名或 team: 键） */
    _resolveFilterHighlightColorKey(item) {
        if (!item) return '';
        const school = String(item.team?.school || item.school || '').trim();
        const teamId = String(item.team_id || item.item_key || '');
        if (school && this.filterSchools.has(school)) return school;
        if (this.filterTeams.has(teamId)) return this._rankFilterColorKeyForTeamId(teamId);
        return school || '';
    }

    /** 行高亮取色键（与 modal / popover 队伍 tag 同色源一致） */
    _resolveFilterHighlightSchool(item) {
        return this._resolveFilterHighlightColorKey(item);
    }

    _resolveFilterHighlightSchoolByKey(itemKey) {
        const team = this.teamMap[itemKey];
        const school = team && String(team.school || '').trim();
        if (school && this.filterSchools.has(school)) return school;
        if (this.filterTeams.has(String(itemKey))) return this._rankFilterColorKeyForTeamId(itemKey);
        return school || '';
    }

    _syncFilterMatchRowStyles(row, match, schoolNameForColor) {
        if (!row) return;
        if (!match) {
            row.classList.remove('rank-filter-match');
            row.style.removeProperty('--rank-filter-bg');
            row.style.removeProperty('--rank-filter-bg-hover');
            row.style.removeProperty('--rank-filter-accent');
            row.style.removeProperty('--rank-filter-outline');
            return;
        }
        const c = RankToolSchoolFilterColors(schoolNameForColor || '');
        row.classList.add('rank-filter-match');
        row.style.setProperty('--rank-filter-bg', c.rowBg);
        row.style.setProperty('--rank-filter-bg-hover', c.rowBgHover);
        row.style.setProperty('--rank-filter-accent', c.accent);
        row.style.setProperty('--rank-filter-outline', c.outline);
    }

    _isContestant(team) {
        if (!team) return false;
        if (Number(team.tkind) === 2) return false;
        const priv = (team.privilege == null ? '' : String(team.privilege)).trim().toLowerCase();
        return priv === '' || priv === 'default';
    }

    _getAllSchools() {
        const schools = new Set();
        for (const id in this.teamMap) {
            const t = this.teamMap[id];
            if (!this._isContestant(t)) continue;
            if (t.school) schools.add(t.school);
        }
        return Array.from(schools).sort();
    }

    _getAllTeamInfos() {
        const teams = [];
        for (const id in this.teamMap) {
            const t = this.teamMap[id];
            if (!this._isContestant(t)) continue;
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

    /** 次行展示：译名、教练、队员、学校；无 label，用「·」分隔；空项省略 */
    _teamFilterMetaPlain(obj) {
        if (!obj) return '';
        const parts = [];
        for (const k of ['name_en', 'coach', 'tmember', 'school']) {
            const v = String(obj[k] || '').trim();
            if (v) parts.push(v);
        }
        return parts.join(' · ');
    }

    _teamFilterItemMatchesQuery(item, q) {
        if (!q) return true;
        const keys = ['team_id', 'name', 'name_en', 'coach', 'tmember', 'school'];
        return keys.some(k => String(item[k] || '').toLowerCase().includes(q));
    }

    // ─── Filter Modal 操作 ─────────────────────────────────────────
    OpenFilterModal() {
        if (!this.elements.filterModal) return;
        this._ensureAdvancedFilterModalStructure();
        this._syncFilterModalColumns();
        this._syncFilterModalMetaControls();
        this.elements.filterModal.style.display = 'flex';
        this._renderFilterTags();
    }

    CloseFilterModal() {
        if (this.elements.filterModal) this.elements.filterModal.style.display = 'none';
    }

    /** 学校排名模式下隐藏队伍列，队伍排名模式显示双列 */
    _syncFilterModalColumns() {
        const isSchoolMode = this.currentMode === 'school';
        const el = this.elements;
        if (el.filterColTeam)    el.filterColTeam.style.display    = isSchoolMode ? 'none' : '';
        if (el.filterColDivider) el.filterColDivider.style.display = isSchoolMode ? 'none' : '';
        const cols = this.container.querySelector('.filter-columns');
        if (cols) cols.classList.toggle('filter-columns-single', isSchoolMode);
    }

    _ensureAdvancedFilterModalStructure() {
        const modalBody = this.elements.filterModal
            ? this.elements.filterModal.querySelector('.rank-filter-modal-body')
            : null;
        if (!modalBody) return;

        // 兜底：若历史缓存/旧模板导致顶部控制区缺失，运行时补齐
        if (!modalBody.querySelector('#star-mode-group') || !modalBody.querySelector('#filter-display-mode-group')) {
            const top = document.createElement('div');
            top.className = 'rank-filter-top-controls';
            top.innerHTML = `
                <div class="filter-card filter-card-star-mode">
                    <div class="filter-card-title">${this.CreateBilingualText('打星视图', 'Star Mode')}</div>
                    <div class="rank-radio-group" id="star-mode-group" role="group" aria-label="打星视图 / Star Mode">
                        <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-star-mode="0" title="打星不排名 / Star No Rank" aria-label="打星不排名 / Star No Rank"><i class="bi bi-slash-circle" aria-hidden="true"></i></button>
                        <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-star-mode="1" title="不含打星 / Exclude Star" aria-label="不含打星 / Exclude Star"><i class="bi bi-eye-slash" aria-hidden="true"></i></button>
                        <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-star-mode="2" title="打星参与排名 / Star Participate" aria-label="打星参与排名 / Star Participate"><i class="bi bi-stars" aria-hidden="true"></i></button>
                    </div>
                </div>
                <div class="filter-card filter-card-display-mode">
                    <div class="filter-card-title">${this.CreateBilingualText('筛选显示', 'Filter View')}</div>
                    <div class="rank-radio-group" id="filter-display-mode-group" role="group" aria-label="筛选显示 / Filter View">
                        <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-filter-mode="filtered" title="仅显示符合筛选的队伍 / Show only teams matching filters" aria-label="仅显示符合筛选的队伍 / Show only teams matching filters"><i class="bi bi-funnel-fill" aria-hidden="true"></i></button>
                        <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-filter-mode="highlight" title="显示全部队伍，高亮符合筛选的 / Show all teams, highlight matches" aria-label="显示全部队伍，高亮符合筛选的 / Show all teams, highlight matches"><i class="bi bi-eye" aria-hidden="true"></i></button>
                        <button type="button" class="rank-radio-btn rank-radio-btn-icon" data-filter-mode="pinned" title="将符合筛选的队伍置顶显示 / Pin matching teams to the top" aria-label="将符合筛选的队伍置顶显示 / Pin matching teams to the top"><i class="bi bi-pin-angle-fill" aria-hidden="true"></i></button>
                    </div>
                </div>`;
            modalBody.insertAdjacentElement('afterbegin', top);
            this._syncStarModeButtonState();
            this._syncFilterModeButtonState();
        }

        // 兜底：若 group 区块缺失，运行时补齐
        if (!modalBody.querySelector('#filter-group-card')) {
            const groupWrap = document.createElement('div');
            groupWrap.id = 'filter-group-card';
            groupWrap.className = `rank-filter-group-controls ${this.IsMultiGroupEnabled() ? '' : 'd-none'}`;
            groupWrap.innerHTML = `
                <div class="filter-column-title-row">
                    <div class="filter-column-title-main">
                        <span class="filter-column-title-text">赛事归属筛选 / Affiliation Filter</span>
                    </div>
                    <div class="filter-title-actions">
                        <button type="button" class="btn btn-outline-secondary btn-sm" id="filter-group-select-all">全选<span class="en-text">All</span></button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" id="filter-group-clear">清空<span class="en-text">None</span></button>
                    </div>
                </div>
                <div id="filter-group-multiselect"></div>
                <select id="filter-group-select" class="form-select form-select-sm d-none" multiple size="6"></select>
            `;
            modalBody.appendChild(groupWrap);
            this.elements.filterGroupCard = groupWrap;
            this.elements.filterGroupMulti = groupWrap.querySelector('#filter-group-multiselect');
            this.elements.filterGroupSelect = groupWrap.querySelector('#filter-group-select');
            this.elements.filterGroupSelectAll = groupWrap.querySelector('#filter-group-select-all');
            this.elements.filterGroupClear = groupWrap.querySelector('#filter-group-clear');

            if (this.elements.filterGroupSelectAll) {
                this.elements.filterGroupSelectAll.addEventListener('click', () => {
                    if (this._groupMultiSelect) this._groupMultiSelect.selectAll();
                    else this._applyGroupSelectionNow();
                });
            }
            if (this.elements.filterGroupClear) {
                this.elements.filterGroupClear.addEventListener('click', () => {
                    const select = this.elements.filterGroupSelect;
                    const first = select && select.options[0] ? select.options[0].value : '';
                    if (this._groupMultiSelect) {
                        if (first) this._groupMultiSelect.setSelectedValues([first]);
                        else this._groupMultiSelect.clear();
                    } else {
                        this._applyGroupSelectionNow();
                    }
                });
            }
            if (this.elements.filterGroupMulti && window.csgMultiSelect && !this._groupMultiSelect) {
                this._groupMultiSelect = window.csgMultiSelect.create(this.elements.filterGroupMulti, {
                    placeholder: '选择赛事归属 / Select affiliations',
                    searchPlaceholder: '搜索分组 / Search groups',
                    selectedSuffix: 'selected',
                    maxChips: 3,
                    onChange: (values) => {
                        this._syncNativeGroupSelectByValues(values);
                        this._applyGroupSelectionNow();
                    }
                });
            }
        }
    }

    _syncFilterModalMetaControls() {
        const el = this.elements;
        this._syncStarModeButtonState();
        this._syncFilterModeButtonState();
        if (el.filterGroupCard) {
            el.filterGroupCard.classList.toggle('d-none', !this.IsMultiGroupEnabled());
        }
        this.BuildGroupFilterOptions();
        this.EnsureGroupSelection();
        this._syncGroupMultiSelectFromNative();
    }

    _applyGroupSelectionNow() {
        const select = this.elements.filterGroupSelect;
        if (!select) return;
        let selected = Array.from(select.selectedOptions).map(op => op.value);
        if (selected.length === 0) {
            selected = this.GetDefaultSelectedGroupIds();
            Array.from(select.options).forEach(op => { op.selected = selected.includes(op.value); });
        }
        this.selectedGroupIds = selected;
        this.UpdateRank();
        this.SaveViewPrefs();
        this._scheduleSaveRankFilterToIdb();
    }

    _syncNativeGroupSelectByValues(values) {
        const select = this.elements.filterGroupSelect;
        if (!select) return;
        const selected = new Set((values || []).map(v => String(v)));
        Array.from(select.options).forEach(op => {
            op.selected = selected.has(op.value);
        });
    }

    _syncGroupMultiSelectFromNative() {
        if (!this._groupMultiSelect) return;
        const select = this.elements.filterGroupSelect;
        if (!select) return;
        const options = Array.from(select.options).map(op => ({ value: op.value, label: op.textContent || op.value }));
        const selected = Array.from(select.selectedOptions).map(op => op.value);
        this._groupMultiSelect.setOptions(options);
        this._groupMultiSelect.setSelectedValues(selected, true);
    }

    ApplyFilter() {
        this._syncFilterBtnState();
        this._syncFilterSwitchVisibility();
        this.UpdateRank();
        this._scheduleSaveRankFilterToIdb();
    }

    /** IndexedDB：db/store 固定，key 含当前比赛 cid（或外榜 key） */
    static get RANK_FILTER_IDB_DB() {
        return 'csgoj_rank_page';
    }

    static get RANK_FILTER_IDB_STORE() {
        return 'rank_filter';
    }

    _rankFilterIdbStorageKey() {
        const cfg = this.config || {};
        const raw = (cfg.cid_list != null && String(cfg.cid_list).trim() !== '')
            ? String(cfg.cid_list).trim()
            : (cfg.key != null && String(cfg.key).trim() !== '' ? String(cfg.key).trim() : '');
        if (!raw) return '';
        return `cid:${raw}`;
    }

    _readConfirmToFilteredPreference() {
        return false;
    }

    _scheduleSaveRankFilterToIdb() {
        if (this.externalMode) return;
        if (!window.idb || typeof window.idb.set !== 'function') return;
        if (this._rankFilterSaveTimer) clearTimeout(this._rankFilterSaveTimer);
        this._rankFilterSaveTimer = setTimeout(() => {
            this._rankFilterSaveTimer = null;
            this._saveRankFilterToIdb();
        }, 200);
    }

    async _saveRankFilterToIdb() {
        if (this.externalMode) return;
        if (!window.idb || typeof window.idb.set !== 'function') return;
        const idbKey = this._rankFilterIdbStorageKey();
        if (!idbKey) return;
        const payload = {
            v: 1,
            schools: Array.from(this.filterSchools || []),
            teams: Array.from(this.filterTeams || []),
            displayMode: ['filtered', 'highlight', 'pinned'].includes(this.filterDisplayMode)
                ? this.filterDisplayMode : 'filtered',
            groupIds: Array.isArray(this.selectedGroupIds) ? this.selectedGroupIds.slice() : [],
            starMode: Number.isInteger(this.starMode) ? this.starMode : 0,
        };
        try {
            await window.idb.set(
                RankPageSystem.RANK_FILTER_IDB_DB,
                RankPageSystem.RANK_FILTER_IDB_STORE,
                idbKey,
                payload
            );
        } catch (e) {
            console.warn('[RankPageSystem] filter idb save', e);
        }
    }

    async _restoreRankFilterFromIdb() {
        if (this.externalMode) return false;
        if (!window.idb || typeof window.idb.get !== 'function') return false;
        const idbKey = this._rankFilterIdbStorageKey();
        if (!idbKey) return false;
        let data;
        try {
            data = await window.idb.get(
                RankPageSystem.RANK_FILTER_IDB_DB,
                RankPageSystem.RANK_FILTER_IDB_STORE,
                idbKey
            );
        } catch (e) {
            console.warn('[RankPageSystem] filter idb get', e);
            return false;
        }
        if (!data || typeof data !== 'object') return false;

        let changed = false;
        if (Array.isArray(data.schools)) {
            this.filterSchools = new Set(data.schools);
            changed = true;
        }
        if (Array.isArray(data.teams)) {
            this.filterTeams = new Set(data.teams);
            changed = true;
        }
        if (data.displayMode === 'filtered' || data.displayMode === 'highlight' || data.displayMode === 'pinned') {
            this.filterDisplayMode = data.displayMode;
            changed = true;
        }
        if (Array.isArray(data.groupIds)) {
            this.selectedGroupIds = data.groupIds.slice();
            changed = true;
        }
        if (Number.isInteger(data.starMode)) {
            this.starMode = data.starMode;
            changed = true;
        }

        this._syncStarModeButtonState();
        this._syncFilterModeButtonState();
        this.EnsureGroupSelection();
        this._syncGroupMultiSelectFromNative();

        return changed;
    }

    ClearFilter() {
        this.filterSchools.clear();
        this.filterTeams.clear();
        this.ApplyFilter();
    }

    // ─── Filter UI 同步 ──────────────────────────────────────────
    _syncFilterBtnState() {
        const active = this.HasActiveFilter();
        const count = (this.filterSchools?.size || 0) + (this.filterTeams?.size || 0);
        [this.elements.filterBtn, this.elements.filterBtnDd].forEach(btn => {
            if (!btn) return;
            btn.classList.toggle('filter-active', active);
            const textEl = btn.querySelector('.button-text');
            if (textEl) textEl.style.display = active ? 'none' : '';
            let badge = btn.querySelector('.filter-badge');
            if (active) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'filter-badge';
                    btn.style.position = 'relative';
                    btn.appendChild(badge);
                }
                badge.textContent = count;
            } else if (badge) {
                badge.remove();
            }
        });
    }

    _syncFilterSwitchVisibility() {
        // 三态切换已移入筛选 modal
    }

    // ─── Popover ───────────────────────────────────────────────────
    _showFilterPopover(suffix) {
        if (this._filterPopoverHideTimer) {
            clearTimeout(this._filterPopoverHideTimer);
            this._filterPopoverHideTimer = null;
        }
        const popover = this.elements[suffix === '-dd' ? 'filterPopoverDd' : 'filterPopover'];
        if (!popover || !this.HasActiveFilter()) return;
        popover.innerHTML = this._popoverContent();
        this._bindPopoverInteractive(popover);
        popover.classList.add('show');
    }

    _hideFilterPopover(suffix) {
        const popover = this.elements[suffix === '-dd' ? 'filterPopoverDd' : 'filterPopover'];
        if (!popover) return;
        if (this._filterPopoverHideTimer) clearTimeout(this._filterPopoverHideTimer);
        this._filterPopoverHideTimer = setTimeout(() => {
            popover.classList.remove('show');
            this._filterPopoverHideTimer = null;
        }, 220);
    }

    _popoverContent() {
        let html = `<div class="filter-popover-section">
            <div class="filter-popover-label">${this.CreateBilingualText('显示模式', 'Display Mode')}</div>
            <div class="filter-popover-mode-row">
                <button type="button" class="filter-popover-mode-btn ${this.filterDisplayMode === 'filtered' ? 'active' : ''}" data-mode="filtered">仅筛选 <span class="mode-sep">/</span> Filtered</button>
                <button type="button" class="filter-popover-mode-btn ${this.filterDisplayMode === 'highlight' ? 'active' : ''}" data-mode="highlight">显示全部 <span class="mode-sep">/</span> All</button>
                <button type="button" class="filter-popover-mode-btn ${this.filterDisplayMode === 'pinned' ? 'active' : ''}" data-mode="pinned">筛选置顶 <span class="mode-sep">/</span> Pinned</button>
            </div>
        </div>`;
        if (this.filterSchools.size > 0) {
            html += `<div class="filter-popover-section">
                <div class="filter-popover-label-row">
                    <div class="filter-popover-label">${this.CreateBilingualText('学校', 'School')}</div>
                    <button type="button" class="filter-popover-section-clear" data-clear-type="school" title="清空学校筛选 / Clear school filter">&times;</button>
                </div>
                <div class="filter-popover-tags">${
                    Array.from(this.filterSchools).map(s => {
                        const c = RankToolSchoolFilterColors(s);
                        return `<span class="filter-popover-tag filter-popover-tag-school" style="background:${c.tagBg};border:1px solid ${c.border};color:${c.text};">${RankToolEscapeHtml(s)}<button class="filter-popover-remove" data-type="school" data-value="${RankToolEscapeHtml(s)}">&times;</button></span>`;
                    }).join('')
                }</div></div>`;
        }
        if (this.filterTeams.size > 0) {
            html += `<div class="filter-popover-section">
                <div class="filter-popover-label-row">
                    <div class="filter-popover-label">${this.CreateBilingualText('队伍', 'Team')}</div>
                    <button type="button" class="filter-popover-section-clear" data-clear-type="team" title="清空队伍筛选 / Clear team filter">&times;</button>
                </div>
                <div class="filter-popover-tags">${
                    Array.from(this.filterTeams).map(tid => {
                        const t = this.teamMap[tid];
                        const ck = this._rankFilterColorKeyForTeamId(tid);
                        const c = RankToolSchoolFilterColors(ck);
                        const idEsc = RankToolEscapeHtml(tid);
                        const nameEsc = RankToolEscapeHtml(t ? (t.name || '') : '');
                        const primary = nameEsc ? `${idEsc} · ${nameEsc}` : idEsc;
                        const meta = this._teamFilterMetaPlain(t || {});
                        const metaHtml = meta
                            ? `<span class="filter-popover-tag-meta">${RankToolEscapeHtml(meta)}</span>`
                            : '';
                        return `<span class="filter-popover-tag filter-popover-tag-team" style="background:${c.tagBg};border:1px solid ${c.border};color:${c.text};"><span class="filter-popover-tag-primary">${primary}</span>${metaHtml}<button class="filter-popover-remove" data-type="team" data-value="${idEsc}">&times;</button></span>`;
                    }).join('')
                }</div></div>`;
        }
        return html;
    }

    _bindPopoverInteractive(popover) {
        if (!popover) return;
        popover.querySelectorAll('.filter-popover-remove').forEach(btn => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const v = btn.dataset.value || '';
                if (btn.dataset.type === 'school') this.filterSchools.delete(v);
                else this.filterTeams.delete(v);
                this.ApplyFilter();
                this._showFilterPopover('');
            });
        });
        popover.querySelectorAll('.filter-popover-mode-btn').forEach(btn => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this._setFilterDisplayMode(String(btn.dataset.mode || 'filtered'));
                this._showFilterPopover('');
            });
        });
        popover.querySelectorAll('.filter-popover-section-clear').forEach(btn => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tp = String(btn.dataset.clearType || '');
                if (tp === 'school') this.filterSchools.clear();
                if (tp === 'team') this.filterTeams.clear();
                this.ApplyFilter();
                this._showFilterPopover('');
            });
        });
    }

    _setFilterDisplayMode(mode) {
        this.filterDisplayMode = ['filtered', 'highlight', 'pinned'].includes(mode) ? mode : 'filtered';
        this._syncFilterModeButtonState();
        this.ApplyFilter();
    }

    _setStarMode(mode) {
        this.starMode = Number.isInteger(mode) ? mode : 0;
        this._syncStarModeButtonState();
        this.UpdateRank();
        this.SaveViewPrefs();
        this._scheduleSaveRankFilterToIdb();
    }

    _syncStarModeButtonState() {
        const val = String(Number.isInteger(this.starMode) ? this.starMode : 0);
        this.container.querySelectorAll('.rank-radio-btn[data-star-mode]').forEach(btn => {
            btn.classList.toggle('active', String(btn.dataset.starMode) === val);
        });
    }

    _syncFilterModeButtonState() {
        const mode = this.filterDisplayMode || 'filtered';
        this.container.querySelectorAll('.rank-radio-btn[data-filter-mode]').forEach(btn => {
            btn.classList.toggle('active', String(btn.dataset.filterMode) === mode);
        });
    }

    // ─── Modal 内 Tag 渲染 ─────────────────────────────────────────
    _renderFilterTags() {
        this._renderTagGroup(this.elements.schoolTags, this.filterSchools, 'school', (v) => v);
        this._renderTagGroup(this.elements.teamTags, this.filterTeams, 'team', null);
        this._syncFilterTagCounters();
    }

    _syncFilterTagCounters() {
        if (this.elements.schoolCount) this.elements.schoolCount.textContent = String(this.filterSchools?.size || 0);
        if (this.elements.teamCount) this.elements.teamCount.textContent = String(this.filterTeams?.size || 0);
    }

    _renderTagGroup(container, set, type, labelFn) {
        if (!container) return;
        if (type === 'school') {
            container.innerHTML = Array.from(set).map(v => {
                const c = RankToolSchoolFilterColors(v);
                return `<span class="filter-tag filter-tag-school" style="background:${c.tagBg};border-color:${c.border};color:${c.text};--filter-tag-x:${c.tagAccent}">
                <span class="filter-tag-label">${RankToolEscapeHtml(labelFn(v))}</span>
                <button class="filter-tag-remove" data-type="${type}" data-value="${RankToolEscapeHtml(v)}" title="移除">&times;</button>
            </span>`;
            }).join('');
        } else if (type === 'team') {
            container.innerHTML = Array.from(set).map(tid => {
                const t = this.teamMap[tid];
                const ck = this._rankFilterColorKeyForTeamId(tid);
                const c = RankToolSchoolFilterColors(ck);
                const idEsc = RankToolEscapeHtml(tid);
                const nameEsc = RankToolEscapeHtml(t ? (t.name || '') : '');
                const primary = nameEsc ? `${idEsc} · ${nameEsc}` : idEsc;
                const meta = this._teamFilterMetaPlain(t || {});
                const metaBlock = meta
                    ? `<span class="filter-tag-meta">${RankToolEscapeHtml(meta)}</span>`
                    : '';
                return `<span class="filter-tag filter-tag-team" style="background:${c.tagBg};border-color:${c.border};color:${c.text};--filter-tag-x:${c.tagAccent}">
                <span class="filter-tag-text-col">
                    <span class="filter-tag-primary">${primary}</span>
                    ${metaBlock}
                </span>
                <button class="filter-tag-remove" data-type="${type}" data-value="${RankToolEscapeHtml(tid)}" title="移除">&times;</button>
            </span>`;
            }).join('');
        } else {
            container.innerHTML = Array.from(set).map(v =>
                `<span class="filter-tag">
                <span class="filter-tag-label">${RankToolEscapeHtml(labelFn(v))}</span>
                <button class="filter-tag-remove" data-type="${type}" data-value="${RankToolEscapeHtml(v)}" title="移除">&times;</button>
            </span>`
            ).join('');
        }

        container.querySelectorAll('.filter-tag-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.value;
                if (type === 'school') this.filterSchools.delete(val);
                else this.filterTeams.delete(val);
                this._renderFilterTags();
                this.ApplyFilter();
            });
        });
    }

    // ─── 候选浮动层 ───────────────────────────────────────────────
    _updateSchoolCandidates() {
        const container = this.elements.schoolCandidates;
        if (!container) return;
        const q = (this.elements.schoolSearch?.value || '').toLowerCase().trim();
        const all = this._getAllSchools();
        const filtered = q ? all.filter(s => s.toLowerCase().includes(q)) : all;
        const available = filtered.filter(s => !this.filterSchools.has(s));
        this._renderCandidates(container, available, 'school');
    }

    _updateTeamCandidates() {
        const container = this.elements.teamCandidates;
        if (!container) return;
        const q = (this.elements.teamSearch?.value || '').toLowerCase().trim();
        const all = this._getAllTeamInfos();
        const filtered = q ? all.filter(t => this._teamFilterItemMatchesQuery(t, q)) : all;
        const available = filtered.filter(t => !this.filterTeams.has(t.team_id));
        this._renderCandidates(container, available, 'team');
    }

    _renderCandidates(container, items, type) {
        const max = 80;
        if (items.length === 0) {
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
            const meta = this._teamFilterMetaPlain(item);
            const metaRow = meta
                ? `<div class="filter-candidate-team-meta">${RankToolEscapeHtml(meta)}</div>`
                : '';
            return `<div class="filter-candidate-item filter-candidate-team" role="button" tabindex="0" data-value="${RankToolEscapeHtml(item.team_id)}"><div class="filter-candidate-team-primary">${primary}</div>${metaRow}</div>`;
        }).join('');

        container.querySelectorAll('.filter-candidate-item').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                e.preventDefault(); // 阻止 blur 导致浮动层消失
                if (type === 'school') this.filterSchools.add(el.dataset.value);
                else this.filterTeams.add(el.dataset.value);
                this._renderFilterTags();
                if (type === 'school') this._updateSchoolCandidates();
                else this._updateTeamCandidates();
                this.ApplyFilter();
            });
        });
    }

    // ─── Override：渲染与高亮 ──────────────────────────────────────
    UpdateRank(flg_render = true, starMode = null) {
        if (!this.rankList || !this.rankList.length) return [];

        const starForAward = starMode === null || starMode === undefined ? this.starMode : starMode;
        this.UpdateAwardInfo(starForAward);

        const hasFilter = this.HasActiveFilter();
        this._ensurePinnedHost();
        const baseList = this.FilterByStarMode(this.rankList, starMode);
        baseList.sort((a, b) => this.CompareTeamsForRanking(a, b));
        const displayList = (this.currentMode === 'school')
            ? (hasFilter && this.filterDisplayMode === 'filtered'
                ? this.ApplyKeywordFilters(this.CalculateSchoolRank(baseList), 'school')
                : this.CalculateSchoolRank(baseList))
            : (hasFilter && this.filterDisplayMode === 'filtered'
                ? this.ApplyKeywordFilters(baseList, 'team')
                : baseList);

        this.latestDisplayList = displayList;
        this.UpdateFilterQuickInfo(this.ApplyKeywordFilters(baseList, 'team'));

        if (flg_render) {
            const incremental = !!(this.elements.rankGrid && this.elements.rankGrid.children.length > 0);
            this._rankPerfLog('UpdateRank:after_prepare', {
                displayLen: displayList.length,
                baseLen: baseList.length,
                hasFilter,
                currentMode: this.currentMode,
                incremental,
            });
            const run = async () => {
                if (!this.elements.rankGrid) return;
                this._rankPerfLog('UpdateRank:runRender_start', { incremental });
                const tMain = performance.now();
                if (incremental) {
                    await this.IncrementalUpdate(displayList);
                } else {
                    await this.RenderRank(displayList);
                }
                this._rankPerfLog('UpdateRank:after_main_render', {
                    ms: (performance.now() - tMain).toFixed(1),
                    incremental,
                });
                requestAnimationFrame(() => this._applyFilterHighlights());
                const tPin = performance.now();
                if (hasFilter && this.filterDisplayMode === 'pinned') {
                    await this._renderPinnedTopRowsFromList(displayList);
                } else {
                    this._clearPinnedTopRows();
                }
                this._rankPerfLog('UpdateRank:after_pinned', {
                    ms: (performance.now() - tPin).toFixed(1),
                    pinned: hasFilter && this.filterDisplayMode === 'pinned',
                });
            };
            this._rankPerfLog('UpdateRank:render_enqueued');
            this._rankRenderChain = this._rankRenderChain
                .then(() => run())
                .catch((e) => console.warn('[RankPageSystem] UpdateRank render', e));
        }
        return displayList;
    }

    async CreateRankRow(item, rank, index) {
        const row = await super.CreateRankRow(item, rank, index);
        const match = this.HasActiveFilter() && this.IsFilterMatch(item);
        const sch = match ? this._resolveFilterHighlightSchool(item) : null;
        this._syncFilterMatchRowStyles(row, match, sch);
        return row;
    }

    async UpdateRankRow(item, rank, index) {
        await super.UpdateRankRow(item, rank, index);
        const row = document.getElementById(`rank-grid-${item.item_key}`);
        if (row) {
            const match = this.HasActiveFilter() && this.IsFilterMatch(item);
            const sch = match ? this._resolveFilterHighlightSchool(item) : null;
            this._syncFilterMatchRowStyles(row, match, sch);
        }
    }

    _applyFilterHighlights() {
        if (!this.elements.rankGrid) return;
        const active = this.HasActiveFilter();
        this.elements.rankGrid.querySelectorAll('.rank-row').forEach(row => {
            const key = row.getAttribute('data-row-id');
            const match = active && this._isFilterMatchByKey(key);
            const sch = match ? this._resolveFilterHighlightSchoolByKey(key) : null;
            this._syncFilterMatchRowStyles(row, match, sch);
        });
    }

    _ensurePinnedHost() {
        if (this._pinnedHost && this._pinnedHost.parentNode) return;
        const rankContainer = this.container.querySelector('.rank-container');
        if (!rankContainer) return;
        const host = document.createElement('div');
        host.id = 'rank-filter-pinned-host';
        host.className = 'rank-filter-pinned-host';
        host.style.display = 'none';
        const rankGrid = this.elements.rankGrid || rankContainer.querySelector('#rank-grid');
        if (rankGrid) {
            rankGrid.insertAdjacentElement('beforebegin', host);
        } else {
            rankContainer.appendChild(host);
        }
        this._pinnedHost = host;
    }

    _clearPinnedTopRows() {
        this._pinnedRenderSeq = (this._pinnedRenderSeq || 0) + 1;
        this._ensurePinnedHost();
        if (!this._pinnedHost) return;
        this._pinnedHost.innerHTML = '';
        this._pinnedHost.style.display = 'none';
    }

    _getPinnedDisplayItems(displayList) {
        if (!this.HasActiveFilter()) return [];
        const source = Array.isArray(displayList) ? displayList : [];
        const mode = this.currentMode === 'school' ? 'school' : 'team';
        return this.ApplyKeywordFilters(source, mode);
    }

    async _renderPinnedTopRowsFromList(displayList) {
        this._ensurePinnedHost();
        if (!this._pinnedHost) return;

        const token = (this._pinnedRenderSeq || 0) + 1;
        this._pinnedRenderSeq = token;

        const source = Array.isArray(displayList) ? displayList : [];
        const rankedList = this.CalculateRankInfo(source);
        const matches = this._getPinnedDisplayItems(rankedList);
        if (!matches.length) {
            this._clearPinnedTopRows();
            return;
        }

        const pinnedGrid = document.createElement('div');
        pinnedGrid.className = 'rank-filter-pinned-grid';
        for (const item of matches) {
            const index = rankedList.indexOf(item);
            const row = await this.CreateRankRow(item, item.displayRank, index >= 0 ? index : 0);
            if (token !== this._pinnedRenderSeq) return;
            if (row && row.nodeType === Node.ELEMENT_NODE) {
                row.id = '';
                row.classList.add('rank-filter-pinned-row');
                pinnedGrid.appendChild(row);
            }
        }

        if (token !== this._pinnedRenderSeq) return;
        this._pinnedHost.innerHTML = `
            <div class="rank-filter-pinned-title">${this.CreateBilingualText('筛选置顶结果', 'Pinned Filtered Rows')}</div>
            <div class="rank-filter-pinned-divider"></div>
            <div class="rank-filter-pinned-separator"></div>
        `;
        this._pinnedHost.insertBefore(pinnedGrid, this._pinnedHost.querySelector('.rank-filter-pinned-separator'));
        this._pinnedHost.style.display = '';
    }

    _renderPinnedTopRowsFromGrid() {
        this._ensurePinnedHost();
        if (!this._pinnedHost || !this.elements.rankGrid) return;
        const matches = [];
        this.elements.rankGrid.querySelectorAll('.rank-row').forEach(row => {
            const key = row.getAttribute('data-row-id');
            if (key && this._isFilterMatchByKey(key)) matches.push(row);
        });
        if (!matches.length) {
            this._clearPinnedTopRows();
            return;
        }
        const rowsHtml = matches.map(row => {
            const clone = row.cloneNode(true);
            clone.id = '';
            clone.classList.add('rank-filter-pinned-row');
            return clone.outerHTML;
        }).join('');
        this._pinnedHost.innerHTML = `
            <div class="rank-filter-pinned-title">${this.CreateBilingualText('筛选置顶结果', 'Pinned Filtered Rows')}</div>
            <div class="rank-filter-pinned-divider"></div>
            <div class="rank-filter-pinned-grid">${rowsHtml}</div>
            <div class="rank-filter-pinned-separator"></div>
        `;
        this._pinnedHost.style.display = '';
    }
}

// ─── OutrankPageSystem：外榜继承 RankPageSystem ─────────────────
if (typeof OutrankPageSystem == 'undefined') {
    class OutrankPageSystem extends RankPageSystem {
        constructor(containerId, config = {}) {
            const defaultConfig = {
                cache_duration: 60 * 1000,
                request_t_param: true,
                is_outrank_standalone: false,
            };
            const mergedConfig = RankToolMergeConfig(defaultConfig, config);
            super(containerId, mergedConfig);
        }

        Init() {
            super.Init();
            if (this.config.is_outrank_standalone) {
                this._bindOutrankToolbarMediaQuery();
                if (!this._outrankPagehideTeamWaitBound) {
                    this._outrankPagehideTeamWaitBound = true;
                    window.addEventListener('pagehide', () => this._outrankStopTeamWaitPoll());
                }
            }
        }

        CreateHeader() {
            super.CreateHeader();
            if (this.config.is_outrank_standalone) {
                this._relayoutOutrankStandaloneToolbar();
            }
        }

        /**
         * 外榜独立页：宽屏筛选在 controls-time 行；窄屏收入「更多」下拉（与刷新/帮助等并列）。
         * 皮肤在窄屏同样收入「更多」下拉。
         */
        _relayoutOutrankStandaloneToolbar() {
            if (!this.config.is_outrank_standalone) return;
            const header = this.GetHeaderElement();
            if (!header) return;

            const narrow = window.matchMedia('(max-width: 1024px)').matches;
            const tc = header.querySelector('.controls-time-container');
            const drop = header.querySelector('#controls-dropdown');
            const modeItem = header.querySelector('#rank-mode-btn')?.closest('.toolbar-item');

            const filterGroups = Array.from(header.querySelectorAll('.toolbar-group.toolbar-group-filter'));
            let fg = filterGroups.find((g) => g.querySelector('#rank-filter-btn')) || filterGroups[0] || null;
            filterGroups.forEach((g) => {
                if (g !== fg) g.remove();
            });
            if (fg) {
                const primaryBtn = fg.querySelector('#rank-filter-btn');
                if (primaryBtn) primaryBtn.classList.add('with-text');
                if (narrow) {
                    fg.classList.remove('toolbar-group-filter-standalone');
                    if (drop && !drop.contains(fg)) {
                        drop.insertBefore(fg, drop.firstChild);
                    }
                } else {
                    fg.classList.add('toolbar-group-filter-standalone');
                    if (tc) {
                        if (modeItem && (!tc.contains(fg) || fg.parentElement !== tc)) {
                            modeItem.insertAdjacentElement('afterend', fg);
                        } else if (!tc.contains(fg)) {
                            const bar = tc.querySelector('#header-controls');
                            (bar || tc).appendChild(fg);
                        }
                    }
                    if (drop && drop.contains(fg) && modeItem) {
                        modeItem.insertAdjacentElement('afterend', fg);
                    }
                }
            }

            const skinItem = header.querySelector('#rank-skin-btn')?.closest('.toolbar-item');
            if (!skinItem || !tc || !drop) return;

            if (narrow) {
                if (!drop.contains(skinItem)) {
                    let wrap = header.querySelector('.toolbar-group.toolbar-group-skin-outrank');
                    if (!wrap) {
                        wrap = document.createElement('div');
                        wrap.className = 'toolbar-group toolbar-group-skin-outrank';
                    }
                    wrap.appendChild(skinItem);
                    drop.insertBefore(wrap, drop.firstChild);
                }
            } else if (skinItem.closest('#controls-dropdown')) {
                const anchor = tc.querySelector('.toolbar-group-filter-standalone') || modeItem;
                anchor.insertAdjacentElement('afterend', skinItem);
                header.querySelectorAll('.toolbar-group-skin-outrank').forEach((el) => {
                    if (!el.querySelector('#rank-skin-btn')) el.remove();
                });
            }
        }

        _bindOutrankToolbarMediaQuery() {
            if (this._outrankToolbarMqBound) return;
            this._outrankToolbarMqBound = true;
            const mq = window.matchMedia('(max-width: 1024px)');
            const onChange = () => {
                this._relayoutOutrankStandaloneToolbar();
                const h = this.GetHeaderElement();
                if (h && typeof this.SetupDynamicTooltips === 'function') {
                    this.SetupDynamicTooltips(h);
                }
            };
            if (mq.addEventListener) {
                mq.addEventListener('change', onChange);
            } else if (mq.addListener) {
                mq.addListener(onChange);
            }
        }

        _outrankStopTeamWaitPoll() {
            if (this._outrankTeamWaitPollIv) {
                clearInterval(this._outrankTeamWaitPollIv);
                this._outrankTeamWaitPollIv = null;
            }
        }

        /**
         * 与 `cpcsys/view/contest/team_cards_grid.php` 结构一致，供 `CpcTeamCardsInit` 使用。
         * @param {{ rows: Array, is_multi_group: number }} cardPack
         * @returns {string}
         */
        _outrankBuildTeamWaitCardsHtml(cardPack) {
            const esc = typeof RankToolEscapeHtml === 'function' ? RankToolEscapeHtml : (s) => String(s ?? '');
            const rows = (cardPack && Array.isArray(cardPack.rows)) ? cardPack.rows : [];
            const isMulti = cardPack && Number(cardPack.is_multi_group) === 1;
            if (!rows.length) {
                return '<p class="text-muted small bilingual-inline cpc-team-cards-empty">暂无队伍信息。<span class="en-text">No team listings.</span></p>';
            }
            const parts = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const school = row.school != null ? String(row.school) : '';
                const region = row.region != null ? String(row.region) : '';
                const schoolAttr = school ? ` data-school="${esc(school)}"` : '';
                const schoolTitle = school ? '学校标识 / School' : 'CCPC';
                const schoolAria = school ? esc(school) : 'CCPC';
                const nameEnStr = row.name_en && String(row.name_en).trim() ? String(row.name_en).trim() : '';
                const nameEnDiv = nameEnStr
                    ? `<div class="cpc-team-card__name-en cpc-team-card__mq" data-cpc-mq-plain="${esc(nameEnStr)}" title="英文名 / English name">${esc(nameEnStr)}</div>`
                    : '';
                const tkind = row.tkind != null ? Number(row.tkind) : 0;
                let markerHtml = '';
                if (tkind === 2) {
                    markerHtml =
                        '<span class="csg-marker-layer-tl" aria-hidden="true"><span class="csg-marker-yellow-star-tl" title="打星队伍 / Star team"><i class="bi bi-star-fill" aria-hidden="true"></i></span></span>';
                } else if (tkind === 1) {
                    markerHtml =
                        '<span class="csg-marker-layer-tl" aria-hidden="true"><span class="csg-marker-girl-tl" title="女队 / Girl team"><i class="bi bi-heart-fill" aria-hidden="true"></i></span></span>';
                }
                const hasTypeMarker = tkind === 1 || tkind === 2;
                const wrapCls = `cpc-team-card__name-wrap${hasTypeMarker ? ' cpc-team-card__name-wrap--marker' : ''}`;
                const titleBlock = `<div class="cpc-team-card__title-line">
            <div class="${wrapCls}">
                ${markerHtml}
                <div class="cpc-team-card__name cpc-team-card__mq" data-cpc-mq-plain="${esc(row.name)}" title="队名 / Team name">${esc(row.name)}</div>
            </div>
        </div>${nameEnStr ? nameEnDiv : ''}`;
                const regionSlot = region
                    ? `<div class="cpc-team-card__school-flag-slot" aria-hidden="true"><img class="flag-icon" data-flag="${esc(region)}" alt="" role="presentation" width="24" height="18" decoding="async" style="opacity:0" /></div>`
                    : '';
                const schoolLine =
                    (school || region)
                        ? `<div class="cpc-team-card__school-line">${regionSlot}<div class="cpc-team-card__school cpc-team-card__mq"${school ? ` data-cpc-mq-plain="${esc(school)}"` : ''} title="学校 / School">${esc(school)}</div></div>`
                        : '';
                const room =
                    row.room && String(row.room).trim()
                        ? `<span class="cpc-team-card__pill" title="场地 / Room">${esc(row.room)}</span>`
                        : '';
                let groupsHtml = '';
                if (isMulti && Array.isArray(row.group_labels) && row.group_labels.length) {
                    const chips = row.group_labels
                        .map((gl) => {
                            const cn = gl && gl.group_name != null ? String(gl.group_name) : '';
                            const en = gl && gl.group_name_en != null ? String(gl.group_name_en).trim() : '';
                            const enPart = en ? `<span class="en-text">${esc(en)}</span>` : '';
                            return `<span class="cpc-team-card__group-chip"><span class="cn-text">${esc(cn)}</span>${enPart}</span>`;
                        })
                        .join('');
                    groupsHtml = `<div class="cpc-team-card__groups" title="分组 / Groups">${chips}</div>`;
                }
                const coach =
                    row.coach && String(row.coach).trim()
                        ? `<div class="cpc-team-card__row"><span class="cpc-team-card__lbl" role="group" aria-label="教练 Coach"><span class="cn-text">教练</span><span class="en-text">Coach</span></span><span class="cpc-team-card__val cpc-team-card__hud-mq-slot" data-cpc-val-plain="${esc(row.coach)}">${esc(row.coach)}</span></div>`
                        : '';
                const tmember =
                    row.tmember && String(row.tmember).trim()
                        ? `<div class="cpc-team-card__row cpc-team-card__row--multiline"><span class="cpc-team-card__lbl" role="group" aria-label="选手 Members"><span class="cn-text">选手</span><span class="en-text">Members</span></span><span class="cpc-team-card__val cpc-team-card__hud-mq-slot" data-cpc-val-plain="${esc(row.tmember)}">${esc(row.tmember)}</span></div>`
                        : '';
                parts.push(`<article class="cpc-team-card" role="listitem">
        <div class="cpc-team-card__header">
            <div class="cpc-team-card__logo school-logo"${schoolAttr}
                 title="${school ? '学校标识 / School' : 'CCPC'}"
                 role="img"
                 aria-label="${schoolAria}"></div>
            <div class="cpc-team-card__header-main">
                ${titleBlock}
                ${schoolLine}
            </div>
            <div class="cpc-team-card__header-end">
                <span class="cpc-team-card__tid mono" title="账号 / Account">${esc(row.team_id)}</span>
                <span class="cpc-team-card__room-slot">${room}</span>
            </div>
        </div>
        ${groupsHtml}
        <div class="cpc-team-card__body">${coach}${tmember}</div>
    </article>`);
            }
            return `<div class="cpc-team-cards-grid" role="list">${parts.join('')}</div>`;
        }

        _outrankMountTeamWait(cardPack) {
            this._outrankStopTeamWaitPoll();
            this._outrankTeamWaitUiActive = true;
            const header = this.GetHeaderElement();
            if (header && header.parentNode) {
                header.remove();
            }
            this.container.classList.remove('rank-system');
            const cardsHtml = this._outrankBuildTeamWaitCardsHtml(cardPack);
            this.container.innerHTML = `
<div id="outrank-rank-unified-root" class="cpc-rank-unified-root">
    <div id="outrank-rank-wait-inner" class="cpc-rank-wait-inner">
        <p class="cpc-rank-wait-note text-muted bilingual-inline mb-3">
            本场尚未有任何提交，榜单将在首次提交后自动显示。
            <span class="en-text">No submissions yet. The ranklist appears automatically after the first submission.</span>
        </p>
        ${cardsHtml}
    </div>
</div>`;
            const g = typeof window !== 'undefined' ? window : globalThis;
            g.CPC_TEAM_CARD_CONFIG = g.CPC_TEAM_CARD_CONFIG || {};
            g.CPC_TEAM_CARD_CONFIG.school_badge_url =
                (this.config && this.config.school_badge_url) || '/static/image/school_badge';
            g.CPC_TEAM_CARD_CONFIG.region_flag_url =
                (this.config && this.config.region_flag_url) || '/static/image/region_flag';
            const inner = this.container.querySelector('#outrank-rank-wait-inner');
            if (inner && typeof g.CpcTeamCardsInit === 'function') {
                g.CpcTeamCardsInit(inner);
            }
            this._outrankStartTeamWaitPoll();
        }

        _outrankStartTeamWaitPoll() {
            if (!this.config || typeof this.config.api_url !== 'string' || !this.config.api_url) {
                return;
            }
            this._outrankStopTeamWaitPoll();
            const tick = () => {
                this._outrankTeamWaitPollOnce().catch(() => {});
            };
            tick();
            this._outrankTeamWaitPollIv = setInterval(tick, 4000);
        }

        async _outrankTeamWaitPollOnce() {
            const apiUrl = this.config.api_url;
            const u = new URL(apiUrl, window.location.origin);
            u.searchParams.set('_', String(Date.now()));
            if (this.config.request_t_param) {
                u.searchParams.set('t', String(Date.now()));
            }
            const path = u.pathname + u.search;
            const r = await fetch(path, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Content-Type': 'application/json',
                },
            });
            if (!r.ok) {
                return;
            }
            const text = await r.text();
            let result = null;
            try {
                result = JSON.parse(text);
            } catch (eJson) {
                return;
            }
            let data = null;
            if (result && result.code === 1 && result.data) {
                data = result.data;
            } else if (result && (result.contest || result.team || result.problem || result.solution)) {
                data = result;
            }
            if (!data) {
                return;
            }
            if (typeof RankToolStaticRankPayloadHasSolution === 'function' && RankToolStaticRankPayloadHasSolution(data)) {
                this._outrankStopTeamWaitPoll();
                const cacheKey = `${this.key}_data_v2`;
                try {
                    if (this.cache) {
                        await this.cache.delete(cacheKey);
                    }
                } catch (eDel) {
                    /* ignore */
                }
                window.location.reload();
            }
        }

        async LoadData() {
            if (this._outrankTeamWaitUiActive) {
                return;
            }
            try {
                this.ShowLoading();
                const raw = await RankToolLoadStaticRankData(this);
                let cardPack = null;
                if (
                    this.config.is_outrank_standalone &&
                    typeof RankToolOutrankExtractTeamWaitCardPack === 'function'
                ) {
                    cardPack = RankToolOutrankExtractTeamWaitCardPack(raw);
                }
                if (cardPack) {
                    this.HideLoading();
                    this.isInitialLoad = false;
                    this._outrankMountTeamWait(cardPack);
                    return;
                }
                this.data = raw;
                this.OriInit(this.data);
                this.HideLoading();
                this.isInitialLoad = false;
            } catch (error) {
                console.error('数据加载错误:', error);
                this.ShowError('网络错误，请检查连接');
            }
        }
    }
    window.OutrankPageSystem = OutrankPageSystem;
}

// ─── 工厂函数 ─────────────────────────────────────────────────────
function RankPageSystemInit(containerId, config = {}) {
    if (!config || Object.keys(config).length === 0) {
        config = window.RANK_CONFIG || {};
    }
    return new RankPageSystem(containerId, config);
}

function OutrankPageSystemInit(containerId, config = {}) {
    if (!config || Object.keys(config).length === 0) {
        config = window.RANK_CONFIG || {};
    }
    return new OutrankPageSystem(containerId, config);
}

} /* RankSystem / __CSGOJ_RANK_JS_READY */
