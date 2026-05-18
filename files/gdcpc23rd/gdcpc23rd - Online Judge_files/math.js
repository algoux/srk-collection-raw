/**
 * 数学公式渲染工具
 * 统一处理页面中的数学公式渲染，支持 KaTeX
 * 使用通用函数名，便于未来切换数学公式库
 */

(function(global) {
    'use strict';

    /**
     * 处理特定 DOM 中所有特殊处理的公式，`$$`或```$$$$```
     * @param {HTMLElement} m_item - DOM 元素
     */
    function MathCodeProcess(m_item) {
        if (!m_item) return;
        if (typeof katex === 'undefined') return;
        
        // 处理 <div class="language-math"> 格式（Vditor 生成的块级公式格式）
        const divMathElements = Array.from(m_item.querySelectorAll("div.language-math"));
        divMathElements.forEach(div_item => {
            // 获取 HTML 内容并解码 HTML 实体
            let content = div_item.innerHTML.trim();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            content = (tempDiv.textContent || tempDiv.innerText || content).trim();
            
            if (content) {
                try {
                    // <div class="language-math"> 是 Vditor 将 $$...$$ 转换来的，$$...$$ 本身就是显示模式
                    const rendered = katex.renderToString(content, {
                        throwOnError: false,
                        displayMode: true
                    });
                    div_item.outerHTML = rendered;
                } catch (e) {
                    console.error('Math render error for div.language-math:', e);
                }
            }
        });
        
        // 处理 <span class="language-math"> 格式（Vditor 生成的行内公式格式）
        const spanMathElements = Array.from(m_item.querySelectorAll("span.language-math"));
        spanMathElements.forEach(span_item => {
            // 获取 HTML 内容并解码 HTML 实体
            let content = span_item.innerHTML.trim();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            content = (tempDiv.textContent || tempDiv.innerText || content).trim();
            
            if (content) {
                try {
                    // <span class="language-math"> 是 Vditor 将 $...$ 转换来的，$...$ 本身就是行内模式
                    const rendered = katex.renderToString(content, {
                        throwOnError: false,
                        displayMode: false
                    });
                    span_item.outerHTML = rendered;
                } catch (e) {
                    console.error('Math render error for span.language-math:', e);
                }
            }
        });
    }

    /**
     * 动态生成 HTML 后渲染数学公式，定制化处理 HTML 内容
     * @param {string|null} selector_str - CSS 选择器
     * @param {Array|null} markdown_eles - Markdown 元素数组
     * @param {Document|HTMLElement|jQuery} dom_range - DOM 范围（默认 document）
     */
    function MathDomProcess(selector_str, markdown_eles=null, dom_range=document) {
        // 处理 jQuery 对象
        if (dom_range && typeof dom_range.jquery !== 'undefined') {
            dom_range = dom_range[0] || document;
        }
        
        // 确保 dom_range 是有效的 DOM 元素或 Document
        if (!dom_range || (typeof dom_range.querySelectorAll !== 'function' && dom_range.nodeType !== 9)) {
            dom_range = document;
        }
        
        if(selector_str != null) {
            markdown_eles = Array.from(dom_range.querySelectorAll(selector_str));
        }
        if (!markdown_eles || markdown_eles.length === 0) return;
        
        markdown_eles.forEach(m_item => {
            MathCodeProcess(m_item);
        });
    }

    /**
     * 渲染数学公式
     * @param {string} selector_str - CSS 选择器
     * @param {Document|HTMLElement|jQuery} dom_range - DOM 范围（默认 document）
     * @param {boolean} with_process - 是否进行预处理
     */
    function MathRender(selector_str, dom_range=document, with_process=false) {
        if (typeof katex === 'undefined') {
            console.warn('Math library (KaTeX) is not loaded');
            return;
        }
        
        // 处理 jQuery 对象
        if (dom_range && typeof dom_range.jquery !== 'undefined') {
            dom_range = dom_range[0] || document;
        }
        
        if(with_process) {
            MathDomProcess(selector_str, null, dom_range);
        }
        
        // 渲染所有包含数学公式的元素
        // 注意：只处理 Pandoc 生成的格式，$...$ 和 $$...$$ 格式由 auto-render 扩展自动处理
        const renderPandocMath = (element) => {
            if (!element) return;
            
            // 处理 Pandoc 生成的 HTML 格式：<span class="math inline">...</span> 和 <span class="math display">...</span>
            // 注意：Pandoc 使用 --katex 时生成的格式是 <span class="math inline">...</span>
            // Pandoc 使用 --mathjax 时可能生成 <span class="math inline">\(...\)</span> 或直接生成 \(...\)
            // KaTeX auto-render 扩展不支持这种格式，需要手动处理
            const mathSpans = element.querySelectorAll('span.math, span[class*="math"]');
            mathSpans.forEach(span => {
                // 检查是否是数学公式标签（Pandoc 生成的格式）
                if (!span.classList.contains('math') && !span.className.includes('math')) {
                    return;
                }
                // 跳过已经渲染过的（包含 katex 类或已经是 katex 元素）
                if (span.querySelector('.katex') || span.classList.contains('katex') || span.classList.contains('katex-display')) {
                    return;
                }
                
                // 检查父元素是否已经是 katex 元素
                if (span.parentElement && (span.parentElement.classList.contains('katex') || span.parentElement.classList.contains('katex-display'))) {
                    return;
                }
                
                let isDisplay = span.classList.contains('display');
                let formula = span.textContent.trim();
                
                // 处理 MathJax 格式：如果公式是 \(...\) 或 \[...\]，提取其中的内容
                if (formula.startsWith('\\(') && formula.endsWith('\\)')) {
                    formula = formula.slice(2, -2).trim();
                    isDisplay = false; // 行内公式
                } else if (formula.startsWith('\\[') && formula.endsWith('\\]')) {
                    formula = formula.slice(2, -2).trim();
                    isDisplay = true; // 块级公式
                }
                
                if (formula) {
                    try {
                        const rendered = katex.renderToString(formula, {
                            displayMode: isDisplay,
                            throwOnError: false
                        });
                        // 替换整个 span，这样 auto-render 就不会再处理它了
                        span.outerHTML = rendered;
                    } catch (e) {
                        console.error('Math render error:', e, 'Formula:', formula);
                    }
                }
            });
            
            // 处理直接出现在 HTML 中的 \(...\) 和 \[...\] 格式（未被包裹在 span 中）
            // 这些格式会被 auto-render 处理，但为了确保兼容性，我们也在这里处理
            // 注意：auto-render 已经配置了这些分隔符，所以这里主要是作为备用
        };
        
        // 渲染指定范围内的元素（只处理 Pandoc 格式）
        const elements = dom_range.querySelectorAll('.marked_math_div, .md_display_div');
        elements.forEach(el => {
            renderPandocMath(el);
        });
        
        // 使用 renderMathInElement 处理 $...$ 和 $$...$$ 格式（统一在底层处理）
        if (typeof renderMathInElement !== 'undefined') {
            try {
                renderMathInElement(dom_range, {
                    delimiters: [
                        {left: "$$", right: "$$", display: true},
                        {left: "$", right: "$", display: false},
                        {left: "\\[", right: "\\]", display: true},
                        {left: "\\(", right: "\\)", display: false}
                    ],
                    throwOnError: false,
                    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]
                });
            } catch (e) {
                console.warn('Math formula rendering with renderMathInElement failed:', e);
            }
        }
    }

    /**
     * 初始化 KaTeX auto-render 扩展
     * auto-render 会自动处理页面中的 $...$ 和 $$...$$ 格式
     * 同时支持 MathJax 格式：\(...\) 和 \[...\]（兼容 Pandoc 使用 --mathjax 时的输出）
     * 注意：排除已经被 <span class="math"> 包裹的内容，避免重复渲染
     */
    function initAutoRenderExtension() {
        // 等待 auto-render 扩展加载完成
        if (typeof renderMathInElement === 'undefined') {
            setTimeout(initAutoRenderExtension, 100);
            return;
        }
        
        // 初始化 auto-render，自动渲染页面中的数学公式
        // 支持 KaTeX 格式（$...$ 和 $$...$$）和 MathJax 格式（\(...\) 和 \[...\]）
        // 注意：由于执行顺序是先 autoRender（处理 <span class="math">），后 initAutoRenderExtension
        // 所以 <span class="math"> 内的内容已经被处理过了，auto-render 不会再处理
        try {
            // 只处理未被 <span class="math"> 包裹的内容
            // 由于我们已经先处理了 <span class="math">，它们已经被替换为 katex 元素了
            // auto-render 会自动跳过已经包含 katex 的元素，所以不需要额外配置
            renderMathInElement(document.body, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "$", right: "$", display: false},
                    // 兼容 MathJax 格式（Pandoc 使用 --mathjax 时生成）
                    // 注意：这些格式如果出现在 <span class="math"> 内，已经被 renderPandocMath 处理过了
                    {left: "\\[", right: "\\]", display: true},
                    {left: "\\(", right: "\\)", display: false}
                ],
                throwOnError: false,
                ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]
            });
        } catch (e) {
            console.error('Failed to initialize KaTeX auto-render:', e);
        }
    }

    /**
     * 自动渲染函数 - 在页面加载完成后自动渲染 Pandoc 生成的格式
     * 注意：$...$ 和 $$...$$ 格式由 auto-render 扩展自动处理
     * 这里只处理 Pandoc 生成的 <span class="math inline"> 格式
     */
    function autoRender() {
        // 等待 KaTeX 库加载完成
        if (typeof katex === 'undefined') {
            // 如果 KaTeX 还未加载，延迟重试
            setTimeout(autoRender, 100);
            return;
        }
        
        // 先处理 Pandoc 生成的格式（<span class="math">），避免 auto-render 重复处理
        MathRender('.md_display_div, .marked_math_div', document, false);
    }

    /**
     * 初始化自动渲染
     */
    function initAutoRender() {
        // DOM 加载完成后自动渲染
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                // 先处理 Pandoc 格式，再初始化 auto-render（避免重复处理）
                autoRender(); // 处理 Pandoc 格式
                setTimeout(() => {
                    initAutoRenderExtension(); // 初始化 auto-render 扩展
                }, 50);
                initMutationObserver();
            });
        } else {
            // DOM 已经加载完成，直接渲染
            setTimeout(() => {
                // 先处理 Pandoc 格式，再初始化 auto-render（避免重复处理）
                autoRender(); // 处理 Pandoc 格式
                setTimeout(() => {
                    initAutoRenderExtension(); // 初始化 auto-render 扩展
                }, 50);
                initMutationObserver();
            }, 100);
        }
    }

    /**
     * 初始化 MutationObserver 监听 DOM 变化
     */
    function initMutationObserver() {
        // 确保 document.body 存在
        if (!document.body) {
            setTimeout(initMutationObserver, 100);
            return;
        }
        
        // 监听 DOM 变化，自动渲染新添加的内容（使用 MutationObserver）
        if (typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver((mutations) => {
                let shouldRender = false;
                mutations.forEach((mutation) => {
                    if (mutation.addedNodes.length > 0) {
                        // 检查是否有新增的包含数学公式的元素
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) { // Element node
                                if (node.classList && (
                                    node.classList.contains('md_display_div') ||
                                    node.classList.contains('marked_math_div') ||
                                    node.querySelector('.md_display_div, .marked_math_div')
                                )) {
                                    shouldRender = true;
                                }
                            }
                        });
                    }
                });
                
                if (shouldRender && typeof katex !== 'undefined') {
                    // 延迟渲染，避免频繁触发
                    // 注意：只处理 Pandoc 格式，$...$ 格式由 auto-render 扩展自动处理
                    setTimeout(() => {
                        MathRender('.md_display_div, .marked_math_div', document, false);
                    }, 100);
                }
            });
            
            // 开始观察整个文档的变化
            try {
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            } catch (e) {
                console.warn('Failed to initialize MutationObserver:', e);
            }
        }
    }

    // 导出到全局
    global.MathRender = MathRender;
    global.MathDomProcess = MathDomProcess;
    global.MathCodeProcess = MathCodeProcess;

    // 兼容旧函数名（向后兼容，但建议使用新函数名）
    global.MathjaxRender = MathRender;
    global.MathjaxDomProcess = MathDomProcess;
    global.MathJaxCodeProcess = MathCodeProcess;
    global.KatexRender = MathRender;
    global.KatexDomProcess = MathDomProcess;
    global.KatexCodeProcess = MathCodeProcess;

    // 自动初始化（类似 MathJax 的自动渲染）
    initAutoRender();

})(window);

