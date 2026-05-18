/**
 * Alerty - Bootstrap 5 弹窗和通知系统
 */

// 避免重复声明
if (typeof window.alerty !== 'undefined') {
    // console.warn('Alerty already initialized, skipping...');
} else {

class Alerty {
    constructor() {
        this.notificationContainer = null;
        this.notificationCount = 0;
        this.maxNotifications = 5;
        this.activeModals = new Set(); // 跟踪正在显示的 modal ID
        this.currentModal = null; // 当前活动的 modal 元素
        this.escapeDiv = document.createElement('div'); // 缓存用于转义的 div，提升性能
        this.creatingModal = false; // 防止在创建 modal 过程中重复创建
        this.lastModalCreateTime = 0; // 上次创建 modal 的时间戳
        this.init();
    }

    init() {
        this.createNotificationContainer();
    }

    // 创建通知容器
    createNotificationContainer() {
        if (!this.notificationContainer) {
            if (!document.body) {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        this.createNotificationContainer();
                    });
                    return;
                }
            }
            
            this.notificationContainer = document.createElement('div');
            this.notificationContainer.id = 'alerty-notifications';
            // 使用 fixed 定位，确保相对于视口，而不是页面
            // 添加 left: auto 和 bottom: auto 确保定位正确
            this.notificationContainer.style.cssText = `
                position: fixed !important;
                top: 20px !important;
                right: 20px !important;
                left: auto !important;
                bottom: auto !important;
                z-index: 9999 !important;
                max-width: 400px;
                pointer-events: auto;
            `;
            document.body.appendChild(this.notificationContainer);
        }
    }

    // 检查样式值是否包含单位
    hasUnit(value) {
        return typeof value === 'string' && 
               (value.includes('%') || value.includes('px') || value.includes('vw') || 
                value.includes('vh') || value.includes('rem') || value.includes('em'));
    }

    // 生成样式属性值
    generateStyleValue(value, property) {
        if (typeof value === 'number') {
            return `${property}: ${value}px !important;`;
        } else if (typeof value === 'string') {
            if (this.hasUnit(value)) {
                return `${property}: ${value} !important;`;
            } else {
                return `${property}: ${value}px !important;`;
            }
        }
        return '';
    }

    // 获取模态框样式
    getModalDialogStyle(options) {
        let style = '';
        const width = options.width || options.size;
        
        // 处理自定义宽度
        if (width && !['sm', 'lg', 'xl', 'fullscreen'].includes(width)) {
            style += this.generateStyleValue(width, 'width');
        }
        
        // 处理高度
        if (options.height) {
            style += this.generateStyleValue(options.height, 'height');
        }
        
        return style;
    }

    // 检查是否可以创建新的 modal（防止重复创建）
    canCreateModal() {
        // 如果正在创建 modal，拒绝
        if (this.creatingModal) {
            return false;
        }
        
        // 如果距离上次创建时间太短（100ms内），拒绝（防止快速重复点击）
        const now = Date.now();
        if (now - this.lastModalCreateTime < 100) {
            return false;
        }
        
        return true;
    }

    // 创建模态框
    createModal(options) {
        // 【防重复】设置创建标志和时间戳
        this.creatingModal = true;
        this.lastModalCreateTime = Date.now();
        
        let defaultTitle = '提示<span class="en-text">Tip</span>';
        if (options.type === 'confirm') {
            defaultTitle = '确认<span class="en-text">Confirm</span>';
        } else if (options.type === 'prompt') {
            defaultTitle = '输入<span class="en-text">Input</span>';
        }
        const title = options.title || defaultTitle;
        const modalId = 'alerty-modal-' + Date.now();
        const width = options.width || options.size;
        
        // 处理预设尺寸类
        let modalDialogClass = 'modal-dialog';
        const presetSizes = {
            'sm': ' modal-sm',
            'lg': ' modal-lg', 
            'xl': ' modal-xl',
            'fullscreen': ' modal-fullscreen'
        };
        
        if (presetSizes[width]) {
            modalDialogClass += presetSizes[width];
        }
        
        const modalDialogStyle = this.getModalDialogStyle(options);
        
        // 生成自定义宽度类
        let customWidthClass = '';
        if (modalDialogStyle && width && !presetSizes[width]) {
            customWidthClass = ` alerty-custom-width-${Date.now()}`;
        }
        
        // 根据 allowBackdropClose 参数决定是否允许点击空白关闭
        const allowBackdropClose = options.allowBackdropClose === true;
        const backdropAttr = allowBackdropClose ? 'true' : 'static';
        
        const modalHtml = `
            <div class="modal fade alerty-modal" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Label" aria-hidden="true" data-bs-backdrop="${backdropAttr}" data-bs-keyboard="false">
                <div class="${modalDialogClass}${customWidthClass}"${modalDialogStyle ? ` style="${modalDialogStyle}"` : ''}>
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title bilingual-inline" id="${modalId}Label">${options.title || title}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            ${options.type === 'prompt' ? this.createPromptInput(options) : this.formatContent(options.message, options.message_en)}
                            ${this.createSwitchesHtml(options)}
                        </div>
                        <div class="modal-footer">
                            ${this.createModalButtons(options)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 移除旧的模态框
        const oldModal = document.getElementById(modalId);
        if (oldModal) {
            oldModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // 添加自定义样式
        if (customWidthClass) {
            this.addCustomModalStyle(modalId, customWidthClass, modalDialogStyle, width);
        }
        
        return modalId;
    }

    // 添加自定义模态框样式
    addCustomModalStyle(modalId, customWidthClass, modalDialogStyle, width) {
        const styleId = `alerty-style-${modalId}`;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .${customWidthClass.trim()} {
                ${modalDialogStyle}
                max-width: ${typeof width === 'number' ? width + 'px' : width} !important;
            }
        `;
        document.head.appendChild(style);
        
        // 清理样式
        const modalElement = document.getElementById(modalId);
        modalElement.addEventListener('hidden.bs.modal', () => {
            const styleElement = document.getElementById(styleId);
            if (styleElement) {
                styleElement.remove();
            }
        });
    }

    // 格式化内容（支持中英双语）
    formatContent(message, message_en) {
        // 检测 message 是否包含完整的 HTML 结构（如 div、table 等块级元素）
        // 如果包含，则直接使用 sanitizeHtml，不进行换行符转换，避免破坏 HTML 结构
        const hasBlockElements = /<(div|table|p|h[1-6]|ul|ol|section|article|header|footer|nav|aside)\b[^>]*>/i.test(message);
        
        if (message_en && message !== message_en) {
            const processedMessage = hasBlockElements ? this.sanitizeHtml(message) : this.formatTextWithLineBreaks(message);
            const processedMessageEn = hasBlockElements ? this.sanitizeHtml(message_en) : this.formatTextWithLineBreaks(message_en);
            return `
                <div class="alerty-bilingual">
                    <div class="alerty-primary">${processedMessage}</div>
                    <div class="alerty-secondary">${processedMessageEn}</div>
                </div>
            `;
        }
        const processedMessage = hasBlockElements ? this.sanitizeHtml(message) : this.formatTextWithLineBreaks(message);
        // 如果包含块级元素，不再额外包装 div（避免双重嵌套）
        if (hasBlockElements) {
            return processedMessage;
        }
        return `<div>${processedMessage}</div>`;
    }
    
    // 格式化文本，智能处理 \n 换行符和 HTML 标签
    formatTextWithLineBreaks(text) {
        if (!text) return '';
        
        let processed = String(text);
        
        // 快速路径：如果文本很简单（不包含换行符和特殊字符），直接返回
        if (!processed.includes('\\') && !processed.includes('\n') && !processed.includes('\r') && !/<[^>]+>/.test(processed)) {
            return processed;
        }
        
        // 合并多个 replace 操作，减少字符串重建次数
        processed = processed
            .replace(/\\n/g, '\n')
            .replace(/\\r\\n/g, '\r\n')
            .replace(/\\r/g, '\r')
            .replace(/\r\n/g, '<br>')
            .replace(/\r/g, '<br>')
            .replace(/\n/g, '<br>')
            .replace(/<br\s*\/?>/gi, '<br>');
        
        // 使用白名单方式处理 HTML：只允许安全的标签
        processed = this.sanitizeHtml(processed);
        
        return processed;
    }
    
    // HTML 转义函数（防止 XSS）- 使用缓存的 div 提升性能
    escapeHtml(text) {
        this.escapeDiv.textContent = text;
        return this.escapeDiv.innerHTML;
    }
    
    // 安全的 HTML 处理：只允许白名单中的标签
    sanitizeHtml(html) {
        // 快速路径：如果文本中没有 HTML 标签，直接返回
        if (!/<[^>]+>/.test(html)) {
            return html;
        }
        
        // 白名单：允许的 HTML 标签
        const allowedTags = {
            'br': true,
            'strong': true,
            'b': true,
            'em': true,
            'i': true,
            'u': true,
            'span': true,
            'p': true,
            'div': true,
            'code': true,
            'pre': true,
            'h1': true,
            'h2': true,
            'h3': true,
            'h4': true,
            'h5': true,
            'h6': true,
            'table': true,
            'tr': true,
            'td': true,
            'th': true,
            'thead': true,
            'tbody': true,
            'tfoot': true,
            'button': true,
            'a': true,
            'ul': true,
            'ol': true,
            'li': true,
            'img': true
        };
        
        // 临时替换允许的标签为占位符
        const placeholders = {};
        let placeholderIndex = 0;
        
        // 匹配所有 HTML 标签（包括自闭合标签）
        const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi;
        
        // 先处理允许的标签，用占位符替换
        let processed = html.replace(tagRegex, (match, tagName) => {
            const lowerTagName = tagName.toLowerCase();
            if (allowedTags[lowerTagName]) {
                // 使用简单的占位符，不需要 Date.now()（性能优化）
                const placeholder = `__ALERTY_TAG_${placeholderIndex}__`;
                placeholders[placeholder] = match;
                placeholderIndex++;
                return placeholder;
            }
            // 不允许的标签转义
            return this.escapeHtml(match);
        });
        
        // 转义所有剩余的 HTML 特殊字符
        processed = this.escapeHtml(processed);
        
        // 恢复占位符（允许的标签）- 使用简单的字符串替换（占位符格式简单，不需要正则）
        for (const placeholder in placeholders) {
            processed = processed.split(placeholder).join(placeholders[placeholder]);
        }
        
        return processed;
    }

    // 创建提示输入框（含 input 旁的 tip 容器，用于校验失败时显示提示且不关弹窗）
    createPromptInput(options) {
        const inputId = 'alerty-prompt-input-' + Date.now();
        const defaultValue = options.defaultValue || options.value || '';
        return `
            <div>
                ${this.formatContent(options.message, options.message_en)}
                <input type="text" class="form-control mt-3" id="${inputId}" value="${this.escapeHtml(defaultValue)}" placeholder="${options.placeholder || ''}">
                <div class="alerty-prompt-tip text-danger small mt-1" style="display:none" role="alert"></div>
            </div>
        `;
    }

    createSwitchesHtml(options) {
        if (!options.switches || !Array.isArray(options.switches) || options.switches.length === 0) {
            return '';
        }
        var items = options.switches.map(function (sw) {
            var id = 'alerty-switch-' + (sw.id || Math.random().toString(36).slice(2));
            var checked = sw.checked ? ' checked' : '';
            var tipHtml = '';
            if (sw.tip || sw.tip_en) {
                // 纵向双语：勿用 bilingual-inline。外层若在 .d-flex 内，bilingual-inline 会触发
                // bilingual.css 中 .d-flex .bilingual-inline .en-text { display: inline !important }，把英文挤成同行小字。
                tipHtml = '<div class="form-text small text-muted mt-1 csg-bilingual-stack">' +
                    (sw.tip || '') +
                    (sw.tip_en ? '<span class="en-text">' + sw.tip_en + '</span>' : '') +
                    '</div>';
            }
            return '<div class="d-flex align-items-start gap-2 mb-2">' +
                '<span class="csg-switch csg-switch-sm">' +
                '<input type="checkbox" class="csg-switch-input alerty-switch-input" data-switch-key="' + (sw.id || '') + '" id="' + id + '"' + checked + '>' +
                '</span>' +
                '<div class="flex-grow-1 min-w-0">' +
                '<label for="' + id + '" class="form-check-label mb-0 csg-bilingual-stack">' +
                (sw.label || '') +
                (sw.label_en ? '<span class="en-text">' + sw.label_en + '</span>' : '') +
                '</label>' +
                tipHtml +
                '</div>' +
                '</div>';
        });
        return '<div class="alerty-switches mt-3 pt-2 border-top">' + items.join('') + '</div>';
    }

    _collectSwitchValues(modalElement) {
        var vals = {};
        var inputs = modalElement.querySelectorAll('.alerty-switch-input');
        for (var i = 0; i < inputs.length; i++) {
            var key = inputs[i].getAttribute('data-switch-key');
            if (key) vals[key] = inputs[i].checked;
        }
        return vals;
    }

    // 创建模态框按钮
    createModalButtons(options) {
        if (options.type === 'confirm' || options.type === 'prompt') {
            return `
                <button type="button" class="btn btn-secondary" id="alerty-cancel-btn">${options.cancelText || '取消'}</button>
                <button type="button" class="btn btn-primary" id="alerty-confirm-btn">${options.okText || '确定'}</button>
            `;
        } else {
            return `<button type="button" class="btn btn-primary" id="alerty-ok-btn" data-bs-dismiss="modal">${options.okText || '确定'}</button>`;
        }
    }

    // 显示模态框
    showModal(modalId, options) {
        const modalElement = document.getElementById(modalId);
        if (!modalElement) {
            // 【防重复】如果元素不存在，清除创建标志
            this.creatingModal = false;
            return;
        }
        
        // 防止重复弹出：如果已经有相同 modalId 正在显示，直接返回
        if (this.activeModals.has(modalId)) {
            // 【防重复】如果已经在显示，清除创建标志
            this.creatingModal = false;
            return;
        }
        
        // 根据 allowBackdropClose 参数决定是否允许点击空白区域关闭
        const allowBackdropClose = options.allowBackdropClose === true;
        const backdropCountBeforeShow = document.querySelectorAll('.modal-backdrop').length;
        const modal = new bootstrap.Modal(modalElement, {
            backdrop: allowBackdropClose ? true : 'static',
            keyboard: false
        });

        // 解析回调函数
        const callback = options.callback;
        const callbackConfirm = options.callbackConfirm || callback;
        const callbackCancel = options.callbackCancel;

        // 先标记为正在显示（在绑定事件之前，确保键盘事件能识别这个 modal）
        this.activeModals.add(modalId);
        this.currentModal = modalElement;
        
        // 绑定按钮事件（在 show 之前绑定，确保键盘事件能立即响应）
        this.bindModalEvents(modalElement, modal, callbackConfirm, callbackCancel, allowBackdropClose, modalId);

        // 立即显示 modal，键盘事件监听器已经就绪
        modal.show();
        
        // 确保模态框获得焦点（可选，因为键盘事件已经在 document 上监听）
        modalElement.addEventListener('shown.bs.modal', () => {
            this.adjustModalStack(modalElement, backdropCountBeforeShow);
            // 【防重复】清除创建标志，允许创建新的 modal
            this.creatingModal = false;
            
            // 对于 prompt 类型，焦点会在 bindModalEvents 中设置到输入框
            if (!modalElement.querySelector('input[type="text"]')) {
                modalElement.focus();
            }
        }, { once: true });
    }

    // 绑定模态框事件
    bindModalEvents(modalElement, modal, callbackConfirm, callbackCancel, allowBackdropClose, modalId) {
        const confirmBtn = modalElement.querySelector('#alerty-confirm-btn');
        const alertBtn = modalElement.querySelector('#alerty-ok-btn'); // alert 类型的确定按钮
        const closeBtn = modalElement.querySelector('.btn-close'); // 关闭按钮（叉叉）
        const cancelBtn = modalElement.querySelector('#alerty-cancel-btn');
        const promptInput = modalElement.querySelector('input[type="text"]'); // prompt 输入框

        // 标记模态框关闭的原因（用于决定执行哪个回调）
        let closeReason = null; // 'confirm', 'cancel', 'escape', 'backdrop'
        let isProcessing = false; // 防止重复处理
        let isModalReady = false; // 标记 modal 是否已完全显示并准备好接收输入
        
        // 执行确认操作的辅助函数（prompt 时可能为异步：校验失败则不关弹窗并显示 tip）
        const executeConfirm = () => {
            if (isProcessing) return false;
            isProcessing = true;
            closeReason = 'confirm';
            // prompt 类型：先执行回调做校验；返回 false 或 { keepOpen: true, tip?: string } 则不关弹窗并在 input 旁显示 tip
            if (promptInput && callbackConfirm && typeof callbackConfirm === 'function') {
                const inputValue = promptInput.value;
                const tipEl = modalElement.querySelector('.alerty-prompt-tip');
                const runPromptConfirm = async () => {
                    let result;
                    try {
                        result = await Promise.resolve(callbackConfirm(null, inputValue));
                    } catch (err) {
                        result = { keepOpen: true, tip: (err && err.message) || '验证失败' };
                    }
                    if (result === false || (result && result.keepOpen === true)) {
                        if (tipEl) {
                            tipEl.textContent = (result && result.tip) ? String(result.tip) : '';
                            tipEl.style.display = (result && result.tip) ? 'block' : 'none';
                        }
                        isProcessing = false;
                        return false;
                    }
                    modalElement.setAttribute('data-prompt-callback-done', 'true');
                    modal.hide();
                    return true;
                };
                runPromptConfirm();
                return true;
            }
            // 非 prompt 或无回调：沿用原逻辑
            if (promptInput) {
                modalElement.setAttribute('data-prompt-processed', 'true');
                modalElement.setAttribute('data-prompt-value', promptInput.value);
            }
            modal.hide();
            return true;
        };
        
        // 确认按钮事件
        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                executeConfirm();
            });
        }
        
        // Alert按钮事件（确定按钮）
        if (alertBtn && !confirmBtn) {
            alertBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                executeConfirm();
            });
        }
        
        // 关闭按钮事件（叉叉）
        // confirm 类型：关闭按钮等同于取消按钮
        // alert 类型：关闭按钮等同于确定按钮（都应该执行回调）
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isProcessing) return;
                isProcessing = true;
                // 如果存在取消按钮（confirm 类型），关闭按钮等同于取消
                // 如果不存在取消按钮（alert 类型），关闭按钮等同于确定
                closeReason = cancelBtn ? 'cancel' : 'confirm';
                modal.hide();
            });
        }
        
        // 执行取消操作的辅助函数
        const executeCancel = () => {
            if (isProcessing) return false;
            isProcessing = true;
            closeReason = 'cancel';
            modal.hide();
            return true;
        };
        
        // 取消按钮事件
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                executeCancel();
            });
        }

        // 键盘事件处理 - 在 document 上监听
        const handleKeydown = (e) => {
            // 【关键】只有在 modal 完全显示并准备好后才响应键盘事件
            if (!isModalReady) {
                return;
            }
            
            // 检查 modal 是否存在于 DOM 中
            if (!document.body.contains(modalElement)) {
                return;
            }
            
            // 检查是否是当前活动的 modal
            if (this.currentModal !== modalElement) {
                return;
            }
            
            // 检查 modal 是否正在显示
            if (!modalElement.classList.contains('show')) {
                return;
            }
            
            // 【关键】检查是否已经在处理中（防止重复处理）
            if (isProcessing) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
            
            if (e.key === 'Enter') {
                // 确定按钮（confirm、alert 或 prompt 类型）
                const okBtn = confirmBtn || alertBtn;
                if (okBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation(); // 阻止其他事件监听器
                    // 直接执行确认操作，不通过按钮点击事件
                    executeConfirm();
                }
            } else if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation(); // 阻止其他事件监听器
                // ESC 键等同于关闭按钮：confirm/prompt 类型等同于取消，alert 类型等同于确定
                if (cancelBtn) {
                    // confirm/prompt 类型：执行取消
                    executeCancel();
                } else {
                    // alert 类型：执行确认
                    executeConfirm();
                }
            }
        };
        
        // 立即添加键盘事件监听器（但只有在 isModalReady=true 后才会响应）
        document.addEventListener('keydown', handleKeydown, true);
        
        // 监听 modal 完全显示事件，设置准备就绪标志
        modalElement.addEventListener('shown.bs.modal', () => {
            isModalReady = true;
            if (promptInput) {
                promptInput.focus();
                promptInput.select();
            }
            if (window.csgSwitch) {
                modalElement.querySelectorAll('.csg-switch-input').forEach(function(el) {
                    if (el.dataset.csgInitialized !== 'true') {
                        window.csgSwitch.initSwitch(el);
                    }
                });
            }
        }, { once: true });
        
        // 监听 modal 开始隐藏事件（合并所有 hide 逻辑）
        modalElement.addEventListener('hide.bs.modal', (e) => {
            // 【关键】一旦开始隐藏，立即重置准备就绪标志（避免在关闭过程中响应键盘事件）
            isModalReady = false;
            
            // 处理点击空白区域关闭（如果允许）
            if (allowBackdropClose) {
                // 如果 closeReason 还没有被设置，说明是点击了 backdrop
                if (closeReason === null && !isProcessing) {
                    isProcessing = true;
                    closeReason = 'backdrop';
                }
            }
        }, { once: true });
        
        // 清理事件和回调执行
        const handleModalHidden = () => {
            // 【关键】确保所有状态都已重置
            isModalReady = false;
            // 【防重复】清除创建标志（双重保险）
            this.creatingModal = false;
            
            // 移除 document 上的键盘事件监听
            document.removeEventListener('keydown', handleKeydown, true);
            modalElement.removeEventListener('hidden.bs.modal', handleModalHidden);
            
            // 从活动 modal 列表中移除
            this.activeModals.delete(modalId);
            if (this.currentModal === modalElement) {
                this.currentModal = null;
            }
            
            // 处理 prompt：若已在确定时执行过回调（data-prompt-callback-done），仅移除节点不再调用
            const isPrompt = modalElement.querySelector('input[type="text"]') !== null;
            if (isPrompt && closeReason === 'confirm' && modalElement.getAttribute('data-prompt-callback-done') === 'true') {
                modalElement.remove();
                return;
            }
            if (isPrompt && closeReason === 'confirm' && modalElement.getAttribute('data-prompt-processed') === 'true') {
                const inputValue = modalElement.getAttribute('data-prompt-value') || '';
                modalElement.remove();
                if (callbackConfirm && typeof callbackConfirm === 'function') {
                    callbackConfirm(null, inputValue);
                }
                return;
            }
            
            var switchValues = this._collectSwitchValues(modalElement);
            modalElement.remove();
            if (closeReason === 'confirm' && callbackConfirm && typeof callbackConfirm === 'function') {
                callbackConfirm(switchValues);
            } else if ((closeReason === 'cancel' || closeReason === 'backdrop') && callbackCancel && typeof callbackCancel === 'function') {
                // 取消按钮、关闭按钮（confirm 类型）或点击空白区域，执行取消回调
                callbackCancel();
            }
            // 注意：alert 类型的关闭按钮会被设置为 'confirm'，会执行 callbackConfirm
        };
        
        modalElement.addEventListener('hidden.bs.modal', handleModalHidden);
    }

    // 让 alerty modal 在任意已有 modal 之上正确叠放
    adjustModalStack(modalElement, backdropCountBeforeShow) {
        if (!modalElement) return;
        const shownModals = Array.from(document.querySelectorAll('.modal.show'));
        const getZ = (el) => {
            const z = parseInt(window.getComputedStyle(el).zIndex, 10);
            return Number.isFinite(z) ? z : 0;
        };
        const topZ = shownModals
            .filter(el => el !== modalElement)
            .reduce((max, el) => Math.max(max, getZ(el)), 1055);
        const modalZ = topZ + 10;
        modalElement.style.zIndex = String(modalZ);

        const backdrops = Array.from(document.querySelectorAll('.modal-backdrop'));
        const newBackdrops = backdrops.slice(backdropCountBeforeShow);
        const targetBackdrop = newBackdrops[newBackdrops.length - 1];
        if (targetBackdrop) {
            targetBackdrop.classList.add('alerty-modal-backdrop');
            targetBackdrop.style.zIndex = String(modalZ - 1);
        }
    }

    // 创建通知元素（plainText 用于复制兜底）
    createNotification(options) {
        const notificationId = 'alerty-notification-' + Date.now();
        const typeClass = this.getTypeClass(options.type);
        const icon = this.getTypeIcon(options.type);
        const currentTime = this.getCurrentTimeString();
        const msg = options.message || '';
        const msgEn = options.message_en;
        const plainText = msgEn && msgEn !== msg ? msg + '\n' + msgEn : msg;

        const notificationHtml = `
            <div class="alert ${typeClass} alert-dismissible fade show alerty-notification" 
                 id="${notificationId}" 
                 style="margin-bottom: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); pointer-events: auto; position: relative;">
                <div class="d-flex align-items-start">
                    <div class="alerty-notification-icons d-flex flex-column align-items-center me-2">
                        <i class="${icon} mt-1"></i>
                        <button type="button" class="btn btn-link p-0 border-0 alerty-copy-btn" title="复制" aria-label="复制"><i class="bi bi-clipboard"></i></button>
                    </div>
                    <div class="flex-grow-1 min-w-0">
                        ${this.formatContent(options.message, options.message_en)}
                        <div class="alerty-timestamp">${currentTime}</div>
                    </div>
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            </div>
        `;

        return { id: notificationId, html: notificationHtml, plainText: plainText };
    }

    // 获取当前时间字符串
    getCurrentTimeString() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    // 获取类型样式类
    getTypeClass(type) {
        const typeMap = {
            'success': 'alert-success',
            'error': 'alert-danger',
            'warning': 'alert-warning',
            'info': 'alert-info',
            'notify': 'alert-info'
        };
        return typeMap[type] || 'alert-info';
    }

    // 获取类型图标
    getTypeIcon(type) {
        const iconMap = {
            'success': 'bi bi-check-circle-fill',
            'error': 'bi bi-exclamation-triangle-fill',
            'warning': 'bi bi-exclamation-triangle-fill',
            'info': 'bi bi-info-circle-fill',
            'notify': 'bi bi-bell-fill'
        };
        return iconMap[type] || 'bi bi-info-circle-fill';
    }

    // 显示通知
    showNotification(options) {
        if (!this.notificationContainer) {
            this.createNotificationContainer();
        }
        
        if (!this.notificationContainer) {
            setTimeout(() => {
                this.showNotification(options);
            }, 100);
            return;
        }
        
        const notification = this.createNotification(options);
        
        // 限制通知数量
        if (this.notificationCount >= this.maxNotifications) {
            const oldestNotification = this.notificationContainer.querySelector('.alerty-notification');
            if (oldestNotification) {
                oldestNotification.remove();
                this.notificationCount--;
            }
        }

        // 确保通知容器在视口内正确位置（在插入元素前检查）
        if (this.notificationContainer) {
            // 强制重新计算位置，确保容器在视口内
            const containerRect = this.notificationContainer.getBoundingClientRect();
            if (containerRect.top < 0) {
                this.notificationContainer.style.top = '20px';
            }
        }
        
        // 保存当前滚动位置，防止插入通知时页面滚动
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        this.notificationContainer.insertAdjacentHTML('beforeend', notification.html);
        this.notificationCount++;

        const notificationElement = document.getElementById(notification.id);
        if (notificationElement) {
            notificationElement.setAttribute('tabindex', '-1');
            notificationElement.style.outline = 'none';
            notificationElement.style.position = 'relative';
            if (notification.plainText != null) {
                notificationElement.setAttribute('data-alerty-text', notification.plainText);
            }
            const copyBtn = notificationElement.querySelector('.alerty-copy-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const text = notificationElement.getAttribute('data-alerty-text');
                    if (!text) return;
                    const iconEl = copyBtn.querySelector('i');
                    const done = () => {
                        if (iconEl) {
                            iconEl.className = 'bi bi-clipboard-check';
                            setTimeout(() => { iconEl.className = 'bi bi-clipboard'; }, 300);
                        }
                    };
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(done, () => {});
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        try {
                            document.execCommand('copy');
                            done();
                        } catch (err) {}
                        document.body.removeChild(ta);
                    }
                });
            }
        }

        requestAnimationFrame(() => {
            if (this.notificationContainer) {
                const containerRect = this.notificationContainer.getBoundingClientRect();
                if (containerRect.top < 0) this.notificationContainer.style.top = '20px';
            }
            window.scrollTo(scrollLeft, scrollTop);
            if (window.pageYOffset !== scrollTop || window.pageXOffset !== scrollLeft) {
                window.scrollTo(scrollLeft, scrollTop);
            }
        });

        this.setupAutoHide(notification.id, options.duration || 3000);
    }

    // 设置自动隐藏和鼠标悬停暂停功能
    setupAutoHide(notificationId, duration) {
        const notificationElement = document.getElementById(notificationId);
        if (!notificationElement) return;

        let hideTimer = null;
        let remainingTime = duration;
        let startTime = Date.now();
        let isSelecting = false;

        const doHide = () => {
            document.removeEventListener('mouseup', handleMouseUp);
            this.hideNotification(notificationId);
        };

        const startTimer = () => {
            startTime = Date.now();
            hideTimer = setTimeout(doHide, remainingTime);
        };

        const pauseTimer = () => {
            if (hideTimer) {
                clearTimeout(hideTimer);
                remainingTime -= (Date.now() - startTime);
                if (remainingTime <= 0) remainingTime = 0;
                hideTimer = null;
            }
        };

        const resumeTimer = () => {
            if (isSelecting) return;
            if (remainingTime > 0) startTimer();
            else doHide();
        };

        const handleMouseUp = () => {
            if (!isSelecting) return;
            isSelecting = false;
            if (!document.contains(notificationElement)) {
                document.removeEventListener('mouseup', handleMouseUp);
                return;
            }
            if (!notificationElement.matches(':hover')) resumeTimer();
        };

        notificationElement.addEventListener('mouseenter', pauseTimer);
        notificationElement.addEventListener('mouseleave', resumeTimer);
        notificationElement.addEventListener('mousedown', () => { isSelecting = true; }, { passive: true });
        document.addEventListener('mouseup', handleMouseUp);
        startTimer();
    }

    // 隐藏通知
    hideNotification(notificationId) {
        const notificationElement = document.getElementById(notificationId);
        if (notificationElement) {
            notificationElement.style.animation = 'slideOutRight 0.3s ease-in forwards';
            setTimeout(() => {
                notificationElement.remove();
                this.notificationCount--;
            }, 300);
        }
    }

    // 模态框方法
    modal(options) {
        const modalId = this.createModal({
            ...options,
            type: 'modal'
        });
        this.showModal(modalId, options);
    }

    confirm(message, callback, callbackCancel) {
        // 【防重复】检查是否可以创建新的 modal
        if (!this.canCreateModal()) {
            return; // 如果正在创建或创建太频繁，直接返回
        }
        
        // 支持多种调用方式：
        // confirm(message, callback)
        // confirm(message, callback, callbackCancel)
        // confirm(title, message, callback)
        // confirm({message, message_en, callback, callbackCancel, title, ...})
        let options;
        if (typeof message === 'string') {
            // 检查是否是三参数形式 (title, message, callback)
            if (typeof callback === 'string' && typeof callbackCancel === 'function') {
                // 三参数形式：confirm(title, message, callback)
                options = {
                    title: message,
                    message: callback,
                    callback: callbackCancel,
                    type: 'confirm'
                };
            } else {
                // 两参数形式：confirm(message, callback)
                options = {
                    message: message,
                    callback: callback,
                    callbackCancel: callbackCancel,
                    type: 'confirm'
                };
            }
        } else {
            // 对象形式
            options = { ...message, type: 'confirm' };
        }
        
        const modalId = this.createModal({
            ...options,
            type: 'confirm'
        });
        this.showModal(modalId, options);
    }

    alert(message, callback) {
        // 【防重复】检查是否可以创建新的 modal
        if (!this.canCreateModal()) {
            return; // 如果正在创建或创建太频繁，直接返回
        }
        
        const options = typeof message === 'string'
            ? { message: message, callback: callback }
            : { ...message, type: 'alert' };
        
        const modalId = this.createModal({
            ...options,
            type: 'alert'
        });
        this.showModal(modalId, options);
    }

    prompt(message, defaultValue, callbackConfirm, callbackCancel) {
        // 【防重复】检查是否可以创建新的 modal
        if (!this.canCreateModal()) {
            return; // 如果正在创建或创建太频繁，直接返回
        }
        
        // 支持多种调用方式：
        // prompt(message, defaultValue, callbackConfirm, callbackCancel)
        // prompt({message, defaultValue, callbackConfirm, callbackCancel})
        let options;
        if (typeof message === 'string') {
            options = {
                message: message,
                defaultValue: defaultValue,
                callbackConfirm: callbackConfirm,
                callbackCancel: callbackCancel,
                type: 'prompt'
            };
        } else {
            options = { ...message, type: 'prompt' };
        }
        
        const modalId = this.createModal(options);
        this.showModal(modalId, options);
    }

    // 处理通知参数（支持多种调用方式）
    parseNotificationArgs(args) {
        if (args.length === 0) {
            return { message: '', message_en: '' };
        }
        
        if (typeof args[0] === 'object' && args[0] !== null) {
            return args[0];
        }
        
        if (args.length === 1 && typeof args[0] === 'string') {
            return { message: args[0] };
        }
        
        if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
            return {
                message: args[0],
                message_en: args[1]
            };
        }
        
        return {
            message: args[0] || '',
            message_en: args[1] || ''
        };
    }

    // 通知方法
    success(...args) {
        const options = this.parseNotificationArgs(args);
        this.showNotification({ ...options, type: 'success' });
    }

    error(...args) {
        const options = this.parseNotificationArgs(args);
        this.showNotification({ ...options, type: 'error' });
    }

    warning(...args) {
        const options = this.parseNotificationArgs(args);
        this.showNotification({ ...options, type: 'warning' });
    }

    info(...args) {
        const options = this.parseNotificationArgs(args);
        this.showNotification({ ...options, type: 'info' });
    }

    notify(...args) {
        const options = this.parseNotificationArgs(args);
        this.showNotification({ ...options, type: 'notify' });
    }

    // message 接口，复用 notify 功能
    message(...args) {
        this.notify(...args);
    }
    
    // warn 接口，复用 warning 功能
    warn(...args) {
        this.warning(...args);
    }
    
    // 自定义对话框注册表
    dialogs = {};
    
    /**
     * 注册自定义对话框
     * @param {string} name - 对话框名称
     * @param {Function} factory - 工厂函数，返回对话框配置对象
     */
    dialog(name, factory) {
        if (!name || typeof factory !== 'function') {
            console.warn('Alerty.dialog: Invalid arguments');
            return;
        }
        
        const dialogConfig = factory();
        if (!dialogConfig) {
            console.warn(`Alerty.dialog: Factory for "${name}" returned nothing`);
            return;
        }
        
        // 存储对话框配置
        this.dialogs[name] = dialogConfig;
        
        // 创建便捷方法
        this[name] = (...args) => {
            return this.showCustomDialog(name, args);
        };
    }
    
    /**
     * 显示自定义对话框
     * @param {string} name - 对话框名称
     * @param {Array} args - 传递给 main 方法的参数
     */
    showCustomDialog(name, args = []) {
        const dialogConfig = this.dialogs[name];
        if (!dialogConfig) {
            console.error(`Alerty: Dialog "${name}" not found`);
            return null;
        }
        
        // 调用 main 方法初始化
        if (typeof dialogConfig.main === 'function') {
            dialogConfig.main.apply(dialogConfig, args);
        }
        
        // 调用 setup 方法获取配置
        const setupResult = typeof dialogConfig.setup === 'function' 
            ? dialogConfig.setup.call(dialogConfig) 
            : {};
        
        const buttons = setupResult.buttons || [];
        const focus = setupResult.focus || {};
        const options = setupResult.options || {};
        
        // 创建模态框
        const modalId = this.createModal({
            title: options.title || name,
            message: '', // 自定义对话框的内容由 prepare 方法设置
            width: options.width || (options.startMaximized ? '90vw' : undefined),
            height: options.height || (options.startMaximized ? '90vh' : undefined),
            allowBackdropClose: options.allowBackdropClose !== false,
            type: 'modal'
        });
        
        const modalElement = document.getElementById(modalId);
        if (!modalElement) return null;
        
        // 创建对话框实例（包含 setContent 方法）
        const dialogInstance = {
            setContent: (content) => {
                const modalBody = modalElement.querySelector('.modal-body');
                if (modalBody) {
                    if (typeof content === 'string') {
                        modalBody.innerHTML = content;
                    } else if (content instanceof HTMLElement) {
                        modalBody.innerHTML = '';
                        modalBody.appendChild(content);
                    } else if (content instanceof NodeList || Array.isArray(content)) {
                        modalBody.innerHTML = '';
                        content.forEach(node => modalBody.appendChild(node));
                    }
                }
            },
            show: () => modal.show(),
            hide: () => modal.hide(),
            close: () => modal.hide(),
            destroy: () => {
                modal.hide();
                setTimeout(() => modalElement.remove(), 300);
            }
        };
        
        // 调用 prepare 方法准备内容（将 dialogInstance 绑定到 this）
        if (typeof dialogConfig.prepare === 'function') {
            const modalBody = modalElement.querySelector('.modal-body');
            if (modalBody) {
                // 清空默认内容
                modalBody.innerHTML = '';
                // 将 setContent 方法绑定到 dialogConfig，以便 prepare 中可以调用
                dialogConfig.setContent = dialogInstance.setContent;
                // 调用 prepare 方法
                dialogConfig.prepare.call(dialogConfig);
            }
        }
        
        // 处理按钮
        const modalFooter = modalElement.querySelector('.modal-footer');
        if (modalFooter && buttons.length > 0) {
            modalFooter.innerHTML = '';
            buttons.forEach((btn, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-secondary';
                button.textContent = btn.text || 'OK';
                if (btn.key === 27) { // ESC
                    button.setAttribute('data-bs-dismiss', 'modal');
                }
                if (typeof btn.onclick === 'function') {
                    button.addEventListener('click', btn.onclick);
                }
                modalFooter.appendChild(button);
            });
        }
        
        // 显示模态框
        const modal = new bootstrap.Modal(modalElement, {
            backdrop: options.allowBackdropClose !== false ? true : 'static',
            keyboard: true
        });
        modal.show();
        
        // 处理焦点
        if (focus.element !== undefined) {
            modalElement.addEventListener('shown.bs.modal', () => {
                const focusableElements = modalElement.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                if (focusableElements[focus.element]) {
                    focusableElements[focus.element].focus();
                }
            }, { once: true });
        }
        
        // 返回对话框实例
        return dialogInstance;
    }
}

