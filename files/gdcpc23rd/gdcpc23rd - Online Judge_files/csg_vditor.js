// 轻量封装 Vditor 预览与编辑器，便于统一调用
// 依赖：Vditor 已由 pkg_vditor.php 引入
(function (global) {
    // 本地资源根路径，确保不走外部 unpkg
    const DEFAULT_CDN = '/static/vditor';

    const DEFAULT_TOOLBAR = [
        'headings',
        'bold',
        'italic',
        'strike',
        '|',
        'list',
        'ordered-list',
        'check',
        '|',
        'quote',
        'code',
        'code-theme',
        'code-block',
        'table',
        'link',
        'image',
        '|',
        'edit-mode', // 允许切换模式
        'undo',
        'redo',
        'fullscreen',
        'preview',
    ];

    // 默认配置：常用参数内置，避免业务代码重复定义
    const DEFAULT_CONFIG = {
        cdn: DEFAULT_CDN,
        hljs: { enable: true, lineNumber: true },
        // Lute 引擎配置：允许纯数字的数学公式
        lute: {
            inlineMathAllowDigit: true, // 允许纯数字的行内数学公式（如 $25,15,10$）
        },
        // 注意：preview 配置在 DEFAULT_PREVIEW 中定义，避免覆盖
    };

    const DEFAULT_PREVIEW = {
        delay: 200,
        hljs: { enable: true, lineNumber: true },
        // Lute 引擎配置：允许纯数字的数学公式
        lute: {
            inlineMathAllowDigit: true, // 允许纯数字的行内数学公式（如 $25,15,10$）
        },
        // 预览数学公式配置：允许数字开头的行内公式（Vditor 3.11.2+）
        math: {
            inlineDigit: true, // 允许 $ 后输入数字（如 $1+3$）
            engine: 'KaTeX', // 明确指定引擎，确保配置生效
        },
    };

    // 禁止传图提示信息
    const IMAGE_UPLOAD_DISABLED_MSG = {
        cn: '编辑框禁止传图，系统会在必须传图的地方提供专用传图功能',
        en: 'Image upload disabled. The system will provide dedicated upload functionality where images are required.'
    };

    function ensureEl(el) {
        if (typeof el === 'string') return document.querySelector(el);
        return el;
    }

    /**
     * 深度合并对象（用于合并 preview 等嵌套配置）
     * @param {Object} target - 目标对象
     * @param {Object} source - 源对象
     * @returns {Object} 合并后的对象
     */
    function deepMerge(target, source) {
        const result = Object.assign({}, target);
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key]) &&
                    typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])) {
                    result[key] = deepMerge(target[key], source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        return result;
    }

    /**
     * 将 Markdown 字符串直接转换为 HTML 字符串（无需 DOM 操作）
     * 注意：Vditor.md2html 可能是异步的，返回 Promise
     * @param {string} markdown markdown 字符串
     * @param {Object} options 可选项（如 cdn 等）
     * @returns {string|Promise<string>} HTML 字符串或 Promise
     */
    function md2html(markdown = '', options = {}) {
        if (typeof Vditor === 'undefined' || typeof Vditor.md2html !== 'function') {
            return '';
        }
        // 使用默认配置，允许通过 options 覆盖
        const result = Vditor.md2html(markdown, Object.assign({}, DEFAULT_CONFIG, options));
        // 如果返回的是 Promise，直接返回（由调用方处理）
        // 如果是字符串，直接返回
        return result;
    }

    /**
     * 预览渲染（在 DOM 元素中直接渲染，确保代码块和数学公式正确显示）
     * @param {Object} param0
     * @param {HTMLElement|string} param0.el 目标容器
     * @param {string} param0.markdown markdown 字符串
     * @param {Object} param0.options Vditor.preview 的可选项
     */
    function renderMarkdown({ el, markdown = '', options = {} }) {
        const target = ensureEl(el);
        if (!target || typeof Vditor === 'undefined') return;
        // 深度合并 preview 配置，确保 math.inlineDigit 不被覆盖
        const mergedOptions = Object.assign({}, DEFAULT_CONFIG, DEFAULT_PREVIEW, options);
        if (options.preview) {
            mergedOptions.preview = deepMerge(DEFAULT_PREVIEW, options.preview);
        }
        // 合并默认配置、预览配置和用户选项（用户选项优先级最高）
        Vditor.preview(target, markdown || '', mergedOptions);
    }

    /**
     * 渲染 Markdown 到容器（参考 Vue 项目的实现）
     * @param {HTMLElement|string} container - 目标容器
     * @param {string} markdown - Markdown 字符串
     * @param {Object} options - 可选项（如 codeWrap 等）
     * @returns {Promise<void>}
     */
    function renderMarkdownToContainer(container, markdown = '', options = {}) {
        return new Promise((resolve, reject) => {
            try {
                // 确保容器是 DOM 元素
                let target;
                if (typeof container === 'string') {
                    target = document.querySelector(container);
                } else if (container && container.nodeType === 1) {
                    target = container;
                } else {
                    reject(new Error('Invalid container: must be HTMLElement or selector string'));
                    return;
                }
                
                if (!target) {
                    reject(new Error('Container element not found'));
                    return;
                }
                
                if (typeof Vditor === 'undefined' || typeof Vditor.preview !== 'function') {
                    reject(new Error('Vditor not available or preview method not found'));
                    return;
                }
                
                // 清空容器
                target.innerHTML = '';
                
                // 使用 Vditor.preview 渲染，确保代码块和数学公式正确显示
                // 深度合并 preview 配置，确保 math.inlineDigit 不被覆盖
                const previewOptions = Object.assign({}, DEFAULT_CONFIG, DEFAULT_PREVIEW, options);
                if (options.preview) {
                    previewOptions.preview = deepMerge(DEFAULT_PREVIEW, options.preview);
                }
                
                Vditor.preview(target, markdown || '', previewOptions);
                
                // Vditor.preview 是同步的，但需要等待资源加载（特别是 highlight.js）
                // 增加延迟以确保代码高亮正确应用
                setTimeout(() => resolve(), 200);
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * 创建编辑器
     * @param {Object} param0
     * @param {HTMLElement|string} param0.el 容器
     * @param {string} param0.value 初始内容
     * @param {number} param0.height 高度（px）
     * @param {Function} param0.onSave 回调：接收 markdown 字符串
     * @param {Function} param0.onChange 回调：接收 markdown 字符串
     * @param {boolean} param0.allowImageUpload 是否允许上传图片，默认 false（禁止传图）
     * @param {Object} param0.options 传递给 Vditor 的其他配置
     * @returns {Vditor} 实例
     */
    function createEditor({ el, value = '', height = 500, onSave, onChange, allowImageUpload = false, options = {} }) {
        const target = ensureEl(el);
        if (!target || typeof Vditor === 'undefined') return null;
        
        // 根据 allowImageUpload 决定工具栏配置
        let toolbar = DEFAULT_TOOLBAR;
        if (!allowImageUpload) {
            toolbar = DEFAULT_TOOLBAR.filter(item => item !== 'image');
        }
        
        // 深度合并 preview 配置，确保 math.inlineDigit 不被覆盖
        const mergedPreview = options.preview 
            ? deepMerge(DEFAULT_PREVIEW, options.preview)
            : DEFAULT_PREVIEW;
        
        // 从 options 中提取 preview，避免被覆盖
        const { preview: _, ...optionsWithoutPreview } = options;
        
        const v = new Vditor(target, Object.assign({
            value,
            height,
            mode: 'wysiwyg',
            cache: { enable: false },
            toolbarConfig: { pin: true },
            toolbar: toolbar,
            preview: mergedPreview,
            customWysiwygToolbar: () => {}, // 避免版本兼容报错
            input: (md) => {
                if (typeof onChange === 'function') onChange(md);
            },
            upload: { enable: false },
            after: () => {
                if (typeof onChange === 'function') onChange(value || v.getValue());
                
                // 禁止传图：监听粘贴事件，阻止图片粘贴
                if (!allowImageUpload) {
                    const editorElement = target.querySelector('.vditor-content') || target;
                    if (editorElement) {
                        editorElement.addEventListener('paste', (e) => {
                            const items = e.clipboardData?.items;
                            if (items) {
                                for (let i = 0; i < items.length; i++) {
                                    if (items[i].type.indexOf('image') !== -1) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (typeof alerty !== 'undefined' && typeof alerty.error === 'function') {
                                            alerty.error(IMAGE_UPLOAD_DISABLED_MSG.cn, IMAGE_UPLOAD_DISABLED_MSG.en);
                                        } else {
                                            alert(IMAGE_UPLOAD_DISABLED_MSG.cn);
                                        }
                                        return false;
                                    }
                                }
                            }
                        }, true);
                    }
                }
            },
        }, DEFAULT_CONFIG, optionsWithoutPreview, { preview: mergedPreview }));
        if (typeof onSave === 'function') {
            v.options.toolbar = v.options.toolbar || toolbar;
            // 用户可在外层绑定保存，或在 onSave 中直接使用 v.getValue()
            v.onSave = () => onSave(v.getValue());
        }
        return v;
    }

    /**
     * 创建单例编辑器（常用于弹窗内复用一个 Vditor）
     * @param {Object} param0
     * @param {HTMLElement|string} param0.el 容器
     * @param {Object} param0.options 其余与 createEditor 相同
     * @param {Function} param0.onCharCountUpdate 字符计数更新回调，接收 (currentLength, maxLength, remaining)
     * @param {number} param0.maxCharLength 最大字符长度（字节），用于字符计数
     * @param {Function} param0.onCharLimitExceed 超出字符限制时的回调
     * @param {boolean} param0.enableCharCount 是否启用字符计数，默认 true（性能消耗很小，默认启用）
     * @param {boolean} param0.allowImageUpload 是否允许上传图片，默认 false（禁止传图）
     * @returns {Object} { ready: Promise<Vditor>, getInstance: () => Vditor|null, setValue: (md) => Promise<void>, getValue: () => Promise<string> }
     */
    function createSingletonEditor({ el, onCharCountUpdate, maxCharLength, onCharLimitExceed, enableCharCount = true, allowImageUpload = false, ...rest }) {
        const target = ensureEl(el);
        let instance = null;
        let ready = null;
        
        // 字符计数相关：使用高效的 StrByteLength（如果存在），否则使用轻量级实现
        const getByteLength = typeof StrByteLength === 'function' 
            ? StrByteLength 
            : (str) => {
                // 轻量级 UTF-8 字节长度计算（比 Blob 更高效）
                let len = 0;
                for (let i = 0; i < (str || '').length; i++) {
                    const c = str.charCodeAt(i);
                    if (c >= 0x010000 && c <= 0x10FFFF) {
                        len += 4;
                    } else if (c >= 0x000800 && c <= 0x00FFFF) {
                        len += 3;
                    } else if (c >= 0x000080 && c <= 0x0007FF) {
                        len += 2;
                    } else {
                        len += 1;
                    }
                }
                return len;
            };
        
        // 防抖函数，减少频繁计算（默认启用字符计数，性能消耗很小）
        let debounceTimer = null;
        const debouncedCharCount = (md) => {
            if (!enableCharCount || typeof onCharCountUpdate !== 'function' || typeof maxCharLength !== 'number') {
                return;
            }
            
            // 清除之前的定时器
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            
            // 防抖：延迟 50ms 执行，减少频繁计算
            debounceTimer = setTimeout(() => {
                const currentLength = getByteLength(md || '');
                const remaining = maxCharLength - currentLength;
                
                onCharCountUpdate(currentLength, maxCharLength, remaining);
                
                // 如果超出限制，触发回调
                if (remaining < 0 && typeof onCharLimitExceed === 'function') {
                    onCharLimitExceed(currentLength, maxCharLength);
                }
            }, 50);
        };
        
        // 立即执行字符计数（用于 setValue 等需要立即更新的场景）
        const immediateCharCount = (md) => {
            if (!enableCharCount || typeof onCharCountUpdate !== 'function' || typeof maxCharLength !== 'number') {
                return;
            }
            
            const currentLength = getByteLength(md || '');
            const remaining = maxCharLength - currentLength;
            
            onCharCountUpdate(currentLength, maxCharLength, remaining);
            
            // 如果超出限制，触发回调
            if (remaining < 0 && typeof onCharLimitExceed === 'function') {
                onCharLimitExceed(currentLength, maxCharLength);
            }
        };

        const ensure = () => {
            if (instance && ready) return ready;
            ready = new Promise((resolve) => {
                // 在 after 中 resolve，确保内部状态 ready 后再使用 setValue
                const onChange = rest.onChange;
                const onSave = rest.onSave;
                
                // 根据 allowImageUpload 决定工具栏配置
                let toolbar = rest.toolbar || DEFAULT_TOOLBAR;
                if (!allowImageUpload && !rest.toolbar) {
                    toolbar = DEFAULT_TOOLBAR.filter(item => item !== 'image');
                }
                
                // 深度合并 preview 配置，确保 math.inlineDigit 不被覆盖
                const userPreview = rest.preview || (rest.options && rest.options.preview);
                const mergedPreview = userPreview 
                    ? deepMerge(DEFAULT_PREVIEW, userPreview)
                    : DEFAULT_PREVIEW;
                
                // 从 rest.options 中提取 preview，避免被覆盖
                const restOptions = rest.options || {};
                const { preview: _, ...optionsWithoutPreview } = restOptions;
                
                instance = new Vditor(target, Object.assign({
                    value: rest.value || '',
                    height: rest.height || 500,
                    mode: rest.default_mode || rest.mode || 'wysiwyg',
                    cache: { enable: false },
                    toolbarConfig: { pin: true },
                    toolbar: toolbar,
                    preview: mergedPreview,
                    customWysiwygToolbar: () => {},
                    input: (md) => {
                        debouncedCharCount(md);
                        if (typeof onChange === 'function') onChange(md);
                    },
                    upload: { enable: false },
                    after: () => {
                        const initialValue = instance.getValue();
                        immediateCharCount(initialValue);
                        if (typeof onChange === 'function') onChange(initialValue);
                        
                        // 禁止传图：监听粘贴事件，阻止图片粘贴
                        if (!allowImageUpload) {
                            const editorElement = target.querySelector('.vditor-content') || target;
                            if (editorElement) {
                                editorElement.addEventListener('paste', (e) => {
                                    const items = e.clipboardData?.items;
                                    if (items) {
                                        for (let i = 0; i < items.length; i++) {
                                            if (items[i].type.indexOf('image') !== -1) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (typeof alerty !== 'undefined' && typeof alerty.error === 'function') {
                                                    alerty.error(IMAGE_UPLOAD_DISABLED_MSG.cn, IMAGE_UPLOAD_DISABLED_MSG.en);
                                                } else {
                                                    alert(IMAGE_UPLOAD_DISABLED_MSG.cn);
                                                }
                                                return false;
                                            }
                                        }
                                    }
                                }, true);
                            }
                        }
                        
                        resolve(instance);
                    }
                }, DEFAULT_CONFIG, optionsWithoutPreview, { preview: mergedPreview }));
            });
            return ready;
        };

        const setValue = (md) => ensure().then((v) => {
            if (v && v.setValue) {
                v.setValue(md || '');
                // setValue 时立即更新字符计数（不需要防抖）
                immediateCharCount(md);
            }
        });
        
        const getValue = () => {
            if (instance && instance.getValue) {
                try {
                    return Promise.resolve(instance.getValue());
                } catch (e) {
                    return Promise.resolve('');
                }
            }
            return ensure().then((v) => v ? (v.getValue ? v.getValue() : '') : '');
        };
        
        const getInstance = () => instance;

        return { ready: ensure(), ensure, getInstance, setValue, getValue };
    }

    global.CsgVditor = {
        md2html,
        render: renderMarkdown,
        renderMarkdownToContainer,
        createEditor,
        createSingletonEditor,
    };
})(window);
