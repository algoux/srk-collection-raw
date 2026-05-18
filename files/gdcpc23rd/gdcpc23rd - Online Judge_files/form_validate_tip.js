/**
 * Bootstrap 5 原生表单验证工具
 * 纯原生实现，不依赖任何其他框架
 */

// 使用 IIFE 避免全局污染和重复声明
(function() {
    'use strict';
    
    // 防止重复引入（模块定义时的检查，保留）
    if (typeof window.FormValidationTip !== 'undefined') {
        // console.warn('form_validate_tip.js already loaded');
        return;
    }

/**
 * 验证规则定义
 */
const FormValidationRules = {
    required: (value) => value.trim() !== '',
    maxlength: (value, max) => value.length <= max,
    minlength: (value, min) => value.length >= min,
    email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    number: (value) => !isNaN(value) && !isNaN(parseFloat(value)),
    digits: (value) => /^\d+$/.test(value),
    url: (value) => {
        try {
            new URL(value);
            return true;
        } catch {
            return false;
        }
    },
    pattern: (value, regex) => regex.test(value),
    range: (value, min, max) => {
        const num = parseFloat(value);
        return num >= min && num <= max;
    }
};

/**
 * 创建双语验证消息
 * @param {string} chineseMsg - 中文消息
 * @param {string} englishMsg - 英文消息
 * @returns {string} HTML格式的双语消息
 */
function createBilingualMessage(chineseMsg, englishMsg) {
    return `${chineseMsg}<span class="en-text"> ${englishMsg}</span>`;
}

/**
 * 生成默认的双语验证消息
 * @param {string} rule - 验证规则名称
 * @param {Array} params - 规则参数
 * @param {string} fieldName - 字段名称（可选）
 * @returns {string} HTML格式的双语消息
 */
function generateDefaultMessage(rule, params = [], fieldName = '') {
    const fieldLabel = fieldName || '此字段';
    
    const defaultMessages = {
        required: {
            zh: `${fieldLabel}不能为空`,
            en: `Required`
        },
        minlength: {
            zh: `${fieldLabel}不能少于${params[0]}个字符`,
            en: `Must be at least ${params[0]} characters`
        },
        maxlength: {
            zh: `${fieldLabel}不能超过${params[0]}个字符`,
            en: `Cannot exceed ${params[0]} characters`
        },
        min: {
            zh: `${fieldLabel}不能小于${params[0]}`,
            en: `Must be ≥ ${params[0]}`
        },
        max: {
            zh: `${fieldLabel}不能大于${params[0]}`,
            en: `Must be ≤ ${params[0]}`
        },
        range: {
            zh: `${fieldLabel}必须在${params[0]}到${params[1]}之间`,
            en: `Must be between ${params[0]} and ${params[1]}`
        },
        email: {
            zh: `请输入有效的邮箱地址`,
            en: `Invalid email`
        },
        number: {
            zh: `请输入有效的数字`,
            en: `Invalid number`
        },
        digits: {
            zh: `请输入数字`,
            en: `Digits only`
        },
        url: {
            zh: `请输入有效的网址`,
            en: `Invalid URL`
        },
        pattern: {
            zh: `${fieldLabel}格式不正确`,
            en: `Invalid format`
        }
    };
    
    const message = defaultMessages[rule];
    if (message) {
        return createBilingualMessage(message.zh, message.en);
    }
    
    // 如果没有找到默认消息，返回通用消息
    return createBilingualMessage(`${fieldLabel}验证失败`, `${fieldLabelEn} validation failed`);
}

/**
 * 验证规则模板
 */
const ValidationTemplates = {
    required: (chineseLabel, englishLabel) => ({
        rule: 'required',
        message: createBilingualMessage(
            `${chineseLabel}不能为空`,
            `${englishLabel} is required`
        )
    }),
    maxLength: (maxLength, chineseLabel, englishLabel) => ({
        rule: 'maxlength',
        params: [maxLength],
        message: createBilingualMessage(
            `${chineseLabel}不能超过${maxLength}个字符`,
            `${englishLabel} cannot exceed ${maxLength} characters`
        )
    }),
    minLength: (minLength, chineseLabel, englishLabel) => ({
        rule: 'minlength',
        params: [minLength],
        message: createBilingualMessage(
            `${chineseLabel}不能少于${minLength}个字符`,
            `${englishLabel} must be at least ${minLength} characters`
        )
    }),
    email: (chineseLabel, englishLabel) => ({
        rule: 'email',
        message: createBilingualMessage(
            `请输入有效的${chineseLabel}`,
            `Please enter a valid ${englishLabel}`
        )
    }),
    number: (chineseLabel, englishLabel) => ({
        rule: 'number',
        message: createBilingualMessage(
            `请输入有效的${chineseLabel}`,
            `Please enter a valid ${englishLabel}`
        )
    }),
    digits: (chineseLabel, englishLabel) => ({
        rule: 'digits',
        message: createBilingualMessage(
            `请输入数字`,
            `Please enter digits only`
        )
    }),
    url: (chineseLabel, englishLabel) => ({
        rule: 'url',
        message: createBilingualMessage(
            `请输入有效的${chineseLabel}`,
            `Please enter a valid ${englishLabel}`
        )
    }),
    range: (min, max, chineseLabel, englishLabel) => ({
        rule: 'range',
        params: [min, max],
        message: createBilingualMessage(
            `${chineseLabel}必须在${min}到${max}之间`,
            `${englishLabel} must be between ${min} and ${max}`
        )
    }),
    pattern: (regex, chineseLabel, englishLabel) => ({
        rule: 'pattern',
        params: [regex],
        message: createBilingualMessage(
            `${chineseLabel}格式不正确`,
            `Invalid ${englishLabel} format`
        )
    })
};

/**
 * 验证单个字段
 * @param {HTMLElement} element - 表单元素
 * @param {Array} rules - 验证规则数组
 * @returns {Object} 验证结果 {valid: boolean, message: string}
 */
function validateField(element, rules) {
    // 跳过隐藏和禁用的字段
    if (element.disabled || element.hidden || element.style.display === 'none' || element.style.visibility === 'hidden') {
        return { valid: true, message: '' };
    }
    
    const value = element.value || '';
    
    for (const ruleConfig of rules) {
        const { rule, params = [], message } = ruleConfig;
        
        // 支持自定义验证函数
        if (rule === 'custom' && typeof params[0] === 'function') {
            const customValidator = params[0];
            const isValid = customValidator(value, element);
            if (!isValid) {
                return { valid: false, message };
            }
            continue;
        }
        
        if (FormValidationRules[rule]) {
            // 对于非必填字段，如果值为空则跳过验证
            if (rule !== 'required' && value.trim() === '') {
                continue;
            }
            
            const isValid = FormValidationRules[rule](value, ...params);
            if (!isValid) {
                return { valid: false, message };
            }
        }
    }
    
    return { valid: true, message: '' };
}

/**
 * 获取字段错误气泡的 placement：密码类字段用 bottom 避免遮挡上方输入框
 */
function getFieldErrorTooltipPlacement(element) {
    const name = (element.name || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    const type = (element.type || '').toLowerCase();
    if (type === 'password' || name.indexOf('password') !== -1 || id.indexOf('password') !== -1) {
        return 'bottom';
    }
    return 'top';
}

/**
 * 元素是否适合作为 Bootstrap Tooltip 锚点（可见、有布局）
 */
function elementIsTooltipAnchorable(el) {
    if (!el || !(el instanceof HTMLElement)) {
        return false;
    }
    if (el.closest('.visually-hidden')) {
        return false;
    }
    let n = el;
    while (n && n.nodeType === 1) {
        const st = window.getComputedStyle(n);
        if (st.display === 'none' || st.visibility === 'hidden') {
            return false;
        }
        n = n.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
}

/**
 * 解析错误气泡挂载节点：隐藏域/屏外域用 data-validation-tooltip-anchor 或 label[for]
 */
function resolveTooltipHost(element) {
    if (!element) {
        return element;
    }
    if (elementIsTooltipAnchorable(element)) {
        return element;
    }
    const sel = element.getAttribute('data-validation-tooltip-anchor');
    if (sel) {
        try {
            const alt = document.querySelector(sel);
            if (alt && elementIsTooltipAnchorable(alt)) {
                return alt;
            }
        } catch (e) {
            /* ignore invalid selector */
        }
    }
    if (element.id) {
        let esc = element.id;
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            esc = CSS.escape(element.id);
        }
        const lab = document.querySelector('label[for="' + esc + '"]');
        if (lab && elementIsTooltipAnchorable(lab)) {
            return lab;
        }
    }
    return element;
}

/**
 * 安全销毁 Bootstrap 5 Tooltip 实例。dispose/hide 在内部状态不完整时可能抛错（如 _isWithActiveTrigger 里对 undefined 做 Object.values）。
 * @param {HTMLElement|null|undefined} el
 */
function disposeBootstrapTooltipSafe(el) {
    if (!el || typeof bootstrap === 'undefined' || !bootstrap.Tooltip) {
        return;
    }
    try {
        const inst = bootstrap.Tooltip.getInstance(el);
        if (!inst) {
            return;
        }
        try {
            if (typeof inst.hide === 'function') {
                inst.hide();
            }
        } catch (e1) {
            /* ignore */
        }
        try {
            inst.dispose();
        } catch (e2) {
            /* ignore */
        }
    } catch (e) {
        /* ignore */
    }
}

/**
 * 显示字段错误（Bootstrap Tooltip 气泡，与登录/考试认证 UI 统一）
 * @param {HTMLElement} element - 表单元素
 * @param {string} message - 错误消息（可含 HTML，如双语）
 */
function showFieldError(element, message) {
    element.classList.remove('is-valid');
    element.classList.add('is-invalid');
    if (typeof bootstrap === 'undefined' || !bootstrap.Tooltip) {
        return;
    }
    const tooltipHost = resolveTooltipHost(element);
    element._formValidationTooltipHost = tooltipHost;
    disposeBootstrapTooltipSafe(tooltipHost);
    if (tooltipHost !== element) {
        disposeBootstrapTooltipSafe(element);
    }
    const placement = getFieldErrorTooltipPlacement(tooltipHost);
    try {
        const tooltip = new bootstrap.Tooltip(tooltipHost, {
            title: message,
            placement: placement,
            trigger: 'manual',
            html: true,
            customClass: 'login-tooltip-error'
        });
        tooltip.show();
    } catch (eShow) {
        /* 锚点被替换或 Bootstrap 内部异常时避免整表校验崩溃 */
    }
}

/**
 * 清除字段错误
 * @param {HTMLElement} element - 表单元素
 */
function clearFieldError(element) {
    element.classList.remove('is-invalid');
    element.classList.add('is-valid');
    const errorId = `error-${element.name || element.id || 'field'}`;
    const errorContainer = document.getElementById(errorId);
    if (errorContainer) {
        errorContainer.style.display = 'none';
        errorContainer.innerHTML = '';
    }
    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
        const host = element._formValidationTooltipHost || element;
        delete element._formValidationTooltipHost;
        disposeBootstrapTooltipSafe(host);
        if (host !== element) {
            disposeBootstrapTooltipSafe(element);
        }
    }
}

/**
 * 初始化表单验证
 * @param {string} formSelector - 表单选择器
 * @param {Object} fieldConfigs - 字段配置对象
 * @param {Function} submitHandler - 提交处理函数
 * @param {Object} options - 额外选项
 * @param {Function} options.showFieldError - 自定义显示字段错误函数 (element, message) => void
 * @param {Function} options.clearFieldError - 自定义清除字段错误函数 (element) => void
 * @param {Function} options.showFormAlert - 自定义显示表单级错误提示函数 (message) => void
 * @param {string} options.tooltipPlacement - Tooltip 位置（传入自定义 showFieldError 时可用；默认实现为密码类字段用 bottom、其余用 top）
 * @param {boolean} options.scrollToFirstError - 校验不通过时是否滚动到第一个错误位置（默认 false）
 * @param {Function} options.preValidate - 整表校验前调用 (form) => void（如同步隐藏域、占位填充，避免隐藏控件 Tooltip 错位）
 */
function initFormValidation(formSelector, fieldConfigs = {}, submitHandler = null, options = {}) {
    const form = document.querySelector(formSelector);
    if (!form) {
        console.warn('Form not found:', formSelector);
        return;
    }

    // 从 options 中获取自定义函数，如果没有提供则使用默认的全局函数
    const customShowFieldError = options.showFieldError && typeof options.showFieldError === 'function' 
        ? options.showFieldError 
        : showFieldError;
    const customClearFieldError = options.clearFieldError && typeof options.clearFieldError === 'function' 
        ? options.clearFieldError 
        : clearFieldError;
    const customShowFormAlert = options.showFormAlert && typeof options.showFormAlert === 'function' 
        ? options.showFormAlert 
        : null;

    const config = {
        tooltipPlacement: options.tooltipPlacement || 'bottom',
        ...options
    };

    // 存储字段验证规则
    const fieldRules = new Map();
    
    // 初始化字段规则
    Object.keys(fieldConfigs).forEach(fieldName => {
        const fieldConfig = fieldConfigs[fieldName];
        const rules = [];
        
        // 处理规则配置
        if (fieldConfig.rules) {
            Object.keys(fieldConfig.rules).forEach(ruleName => {
                const ruleValue = fieldConfig.rules[ruleName];
                const params = Array.isArray(ruleValue) ? ruleValue : [ruleValue];
                
                // 优先使用自定义消息，否则生成默认消息
                let message;
                if (fieldConfig.messages && fieldConfig.messages[ruleName]) {
                    message = fieldConfig.messages[ruleName];
                } else {
                    // 尝试从字段的placeholder或name获取字段标签
                    const element = form.querySelector(`[name="${fieldName}"]`);
                    let fieldLabel = '';
                    if (element) {
                        const placeholder = element.getAttribute('placeholder');
                        if (placeholder) {
                            // 从placeholder中提取中文标签（假设中文在前）
                            const match = placeholder.match(/^([^<]+)/);
                            if (match) {
                                fieldLabel = match[1].trim();
                            }
                        }
                    }
                    message = generateDefaultMessage(ruleName, params, fieldLabel);
                }
                
                rules.push({
                    rule: ruleName,
                    params: params,
                    message: message
                });
            });
        }
        
        fieldRules.set(fieldName, rules);
    });

    // 为每个字段添加事件监听器
    Object.keys(fieldConfigs).forEach(fieldName => {
        const element = form.querySelector(`[name="${fieldName}"]`);
        if (!element) return;

        // 实时验证
        element.addEventListener('blur', () => {
            const rules = fieldRules.get(fieldName) || [];
            const result = validateField(element, rules);
            
            if (result.valid) {
                customClearFieldError(element);
            } else {
                customShowFieldError(element, result.message);
            }
        });

        // 输入时清除错误状态
        element.addEventListener('input', () => {
            if (element.classList.contains('is-invalid')) {
                customClearFieldError(element);
            }
        });
    });

    // 表单提交验证
    // 先移除可能存在的旧事件监听器，避免重复绑定
    const submitHandlerWrapper = (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (typeof options.preValidate === 'function') {
            try {
                options.preValidate(form);
            } catch (err) {
                console.error('FormValidationTip preValidate:', err);
            }
        }

        let isFormValid = true;
        let firstInvalidField = null;

        // 验证所有字段
        Object.keys(fieldConfigs).forEach(fieldName => {
            const element = form.querySelector(`[name="${fieldName}"]`);
            if (!element) return;

            const rules = fieldRules.get(fieldName) || [];
            const result = validateField(element, rules);
            
            if (!result.valid) {
                isFormValid = false;
                customShowFieldError(element, result.message);
                
                // 聚焦到第一个无效字段
                if (!firstInvalidField) {
                    firstInvalidField = element;
                }
            } else {
                customClearFieldError(element);
            }
        });

        // 如果表单有效且提供了提交处理函数，则执行
        if (isFormValid && submitHandler && typeof submitHandler === 'function') {
            submitHandler(form);
        } else if (!isFormValid && firstInvalidField) {
            const focusTarget = firstInvalidField._formValidationTooltipHost || resolveTooltipHost(firstInvalidField);
            if (focusTarget && typeof focusTarget.focus === 'function') {
                try {
                    focusTarget.focus({ preventScroll: !options.scrollToFirstError });
                } catch (err) {
                    try {
                        firstInvalidField.focus();
                    } catch (e2) { /* ignore */ }
                }
            } else {
                try {
                    firstInvalidField.focus();
                } catch (e3) { /* ignore */ }
            }
            if (options.scrollToFirstError && focusTarget && typeof focusTarget.scrollIntoView === 'function') {
                focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (customShowFormAlert) {
                // 如果提供了自定义表单级错误提示函数，可以显示统一错误提示
            }
        }
        
        // 确保阻止默认行为
        return false;
    };
    
    // 移除旧的事件监听器（如果存在）
    const oldHandler = form._formValidationSubmitHandler;
    if (oldHandler) {
        form.removeEventListener('submit', oldHandler);
    }
    
    // 保存新的事件处理器引用，以便后续清理
    form._formValidationSubmitHandler = submitHandlerWrapper;
    // 使用 capture 阶段确保在其他监听器之前执行，并确保阻止默认行为
    form.addEventListener('submit', submitHandlerWrapper, { capture: true, passive: false });

    return form;
}

/**
 * 快速初始化常用表单验证
 * @param {string} formSelector - 表单选择器
 * @param {Object} fieldConfigs - 字段配置对象
 * @param {Function} submitHandler - 提交处理函数
 * @param {Object} options - 额外选项
 */
function initCommonFormValidation(formSelector, fieldConfigs = {}, submitHandler = null, options = {}) {
    return initFormValidation(formSelector, fieldConfigs, submitHandler, options);
}

/**
 * 手动验证表单
 * @param {string} formSelector - 表单选择器
 * @param {Object} options - 可选配置
 * @param {boolean} options.scrollToFirstError - 校验不通过时是否滚动到第一个错误位置（默认 false）
 * @returns {boolean} 表单是否有效
 */
function validateForm(formSelector, options = {}) {
    const form = document.querySelector(formSelector);
    if (!form) return false;

    let isFormValid = true;
    const invalidFields = [];

    // 查找所有有验证规则的字段
    const inputs = form.querySelectorAll('input, textarea, select');
    
    inputs.forEach(input => {
        const fieldName = input.name;
        if (!fieldName) return;

        // 这里需要从全局配置中获取规则，简化处理
        const rules = window.formValidationRules && window.formValidationRules.get(fieldName);
        if (!rules) return;

        const result = validateField(input, rules);
        
        if (!result.valid) {
            isFormValid = false;
            invalidFields.push(input);
            showFieldError(input, result.message);
        } else {
            clearFieldError(input);
        }
    });

    // 聚焦到第一个无效字段，可选滚动到该位置
    if (invalidFields.length > 0) {
        const first = invalidFields[0];
        first.focus();
        if (options.scrollToFirstError) {
            first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    return isFormValid;
}

/**
 * 清除表单验证状态
 * @param {string} formSelector - 表单选择器
 */
function clearFormValidation(formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) return;

    const inputs = form.querySelectorAll('input, textarea, select');
    
    inputs.forEach(input => {
        clearFieldError(input);
    });
}


    /**
     * 序列化表单数据为 FormData 或 URLSearchParams
     * @param {HTMLFormElement} form - 表单元素
     * @param {boolean} useFormData - 是否使用 FormData（用于文件上传）
     * @returns {FormData|URLSearchParams} 序列化后的数据
     */
    function serializeForm(form, useFormData = false) {
        if (useFormData) {
            // 使用 FormData 构造函数直接序列化表单（浏览器原生支持）
            return new FormData(form);
        }
        
        // 使用 URLSearchParams 序列化（不支持文件）
        const formData = new URLSearchParams();
        const inputs = form.querySelectorAll('input, select, textarea');
        
        inputs.forEach(input => {
            // 跳过禁用的字段
            if (input.disabled) return;
            
            const name = input.name;
            if (!name) return;
            
            // 处理 checkbox 和 radio
            if (input.type === 'checkbox' || input.type === 'radio') {
                if (!input.checked) return;
                formData.append(name, input.value || '');
                return;
            }
            
            // 跳过文件输入（URLSearchParams 不支持文件）
            if (input.type === 'file') {
                return;
            }
            
            // 处理多选 select
            if (input.tagName === 'SELECT' && input.multiple) {
                const selectedOptions = Array.from(input.selectedOptions);
                selectedOptions.forEach(option => {
                    formData.append(name, option.value || '');
                });
                return;
            }
            
            // 普通输入
            formData.append(name, input.value || '');
        });
        
        return formData;
    }

    /**
     * 重置表单
     * @param {HTMLFormElement} form - 表单元素
     */
    function resetForm(form) {
        if (form && typeof form.reset === 'function') {
            form.reset();
        }
    }

    /**
     * 清空表单字段
     * @param {HTMLFormElement} form - 表单元素
     * @param {boolean} includeHidden - 是否包含隐藏字段
     */
    function clearForm(form, includeHidden = false) {
        if (!form) return;
        
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            // 跳过隐藏字段（如果 includeHidden 为 false）
            if (!includeHidden && input.type === 'hidden') return;
            
            // 跳过禁用的字段
            if (input.disabled) return;
            
            // 根据类型清空
            if (input.type === 'checkbox' || input.type === 'radio') {
                input.checked = false;
            } else if (input.tagName === 'SELECT') {
                input.selectedIndex = 0;
            } else {
                input.value = '';
            }
        });
    }

    /**
     * ajaxSubmit - 立即提交表单（jQuery Form 兼容方法）
     * 支持文件上传和所有 jquery form 选项
     * @param {HTMLFormElement|jQuery} formOrOptions - 表单元素或选项对象
     * @param {Object|Function} optionsOrSuccess - 选项对象或成功回调函数
     * @param {string} dataType - 数据类型（已废弃，使用 options.dataType）
     * @param {Function} onSuccess - 成功回调（已废弃，使用 options.success）
     * @returns {jQuery|void} jQuery 链式调用或 void
     */
    function ajaxSubmit(formOrOptions, optionsOrSuccess, dataType, onSuccess) {
        // 处理 jQuery 调用：$(form).ajaxSubmit(options) 或 $(form).ajaxSubmit(success)
        let form, options;
        
        if (formOrOptions instanceof HTMLFormElement || (formOrOptions && formOrOptions.tagName === 'FORM')) {
            form = formOrOptions;
            // 如果第二个参数是函数，则作为 success 回调
            if (typeof optionsOrSuccess === 'function') {
                options = { success: optionsOrSuccess };
            } else {
                options = optionsOrSuccess || {};
            }
        } else if (formOrOptions && typeof formOrOptions === 'object' && formOrOptions.nodeName !== 'FORM') {
            // 可能是 jQuery 对象或选项对象
            if (formOrOptions.jquery || formOrOptions.length) {
                // jQuery 对象
                form = formOrOptions[0] || formOrOptions.get(0);
                if (typeof optionsOrSuccess === 'function') {
                    options = { success: optionsOrSuccess };
                } else {
                    options = optionsOrSuccess || {};
                }
            } else {
                // 选项对象（不常见）
                console.warn('ajaxSubmit: Invalid form element');
                return formOrOptions; // 返回原对象以支持链式调用
            }
        } else {
            console.warn('ajaxSubmit: Form element required');
            return formOrOptions; // 返回原对象以支持链式调用
        }
        
        if (!form || form.tagName !== 'FORM') {
            console.warn('ajaxSubmit: Invalid form element');
            return formOrOptions; // 返回原对象以支持链式调用
        }
        
        // 合并默认选项
        const defaultOptions = {
            url: form.action || window.location.href,
            type: (form.method || 'POST').toUpperCase(),
            dataType: 'json',
            contentType: 'form', // 默认使用表单格式
            resetForm: false,
            clearForm: false,
            includeHidden: false,
            beforeSubmit: null,
            success: null,
            error: null,
            complete: null,
            uploadProgress: null,
            target: null,
            replaceTarget: false
        };
        
        options = Object.assign({}, defaultOptions, options);
        
        // 检查是否有文件输入
        const hasFileInput = form.querySelector('input[type="file"]');
        const useFormData = hasFileInput || options.contentType === 'formdata';
        
        // 序列化表单数据
        let formData;
        if (useFormData) {
            formData = serializeForm(form, true);
        } else {
            formData = serializeForm(form, false);
        }
        
        // beforeSubmit 回调
        if (options.beforeSubmit && typeof options.beforeSubmit === 'function') {
            const formArray = Array.from(form.querySelectorAll('input, select, textarea'))
                .filter(input => {
                    if (input.disabled) return false;
                    if (input.type === 'checkbox' || input.type === 'radio') {
                        return input.checked;
                    }
                    return true;
                })
                .map(input => ({
                    name: input.name,
                    value: input.value
                }));
            
            const result = options.beforeSubmit(formArray, form, options);
            if (result === false) {
                return formOrOptions; // 取消提交
            }
        }
        
        // beforeSend 回调（兼容性）
        if (options.beforeSend && typeof options.beforeSend === 'function') {
            options.beforeSend();
        }
        
        // 准备请求参数
        const requestOptions = {
            method: options.type,
            url: options.url,
            data: formData,
            contentType: useFormData ? 'formdata' : 'form',
            dtype: options.dataType || 'json',
            headers: options.headers || {}
        };
        
        // 处理文件上传进度（如果支持）
        const xhr = new XMLHttpRequest();
        let progressSupported = false;
        
        if (useFormData && options.uploadProgress && xhr.upload) {
            progressSupported = true;
            // 注意：这里我们需要使用 XMLHttpRequest 而不是 fetch 来支持进度
            // 但为了保持一致性，我们先尝试使用 fetch，如果不支持进度则回退到 XHR
        }
        
        // 使用 fetch（不支持进度）或 XMLHttpRequest（支持进度）
        if (useFormData && options.uploadProgress && typeof XMLHttpRequest !== 'undefined') {
            // 使用 XMLHttpRequest 支持上传进度
            xhr.open(requestOptions.method, requestOptions.url);
            
            // 设置请求头（FormData 会自动设置 Content-Type，不要手动设置）
            Object.keys(requestOptions.headers).forEach(key => {
                // 不要设置 Content-Type，让浏览器自动设置（包含 boundary）
                if (key.toLowerCase() !== 'content-type') {
                    xhr.setRequestHeader(key, requestOptions.headers[key]);
                }
            });
            
            // 上传进度事件
            if (xhr.upload && options.uploadProgress) {
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = Math.round((e.loaded * 100) / e.total);
                        options.uploadProgress(e, e.loaded, e.total, percentComplete);
                    }
                });
            }
            
            // 完成事件
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    let responseData;
                    try {
                        if (options.dataType === 'json') {
                            responseData = JSON.parse(xhr.responseText);
                        } else if (options.dataType === 'text') {
                            responseData = xhr.responseText;
                        } else {
                            responseData = xhr.responseText;
                        }
                    } catch (e) {
                        responseData = xhr.responseText;
                    }
                    
                    // 处理 target 选项
                    if (options.target) {
                        const targetElement = typeof options.target === 'string' 
                            ? document.querySelector(options.target)
                            : options.target;
                        if (targetElement) {
                            if (options.replaceTarget) {
                                targetElement.replaceWith(...targetElement.ownerDocument.createRange().createContextualFragment(xhr.responseText));
                            } else {
                                targetElement.innerHTML = xhr.responseText;
                            }
                        }
                    }
                    
                    // success 回调
                    if (options.success) {
                        if (options.target && !options.dataType) {
                            // 如果设置了 target 且没有 dataType，success 接收 (data, status, xhr, form)
                            options.success(xhr.responseText, 'success', xhr, form);
                        } else {
                            options.success(responseData, 'success', xhr, form);
                        }
                    }
                    
                    // 重置或清空表单
                    if (options.resetForm) {
                        resetForm(form);
                    }
                    if (options.clearForm) {
                        clearForm(form, options.includeHidden);
                    }
                } else {
                    // 错误处理
                    if (options.error) {
                        options.error(xhr, 'error', xhr.statusText);
                    }
                }
                
                // complete 回调
                if (options.complete) {
                    options.complete(xhr, xhr.status >= 200 && xhr.status < 300 ? 'success' : 'error');
                }
            });
            
            xhr.addEventListener('error', () => {
                if (options.error) {
                    options.error(xhr, 'error', 'Network error');
                }
                if (options.complete) {
                    options.complete(xhr, 'error');
                }
            });
            
            xhr.send(formData);
        } else {
            // 使用 fetch（不支持进度，但更现代）
            csg.ajax(requestOptions)
                .then(responseData => {
                    // 处理 target 选项
                    if (options.target) {
                        const targetElement = typeof options.target === 'string' 
                            ? document.querySelector(options.target)
                            : options.target;
                        if (targetElement) {
                            if (typeof responseData === 'string') {
                                if (options.replaceTarget) {
                                    targetElement.replaceWith(...targetElement.ownerDocument.createRange().createContextualFragment(responseData));
                                } else {
                                    targetElement.innerHTML = responseData;
                                }
                            }
                        }
                    }
                    
                    // success 回调
                    if (options.success) {
                        if (options.target && !options.dataType) {
                            // 如果设置了 target 且没有 dataType，success 接收 (data, status, xhr, form)
                            options.success(responseData, 'success', null, form);
                        } else {
                            options.success(responseData, 'success', null, form);
                        }
                    }
                    
                    // 重置或清空表单
                    if (options.resetForm) {
                        resetForm(form);
                    }
                    if (options.clearForm) {
                        clearForm(form, options.includeHidden);
                    }
                    
                    // complete 回调
                    if (options.complete) {
                        options.complete(null, 'success');
                    }
                })
                .catch(error => {
                    if (options.error) {
                        options.error(null, 'error', error.message || 'Request failed');
                    }
                    if (options.complete) {
                        options.complete(null, 'error');
                    }
                });
        }
        
        return formOrOptions; // 支持链式调用
    }

    /**
     * ajaxForm - 绑定表单提交事件（jQuery Form 兼容方法）
     * @param {HTMLFormElement|jQuery} formOrOptions - 表单元素或选项对象
     * @param {Object|Function} optionsOrSuccess - 选项对象或成功回调函数
     * @param {string} dataType - 数据类型（已废弃）
     * @param {Function} onSuccess - 成功回调（已废弃）
     * @returns {jQuery|void} jQuery 链式调用或 void
     */
    function ajaxForm(formOrOptions, optionsOrSuccess, dataType, onSuccess) {
        // 处理 jQuery 调用：$(form).ajaxForm(options) 或 $(form).ajaxForm(success)
        let form, options;
        
        if (formOrOptions instanceof HTMLFormElement || (formOrOptions && formOrOptions.tagName === 'FORM')) {
            form = formOrOptions;
            if (typeof optionsOrSuccess === 'function') {
                options = { success: optionsOrSuccess };
            } else {
                options = optionsOrSuccess || {};
            }
        } else if (formOrOptions && typeof formOrOptions === 'object' && formOrOptions.nodeName !== 'FORM') {
            // 可能是 jQuery 对象
            if (formOrOptions.jquery || formOrOptions.length) {
                form = formOrOptions[0] || formOrOptions.get(0);
                if (typeof optionsOrSuccess === 'function') {
                    options = { success: optionsOrSuccess };
                } else {
                    options = optionsOrSuccess || {};
                }
            } else {
                console.warn('ajaxForm: Invalid form element');
                return formOrOptions;
            }
        } else {
            console.warn('ajaxForm: Form element required');
            return formOrOptions;
        }
        
        if (!form || form.tagName !== 'FORM') {
            console.warn('ajaxForm: Invalid form element');
            return formOrOptions;
        }
        
        // 移除旧的事件监听器（如果存在）
        if (form._ajaxFormHandler) {
            form.removeEventListener('submit', form._ajaxFormHandler);
        }
        
        // 创建新的事件处理器
        form._ajaxFormHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            ajaxSubmit(form, options);
            return false;
        };
        
        // 绑定提交事件
        form.addEventListener('submit', form._ajaxFormHandler);
        
        return formOrOptions; // 支持链式调用
    }

    /**
     * ajaxFormUnbind - 解绑 ajaxForm 事件（jQuery Form 兼容方法）
     * @param {HTMLFormElement|jQuery} formOrOptions - 表单元素
     * @returns {jQuery|void} jQuery 链式调用或 void
     */
    function ajaxFormUnbind(formOrOptions) {
        let form;
        
        if (formOrOptions instanceof HTMLFormElement || (formOrOptions && formOrOptions.tagName === 'FORM')) {
            form = formOrOptions;
        } else if (formOrOptions && typeof formOrOptions === 'object' && formOrOptions.nodeName !== 'FORM') {
            if (formOrOptions.jquery || formOrOptions.length) {
                form = formOrOptions[0] || formOrOptions.get(0);
            }
        }
        
        if (form && form._ajaxFormHandler) {
            form.removeEventListener('submit', form._ajaxFormHandler);
            delete form._ajaxFormHandler;
        }
        
        return formOrOptions;
    }

    // 如果 jQuery 存在，扩展 jQuery 原型（兼容 jQuery Form 插件）
    if (typeof window.$ !== 'undefined' && window.$ && window.$.fn) {
        window.$.fn.ajaxSubmit = function(options, dataType, onSuccess) {
            if (this.length === 0) return this;
            // 支持多个表单元素
            this.each(function() {
                const form = this;
                if (form && form.tagName === 'FORM') {
                    ajaxSubmit(form, options, dataType, onSuccess);
                }
            });
            return this; // 支持链式调用
        };
        
        window.$.fn.ajaxForm = function(options, dataType, onSuccess) {
            if (this.length === 0) return this;
            // 支持多个表单元素
            this.each(function() {
                const form = this;
                if (form && form.tagName === 'FORM') {
                    ajaxForm(form, options, dataType, onSuccess);
                }
            });
            return this; // 支持链式调用
        };
        
        window.$.fn.ajaxFormUnbind = function() {
            if (this.length === 0) return this;
            // 支持多个表单元素
            this.each(function() {
                const form = this;
                if (form && form.tagName === 'FORM') {
                    ajaxFormUnbind(form);
                }
            });
            return this; // 支持链式调用
        };
    }

    // 导出到全局对象，防止重复引入
    window.FormValidationTip = {
        initFormValidation,
        initCommonFormValidation,
        createBilingualMessage,
        generateDefaultMessage,
        ValidationTemplates,
        validateForm,
        clearFormValidation,
        FormValidationRules,
        showFieldError,
        clearFieldError,
        getFieldErrorTooltipPlacement,
        resolveTooltipHost,
        elementIsTooltipAnchorable,
        disposeBootstrapTooltipSafe,
        validateField,
        ajaxSubmit,
        ajaxForm,
        ajaxFormUnbind,
        serializeForm,
        resetForm,
        clearForm
    };

    // 导出函数（如果使用模块系统）
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = window.FormValidationTip;
    }

})(); // IIFE 结束