// 创建全局实例
const alerty = new Alerty();

// 添加 CSS 样式（避免重复添加）
if (!document.getElementById('alerty-styles')) {
    const style = document.createElement('style');
    style.id = 'alerty-styles';
    style.textContent = `
        /* 弹窗正文：长路径/URL 自动换行，不限制高度以保持通用性（各业务可自传 size 控制弹窗宽窄） */
        .modal .modal-body {
            word-break: break-word;
            overflow-wrap: break-word;
        }
        
        .alerty-bilingual {
            line-height: 1.5;
            word-break: break-word;
            overflow-wrap: break-word;
        }
        
        .alerty-primary {
            font-weight: 500;
            margin-bottom: 0.5rem;
        }
        
        .alerty-secondary {
            font-size: 0.9em;
            opacity: 0.85;
            font-style: italic;
            margin-top: 0.25rem;
            padding-top: 0.5rem;
            border-top: 1px solid rgba(0,0,0,0.08);
        }

        /* confirm 内 switches：纵向双语（csg-bilingual-stack），英文可读性不弱于 modal 正文区英文 */
        .alerty-switches .csg-bilingual-stack > .en-text {
            font-size: 0.875rem;
            line-height: 1.4;
            opacity: 0.88;
        }
        
        .alerty-timestamp {
            font-size: 0.65em;
            opacity: 0.5;
            margin-top: 3px;
            font-family: monospace;
        }
        
        /* 确保通知容器始终相对于视口定位，且位置固定 */
        #alerty-notifications {
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            left: auto !important;
            bottom: auto !important;
            transform: none !important;
            /* 确保容器不会影响内部元素的定位 */
            will-change: auto;
            /* 确保容器始终在视口内 */
            max-height: calc(100vh - 40px);
            overflow-y: auto;
            overflow-x: hidden;
        }
        
        .alerty-notification {
            animation: slideInRight 0.3s ease-out forwards;
            position: relative !important;
            transform: translateX(100%);
            opacity: 0;
            will-change: transform, opacity;
            -webkit-user-select: text;
            -moz-user-select: text;
            user-select: text;
            cursor: default;
        }
        .alerty-notification .flex-grow-1 {
            cursor: text;
        }
        .alerty-notification .alerty-notification-icons {
            flex-shrink: 0;
        }
        .alerty-notification .alerty-copy-btn {
            color: inherit;
            opacity: 0.65;
            font-size: 0.85rem;
            line-height: 1;
            min-width: auto;
            padding: 0.15rem 0;
        }
        .alerty-notification .alerty-copy-btn:hover {
            opacity: 1;
        }
        .alerty-notification .btn-close {
            cursor: pointer;
            -webkit-user-select: none;
            -moz-user-select: none;
            user-select: none;
        }
        
        /* 动画完成后，确保元素位置正确 */
        .alerty-notification.alert.show {
            transform: translateX(0) !important;
            opacity: 1 !important;
            will-change: auto;
        }
        
        /* 仅约束 alerty 自己的 modal，避免影响业务 modal */
        .alerty-modal {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            z-index: 1055;
        }
        
        .modal-backdrop.alerty-modal-backdrop {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            z-index: 1054;
        }
        
        /* 加速 Bootstrap modal 动画 - 使用极快的动画时间实现即时响应 */
        .modal.fade {
            transition: opacity 0.05s linear !important;
        }
        
        .modal.fade .modal-dialog {
            transition: transform 0.05s ease-out !important;
        }
        
        .modal.show .modal-dialog {
            transform: none !important;
        }
        
        .modal-backdrop.fade {
            transition: opacity 0.05s linear !important;
        }
        
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        /* 确保动画过程中和完成后，元素都在正确位置 */
        .alerty-notification {
            will-change: transform, opacity;
        }
        
        /* 动画完成后移除 will-change，优化性能 */
        .alerty-notification.alert.show {
            will-change: auto;
        }
        
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

// 导出到全局
window.alerty = alerty;

} // 结束重复声明检查