(function () {
    'use strict';

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    class CsgMultiSelect {
        constructor(container, config) {
            this.container = container;
            this.config = Object.assign({
                placeholder: 'Select...',
                searchPlaceholder: 'Search...',
                emptyText: 'No options',
                selectedSuffix: 'selected',
                maxChips: 2,
                options: [],
                selected: [],
                disabled: false,
                onChange: null,
                /** 可选：嵌入切换按钮左侧的固定标签（如榜单筛选按钮的「筛选 + 摘要」一体），{ cn, en } 会转义 */
                toggleLabel: null,
            }, config || {});
            this.options = Array.isArray(this.config.options) ? this.config.options.slice() : [];
            this.selectedSet = new Set(Array.isArray(this.config.selected) ? this.config.selected : []);
            this.disabled = !!this.config.disabled;
            this._render();
            this._bind();
            this._setDisabledUi();
            this._syncSummary();
        }

        _render() {
            this.container.classList.add('csg-ms');
            const tl = this.config.toggleLabel;
            // 不用 .en-text：按钮内 .btn .en-text 会被 bilingual.css 设为块级，标签会折成两行
            const labelHtml = tl && (tl.cn != null || tl.en != null)
                ? `<span class="csg-ms-toggle-label"><span class="csg-ms-toggle-cn">${escHtml(tl.cn != null ? String(tl.cn) : '')}</span><span class="csg-ms-toggle-sep">/</span><span class="csg-ms-toggle-en">${escHtml(tl.en != null ? String(tl.en) : '')}</span></span>`
                : '';
            const toggleCls = labelHtml ? 'btn csg-ms-toggle csg-ms-toggle--with-label dropdown-toggle' : 'btn csg-ms-toggle dropdown-toggle';
            this.container.innerHTML = `
                <button type="button" class="${toggleCls}" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
                    ${labelHtml}
                    <span class="csg-ms-summary"></span>
                    <span class="csg-ms-count"></span>
                </button>
                <div class="dropdown-menu csg-ms-menu">
                    <div class="csg-ms-search-wrap">
                        <input type="text" class="form-control form-control-sm csg-ms-search" placeholder="${escHtml(this.config.searchPlaceholder)}">
                    </div>
                    <div class="csg-ms-options"></div>
                </div>
            `;
            this.toggleEl = this.container.querySelector('.csg-ms-toggle');
            this.summaryEl = this.container.querySelector('.csg-ms-summary');
            this.countEl = this.container.querySelector('.csg-ms-count');
            this.menuEl = this.container.querySelector('.csg-ms-menu');
            this.searchEl = this.container.querySelector('.csg-ms-search');
            this.optionsEl = this.container.querySelector('.csg-ms-options');
            this._renderOptions();
        }

        _renderOptions() {
            this.optionsEl.innerHTML = this.options.map(opt => {
                const val = String(opt.value);
                const checked = this.selectedSet.has(val) ? ' checked' : '';
                return `
                    <label class="csg-ms-option" data-value="${escHtml(val)}" data-label="${escHtml(String(opt.label || opt.value).toLowerCase())}">
                        <input type="checkbox" value="${escHtml(val)}"${checked}>
                        <span class="csg-ms-option-label">${escHtml(opt.label || opt.value)}</span>
                    </label>
                `;
            }).join('');
            if (!this.options.length) {
                this.optionsEl.innerHTML = `<div class="csg-ms-empty">${escHtml(this.config.emptyText)}</div>`;
            }
        }

        _bind() {
            this.optionsEl.addEventListener('change', (e) => {
                const cb = e.target;
                if (!cb || cb.type !== 'checkbox') return;
                const v = String(cb.value || '');
                if (cb.checked) this.selectedSet.add(v);
                else this.selectedSet.delete(v);
                this._syncSummary();
                this._emitChange();
            });
            if (this.searchEl) {
                this.searchEl.addEventListener('input', () => this._filterOptions());
            }
        }

        _emitChange() {
            const values = this.getSelectedValues();
            if (typeof this.config.onChange === 'function') {
                this.config.onChange(values);
            }
            this.container.dispatchEvent(new CustomEvent('csg-multiselect-change', {
                detail: { values }
            }));
        }

        _syncSummary() {
            const selected = this.options.filter(opt => this.selectedSet.has(String(opt.value)));
            if (!selected.length) {
                this.summaryEl.innerHTML = `<span class="csg-ms-placeholder">${escHtml(this.config.placeholder)}</span>`;
                this.countEl.textContent = `0 ${this.config.selectedSuffix}`;
                return;
            }
            const chips = selected.slice(0, this.config.maxChips).map(opt =>
                `<span class="csg-ms-chip">${escHtml(opt.label || opt.value)}</span>`
            );
            if (selected.length > this.config.maxChips) {
                chips.push(`<span class="csg-ms-chip">+${selected.length - this.config.maxChips}</span>`);
            }
            this.summaryEl.innerHTML = chips.join('');
            this.countEl.textContent = `${selected.length} ${this.config.selectedSuffix}`;
        }

        setOptions(options) {
            this.options = Array.isArray(options) ? options.slice() : [];
            const valid = new Set(this.options.map(opt => String(opt.value)));
            this.selectedSet = new Set(Array.from(this.selectedSet).filter(v => valid.has(v)));
            this._renderOptions();
            this._setDisabledUi();
            this._filterOptions();
            this._syncSummary();
        }

        setSelectedValues(values, silent) {
            this.selectedSet = new Set((Array.isArray(values) ? values : []).map(v => String(v)));
            this.optionsEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = this.selectedSet.has(String(cb.value));
            });
            this._syncSummary();
            if (!silent) this._emitChange();
        }

        getSelectedValues() {
            return this.options
                .map(opt => String(opt.value))
                .filter(v => this.selectedSet.has(v));
        }

        selectAll(silent) {
            this.setSelectedValues(this.options.map(opt => String(opt.value)), silent);
        }

        clear(silent) {
            this.setSelectedValues([], silent);
        }

        setDisabled(disabled) {
            this.disabled = !!disabled;
            this._setDisabledUi();
        }

        updateConfig(partialConfig) {
            this.config = Object.assign({}, this.config, partialConfig || {});
            if (this.searchEl && this.config.searchPlaceholder != null) {
                this.searchEl.placeholder = String(this.config.searchPlaceholder);
            }
            this._syncSummary();
        }

        destroy() {
            this.container.classList.remove('csg-ms');
            this.container.innerHTML = '';
            delete this.container.dataset.csgMultiselectId;
        }

        _setDisabledUi() {
            if (!this.toggleEl) return;
            this.toggleEl.disabled = this.disabled;
            this.container.classList.toggle('csg-ms-disabled', this.disabled);
            if (this.searchEl) this.searchEl.disabled = this.disabled;
            this.optionsEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.disabled = this.disabled;
            });
        }

        _filterOptions() {
            const keyword = String(this.searchEl ? this.searchEl.value : '').trim().toLowerCase();
            const rows = this.optionsEl.querySelectorAll('.csg-ms-option');
            rows.forEach(row => {
                if (!keyword) {
                    row.style.display = '';
                    return;
                }
                const hay = String(row.getAttribute('data-label') || '');
                row.style.display = hay.includes(keyword) ? '' : 'none';
            });
        }
    }

    window.csgMultiSelect = {
        create(container, config) {
            if (!container) return null;
            if (container.dataset.csgMultiselectId && container._csgMultiSelectInstance) {
                return container._csgMultiSelectInstance;
            }
            const inst = new CsgMultiSelect(container, config);
            container.dataset.csgMultiselectId = '1';
            container._csgMultiSelectInstance = inst;
            return inst;
        },
        destroy(container) {
            if (!container || !container._csgMultiSelectInstance) return;
            container._csgMultiSelectInstance.destroy();
            delete container._csgMultiSelectInstance;
        }
    };
})();
