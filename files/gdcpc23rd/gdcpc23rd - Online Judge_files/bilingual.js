/**
 * 双语显示效果控制
 * 始终显示双语文本（中文为主，英文为辅）
 */

(function() {
    'use strict';
    
    // 默认配置
    var config = {
        showEnglish: true,  // 始终显示英文（作为辅助）
        animationDuration: 200  // 动画持续时间
    };
    
    /**
     * 初始化双语显示
     */
    function init() {
        // 始终显示英文辅助文本
        config.showEnglish = true;
        
        // 应用显示状态
        updateDisplay();
        
        // 优化按钮中的英文文本颜色
        optimizeButtonTextColors();
        
        // 优化品牌区域中的英文文本显示
        optimizeBrandTextColors();

        // 品牌标题：超过 5 个字符时动态缩小字号，避免折行
        optimizeBrandTitleSize();

        // 窗口尺寸变化时重新计算（避免响应式下溢出）
        bindBrandResizeHandler();
        
    }
    
    /**
     * 更新显示状态
     */
    function updateDisplay() {
        var $enTexts = $('.en-text');
        
        // 始终显示英文辅助文本
        $enTexts.show();
    }
    
    
    
    /**
     * 优化按钮中的英文文本颜色
     */
    function optimizeButtonTextColors() {
        // 保持按钮内英文文本完全由 CSS 继承父元素颜色，避免首屏闪变
        // 如需特殊按钮定制，请在样式表中以选择器覆盖，而非运行时内联样式
        return;
    }
    
    /**
     * 优化品牌区域中的英文文本显示
     */
    function optimizeBrandTextColors() {
        $('.cpc-brand-subtitle .en-text').each(function() {
            var $enText = $(this);
            var $navbar = $enText.closest('.cpc-navbar');
            
            // 品牌区域使用固定的浅色文字，因为背景是深色的
            $enText.css({
                'color': 'rgba(238, 238, 238, 0.8)',
                'text-shadow': '0 1px 2px rgba(0, 0, 0, 0.3)',
                'opacity': '0.8'
            });
        });
    }

    /**
     * 品牌标题字号自适应（按字符数）
     * - OJ_NAME 可能是中文/英文混合，长度 > 5 时缩小字号避免折行
     * - 使用 class 标记，交由 CSS 控制具体字号策略
     */
    function optimizeBrandTitleSize() {
        try {
            $('.cpc-brand').each(function () {
                var el = this;
                if (!el) return;
                var text = (el.textContent || '').trim();
                // 使用 Array.from 以更接近“可见字符数”（兼容中文/emoji）
                var len = Array.from(text).length;
                el.setAttribute('data-length', String(len));
                if (len > 5) {
                    el.classList.add('cpc-brand-long');
                } else {
                    el.classList.remove('cpc-brand-long');
                }

                // 进一步：按实际可用宽度微调字号，确保不超出 brand 区域
                fitBrandToContainer(el);
            });
        } catch (e) {
            // ignore
        }
    }

    // 仅绑定一次 resize 处理器
    var brandResizeBound = false;
    function bindBrandResizeHandler() {
        if (brandResizeBound) return;
        brandResizeBound = true;
        var timer = null;
        window.addEventListener('resize', function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
                try { optimizeBrandTitleSize(); } catch (e) { /* ignore */ }
            }, 120);
        });
    }

    /**
     * 根据 brand-main 的可用宽度动态缩放标题字号（不折行、不省略）
     * - 仅在确实溢出时才缩小
     */
    function fitBrandToContainer(brandEl) {
        if (!brandEl || !brandEl.ownerDocument) return;

        // 找可用宽度容器：brand-main（已是 toggler 旁边的剩余空间）
        var container = brandEl.closest ? brandEl.closest('.brand-main') : null;
        if (!container) return;

        var avail = container.clientWidth;
        if (!avail || avail <= 0) return;

        // 留一点安全边距（避免贴边/子像素误差）
        avail = Math.max(0, avail - 8);

        // 重置一次 inline fontSize，拿到基准字号与基准宽度
        var prevInline = brandEl.style.fontSize;
        brandEl.style.fontSize = '';
        var baseFont = parseFloat(window.getComputedStyle(brandEl).fontSize) || 0;
        if (!baseFont) {
            brandEl.style.fontSize = prevInline || '';
            return;
        }

        // 计算当前内容宽度
        var need = brandEl.scrollWidth || brandEl.offsetWidth || 0;
        if (!need) {
            brandEl.style.fontSize = prevInline || '';
            return;
        }

        // 不溢出：保持原样
        if (need <= avail) {
            brandEl.style.fontSize = prevInline || '';
            return;
        }

        // 溢出：按比例缩小字号（保证布局宽度也随之变小）
        var scale = avail / need;
        var minFont = 14; // 下限：避免过小影响可读性
        var nextFont = Math.max(minFont, Math.floor(baseFont * scale));
        brandEl.style.fontSize = nextFont + 'px';

        // 再校准一次（处理 rounding/letter-spacing）
        var need2 = brandEl.scrollWidth || 0;
        if (need2 && need2 > avail && nextFont > minFont) {
            var scale2 = avail / need2;
            var nextFont2 = Math.max(minFont, Math.floor(nextFont * scale2));
            brandEl.style.fontSize = nextFont2 + 'px';
        }
    }
    
    /**
     * 判断背景颜色是否为深色
     * @param {string} bgColor - CSS背景颜色值
     * @returns {boolean} 是否为深色背景
     */
    function isDarkBackground(bgColor) {
        if (!bgColor || bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)') {
            return false;
        }
        
        // 解析RGB值
        var rgb = bgColor.match(/\d+/g);
        if (!rgb || rgb.length < 3) {
            return false;
        }
        
        var r = parseInt(rgb[0]);
        var g = parseInt(rgb[1]);
        var b = parseInt(rgb[2]);
        
        // 计算亮度 (使用标准亮度公式)
        var brightness = (r * 299 + g * 587 + b * 114) / 1000;
        
        return brightness < 128; // 小于128认为是深色
    }
    
    /**
     * 获取DOM对象的中英双语文本
     * @param {jQuery|HTMLElement} element - DOM元素或jQuery对象
     * @returns {Object} 包含中文和英文文本的对象 {chinese: string, english: string}
     */
    function getBilingualText(element) {
        var $element = $(element);
        var $enText = $element.find('.en-text');
        
        var chinese = '';
        var english = '';
        
        if ($enText.length > 0) {
            // 有英文文本的情况
            // 克隆元素，只移除英文文本部分，保留其他子元素和文本
            var $clone = $element.clone();
            $clone.find('.en-text').remove();
            chinese = $clone.text().trim();
            english = $enText.text().trim();
        } else {
            // 没有英文文本的情况
            chinese = $element.text().trim();
            english = '';
        }
        
        return {
            chinese: chinese,
            english: english
        };
    }
    
    
    // 公开API
    window.Bilingual = {
        init: init,
        optimizeButtonTextColors: optimizeButtonTextColors,
        optimizeBrandTextColors: optimizeBrandTextColors,
        getBilingualText: getBilingualText,
        config: config
    };
    
    // 自动初始化
    $(document).ready(function() {
        init();
    });
    
})();