// ========================================
// 通用格式化函数
// ========================================

// 通用日期时间格式化函数
// 日期时间格式化器配置
if(typeof(DATE_TIME_CONFIG) == 'undefined') {
    window.DATE_TIME_CONFIG = {
        FONT_SIZE_PRIMARY: '0.75em',    // 主要信息字号
        FONT_SIZE_SECONDARY: '1em',  // 次要信息字号（text-muted会进一步缩小）
        LINE_HEIGHT: '1.2'             // 行高
    };
}

// 通用的对象转字符串方法 - 简单粗暴版本
function objectToString(obj) {
    if (obj === null || obj === undefined) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return obj.toString();
    if (typeof obj === 'object') {
        try {
            // 使用JSON.stringify暴力转换，然后清理掉JSON格式字符
            return JSON.stringify(obj).trim();
        } catch (e) {
            // 如果JSON.stringify失败，回退到toString
            return obj.toString();
        }
    }
    return obj.toString();
}

/**
 * 规范化「出题人/作者」原始字段：去 HTML、按常见分隔符拆分、去重保序。
 * @param {*} raw
 * @returns {string[]}
 */
function ParseProblemAuthorTokens(raw) {
    if (raw == null) {
        return [];
    }
    var s = String(raw);
    s = s.replace(/<p>|<\/p>/gi, ' ');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) {
        return [];
    }
    var parts = s.split(/\s*[,，;；]\s*|\s*[|｜]\s*|\n+/);
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < parts.length; i++) {
        var t = parts[i].trim();
        if (!t || seen[t]) {
            continue;
        }
        seen[t] = true;
        out.push(t);
    }
    return out;
}

function CsgHashStringDjb2(str) {
    var h = 5381 >>> 0;
    for (var i = 0; i < str.length; i++) {
        h = (((h << 5) + h) + str.charCodeAt(i)) >>> 0;
    }
    return h >>> 0;
}

/** @param {string} authorKey */
function CsgAuthorChipStyle(authorKey) {
    var hue = CsgHashStringDjb2(authorKey) % 360;
    return 'background-color:hsl(' + hue + ',62%,93%);color:hsl(' + hue + ',48%,26%);border:1px solid hsl(' + hue + ',35%,78%)';
}

/**
 * 题目列表「出题人/作者」列：按作者名哈希着色的小标签；多列布局时由 oj_problem.css 与表格列 class 控制换行。
 * @param {*} raw
 * @returns {string} HTML 或空串
 */
function FormatProblemAuthorsHtml(raw) {
    var tokens = ParseProblemAuthorTokens(raw);
    if (!tokens.length) {
        return '';
    }
    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    var titlePlain = tokens.join(', ');
    var parts = [];
    parts.push('<span class="csg-author-tags-wrap" title="' + esc(titlePlain) + '">');
    for (var j = 0; j < tokens.length; j++) {
        var tok = tokens[j];
        parts.push('<span class="csg-author-tag" style="' + esc(CsgAuthorChipStyle(tok)) + '">' + esc(tok) + '</span>');
    }
    parts.push('</span>');
    return parts.join('');
}

// ========================================
// 通用工具栏管理功能
// ========================================

// 全局工厂：根据标识生成 queryParams 处理函数
// 用法：window["queryParams_"+tableId] = makeQueryParams(prefix, searchInputId)
if (typeof window.makeQueryParams === 'undefined') {
    window.makeQueryParams = function(prefix, searchInputId, extraProcessor) {
        return function(params) {
            // 处理筛选条件（按 class 前缀匹配）
            $(`.${prefix}_filter`).each(function() {
                const name = $(this).attr('name');
                const val = $(this).val();
                if (name && val != null && val != '-1') {
                    params[name] = val;
                }
            });

            // 处理搜索
            if (searchInputId) {
                const search = $(`#${searchInputId}`).val();
                if (search && search.trim() !== '') {
                    params.search = search.trim();
                }
            }

            // 额外定制处理（可选）
            if (typeof extraProcessor === 'function') {
                params = extraProcessor(params) || params;
            }

            return params;
        };
    };
}

/**
 * 根据当前 URL 计算一个简短的 prefix
 * 例如：/csgoj/status -> status, /expsys/contest/status -> expsys_status
 * @returns {string} 计算得到的 prefix
 */
function calculatePrefixFromUrl() {
    const pathname = window.location.pathname;
    
    // 移除开头的斜杠并分割路径
    const parts = pathname.replace(/^\/+/, '').split('/').filter(p => p);
    
    if (parts.length === 0) {
        return 'default';
    }
    
    // 如果路径只有一部分，直接使用
    if (parts.length === 1) {
        return parts[0];
    }
    
    // 如果路径有多部分，尝试提取关键部分
    // 优先使用最后一部分（通常是页面名）
    const lastPart = parts[parts.length - 1];
    
    // 如果最后一部分是常见页面名（如 status, problem, contest），结合模块名
    const commonPages = ['status', 'problem', 'contest', 'rank', 'user', 'admin'];
    if (commonPages.includes(lastPart)) {
        // 如果有模块名（如 csgoj, expsys, cpcsys），使用 模块名_页面名
        if (parts.length >= 2) {
            const moduleName = parts[0];
            // 如果模块名是常见的，使用 模块名_页面名
            if (['csgoj', 'expsys', 'cpcsys', 'examsys'].includes(moduleName)) {
                return `${moduleName}_${lastPart}`;
            }
        }
        return lastPart;
    }
    
    // 否则使用最后两部分（模块名_页面名）
    if (parts.length >= 2) {
        return `${parts[parts.length - 2]}_${lastPart}`;
    }
    
    // 默认使用最后一部分
    return lastPart;
}

/**
 * 初始化筛选组件的 anchor 参数同步功能（通用函数）
 * @param {Object} config - 配置对象
 * @param {string} config.tableId - 表格ID
 * @param {string} config.prefix - 按钮和输入框ID前缀
 * @param {jQuery} config.table - 表格 jQuery 对象
 * @param {Function} config.onRefresh - 刷新回调函数（可选）
 */
function initFilterAnchorSync(config) {
    let { tableId, prefix, table, enableAnchorSync, onRefresh } = config;
    
    // 如果 prefix 没有提供，根据当前 URL 计算一个简短的 prefix
    if (!prefix || prefix === '') {
        prefix = calculatePrefixFromUrl();
    }
    
    // 全局标志：防止重复初始化
    const anchorSyncKey = `${tableId}_${prefix}_filter_anchor`;
    if (window[anchorSyncKey + '_initialized']) {
        return;
    }
    window[anchorSyncKey + '_initialized'] = true;
    
    // 全局标志：是否正在初始化筛选组件（防止初始化时更新 anchor）
    const isInitializingKey = `${tableId}_${prefix}_isInitializingFilters`;
    window[isInitializingKey] = true;
    
    // 全局标志：筛选组件值是否已初始化
    const filterValuesInitializedKey = `${tableId}_${prefix}_filterValuesInitialized`;
    window[filterValuesInitializedKey] = false;
    
    // 重试计数器：防止无限重试（用于没有 filter 组件的页面，如 rank 页面的 modal）
    const retryCountKey = `${tableId}_${prefix}_filterAnchorRetryCount`;
    const maxRetryCount = 10; // 最大重试 10 次（约 1 秒）
    
    // 生成带namespace的anchor参数名
    function getAnchorKey(name) {
        return `${prefix}_${name}`;
    }
    
    // 绑定单个元素的事件处理函数（可重用）
    function bindAnchorEventForElement($elem, anchorKey) {
        const name = $elem.attr('name');
        if (!name) return;
        
        // 使用一次性标记，确保在页面完全加载前不会触发anchor更新
        // 只在第一次绑定时设置为 false，如果已经绑定过就不再重置
        if ($elem.data('anchor-events-bound') === undefined) {
            $elem.data('anchor-events-bound', false);
        }
        
        if ($elem.is('input')) {
            $elem.off('input.filter_anchor change.filter_anchor').on('input.filter_anchor change.filter_anchor', function(e) {
                // 检查事件是否已绑定（防止初始化时触发）
                if (!$(this).data('anchor-events-bound')) {
                    return;
                }
                
                const isInitializing = $(this).data('initializing-from-anchor');
                const isInitializingFilters = window[isInitializingKey];
                
                // 关键：检查是否是程序化触发的事件（通过 isTrusted 属性）
                // 如果 isTrusted 为 false，说明是程序化触发的事件，应该忽略
                if (e.originalEvent && !e.originalEvent.isTrusted) {
                    return;
                }
                
                // 只有在用户手动输入时才更新 anchor，避免初始化时覆盖
                if (!isInitializing && !isInitializingFilters) {
                    const val = $elem.val();
                    
                    // 标记正在更新 anchor（防止 hashchange 事件触发搜索）
                    window[`${anchorSyncKey}_updating_anchor`] = true;
                    
                    // 如果值为空或默认值，检查 anchor 中是否存在该参数，只有存在时才删除
                    if (val === '' || val === null || val === '-1') {
                        const anchorVal = csg.GetAnchor(anchorKey);
                        if (anchorVal !== null && anchorVal !== '') {
                            csg.SetAnchor(null, anchorKey);
                        }
                    } else {
                        csg.SetAnchor(val, anchorKey);
                    }
                    
                    // 延迟清除标志，确保 hashchange 事件处理完成
                    setTimeout(function() {
                        window[`${anchorSyncKey}_updating_anchor`] = false;
                    }, 0);
                }
            });
        } else if ($elem.is('select')) {
            $elem.off('change.filter_anchor').on('change.filter_anchor', function(e) {
                // 检查事件是否已绑定（防止初始化时触发）
                if (!$(this).data('anchor-events-bound')) {
                    return;
                }
                
                const isInitializing = $(this).data('initializing-from-anchor');
                const isInitializingFilters = window[isInitializingKey];
                
                // 注意：不再检查 isTrusted，因为 csg-select 等自定义组件会程序化触发事件
                // 我们使用 isInitializing 和 isInitializingFilters 标志来控制是否更新 anchor
                
                // 关键：检查事件来源
                // 如果事件是由 csg-select 触发的（用户操作），应该更新 anchor
                // 如果事件是由 syncFiltersFromAnchor 触发的（程序化设置），不应该更新 anchor
                // 通过检查 isInitializing 标志来判断是否是程序化设置
                
                // 只有在用户手动选择时才更新 anchor，避免初始化时覆盖
                if (!isInitializing && !isInitializingFilters) {
                    const val = $elem.val();

                    // 标记正在更新 anchor，防止 SetAnchor 触发的 hashchange 再次调用 onRefresh 导致重复请求
                    window[`${anchorSyncKey}_updating_anchor`] = true;
                    // 如果值为默认值，检查 anchor 中是否存在该参数，只有存在时才删除
                    if (val === '-1' || val === null || val === '') {
                        const anchorVal = csg.GetAnchor(anchorKey);
                        if (anchorVal !== null && anchorVal !== '') {
                            csg.SetAnchor(null, anchorKey);
                        }
                    } else {
                        csg.SetAnchor(val, anchorKey);
                    }
                    setTimeout(function() {
                        window[`${anchorSyncKey}_updating_anchor`] = false;
                    }, 0);
                }
            });
        }
    }
    
    // 从 anchor 读取值并设置到筛选组件
    function syncFiltersFromAnchor(force = false) {
        if (window[filterValuesInitializedKey] && !force) {
            return;
        }
        
        // 确保筛选组件已经存在
        const $filters = $(`.${prefix}_filter`);
        if ($filters.length === 0) {
            // 如果筛选组件还不存在，延迟重试（但限制最大重试次数，防止无限循环）
            if (!force) {
                const currentRetryCount = window[retryCountKey] || 0;
                if (currentRetryCount < maxRetryCount) {
                    window[retryCountKey] = currentRetryCount + 1;
                    setTimeout(function() {
                        syncFiltersFromAnchor(false);
                    }, 100);
                } else {
                    // 超过最大重试次数，标记为已初始化，停止重试
                    // 这种情况通常发生在没有 filter 组件的页面（如 rank 页面的 modal）
                    window[filterValuesInitializedKey] = true;
                    window[retryCountKey] = 0; // 重置计数器
                }
            }
            return;
        }
        
        // 找到 filter 组件，重置重试计数器
        window[retryCountKey] = 0;
        
        $filters.each(function() {
            const $elem = $(this);
            const name = $elem.attr('name');
            if (!name) return;
            
            // 使用带namespace的anchor参数名
            const anchorKey = getAnchorKey(name);
            let anchorVal = csg.GetAnchor(anchorKey);
            
            // 如果使用 namespace 找不到值，尝试不使用 namespace（向后兼容）
            if ((anchorVal === null || anchorVal === '') && prefix) {
                const fallbackVal = csg.GetAnchor(name);
                if (fallbackVal !== null && fallbackVal !== '') {
                    anchorVal = fallbackVal;
                    // 迁移到带 namespace 的格式
                    csg.SetAnchor(fallbackVal, anchorKey);
                    csg.SetAnchor(null, name); // 删除旧格式
                }
            }
            
            // 关键：对于 force 模式（hashchange），需要临时移除事件监听器
            // 对于正常初始化模式，事件还未绑定，所以不需要移除
            if (force) {
                $elem.off('input.filter_anchor change.filter_anchor');
            }
            
            // 标记为正在从 anchor 初始化
            $elem.data('initializing-from-anchor', true);
            
            // 如果 anchor 中有值，使用 anchor 的值
            if (anchorVal !== null && anchorVal !== '') {
                const currentVal = $elem.val();
                
                // 只有当值不同时才更新，避免不必要的 DOM 操作
                if (currentVal !== anchorVal) {
                    // 对于select元素，需要先设置value，然后触发change事件以同步csg-select
                    if ($elem.is('select')) {
                        // 使用原生 value 属性设置值
                        if ($elem[0]) {
                            $elem[0].value = anchorVal;
                            // 触发change事件，让csg-select同步更新显示
                            // 注意：此时 isInitializing-from-anchor 标志为 true，change 事件处理器不会更新 anchor
                            const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                            $elem[0].dispatchEvent(changeEvent);
                            // 在事件处理完成后清除标志
                            setTimeout(function() {
                                $elem.removeData('initializing-from-anchor');
                            }, 0);
                        } else {
                            $elem.val(anchorVal).trigger('change');
                            setTimeout(function() {
                                $elem.removeData('initializing-from-anchor');
                            }, 0);
                        }
                    } else {
                        // input元素，直接设置值
                        if ($elem[0]) {
                            $elem[0].value = anchorVal;
                        } else {
                            $elem.val(anchorVal);
                        }
                        // input 元素不需要触发 change 事件，直接清除标志
                        setTimeout(function() {
                            $elem.removeData('initializing-from-anchor');
                        }, 0);
                    }
                } else {
                    // 值相同，不需要更新，直接清除标志
                    $elem.removeData('initializing-from-anchor');
                }
            } else {
                // 如果 anchor 中没有值，确保筛选组件也清空（绝对同步）
                const currentVal = $elem.val();
                const defaultValue = $elem.is('input') ? '' : '-1';
                if (currentVal !== defaultValue) {
                    // 对于select元素，需要触发change事件以同步csg-select
                    if ($elem.is('select')) {
                        if ($elem[0]) {
                            $elem[0].value = defaultValue;
                            const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                            $elem[0].dispatchEvent(changeEvent);
                            // 在事件处理完成后清除标志
                            setTimeout(function() {
                                $elem.removeData('initializing-from-anchor');
                            }, 0);
                        } else {
                            $elem.val(defaultValue).trigger('change');
                            setTimeout(function() {
                                $elem.removeData('initializing-from-anchor');
                            }, 0);
                        }
                    } else {
                        if ($elem[0]) {
                            $elem[0].value = defaultValue;
                        } else {
                            $elem.val(defaultValue);
                        }
                        setTimeout(function() {
                            $elem.removeData('initializing-from-anchor');
                        }, 0);
                    }
                } else {
                    // 值相同，不需要更新，直接清除标志
                    $elem.removeData('initializing-from-anchor');
                }
            }
            
            // 对于 force 模式（hashchange），需要重新绑定事件
            // 注意：标志清除已经在上面完成，这里只需要重新绑定事件
            if (force) {
                requestAnimationFrame(function() {
                    bindAnchorEventForElement($elem, anchorKey);
                    // force 模式下重新绑定后，确保标志为 true（允许更新 anchor）
                    setTimeout(function() {
                        $elem.data('anchor-events-bound', true);
                    }, 0);
                });
            }
        });
        
        window[filterValuesInitializedKey] = true;
    }
    
    // 关键：先设置值，再绑定事件（避免初始化时触发事件）
    // 从 anchor 读取值并设置（在事件绑定之前，确保值设置完成后再绑定事件）
    // 使用 requestAnimationFrame 确保在下一帧执行，此时 DOM 应该已经完全渲染
    // 初始化筛选组件的 anchor 参数同步功能
    
    requestAnimationFrame(function() {
        // 如果筛选组件还不存在，延迟重试
        if ($(`.${prefix}_filter`).length === 0) {
            setTimeout(function() {
                syncFiltersFromAnchor();
                // 值设置完成后，再绑定事件
                setTimeout(function() {
                    bindAllAnchorEvents();
                }, 100);
            }, 100);
        } else {
            syncFiltersFromAnchor();
            // 值设置完成后，再绑定事件
            // 使用 setTimeout 确保 syncFiltersFromAnchor 中的 Promise.resolve().then() 已完成
            setTimeout(function() {
                bindAllAnchorEvents();
            }, 0);
        }
    });
    
    // 绑定所有筛选组件的事件处理函数
    function bindAllAnchorEvents() {
        $(`.${prefix}_filter`).each(function() {
            const $elem = $(this);
            const name = $elem.attr('name');
            if (!name) return;
            
            // 使用带namespace的anchor参数名
            const anchorKey = getAnchorKey(name);
            
            // 绑定事件（此时值已经设置完成，不会触发事件）
            bindAnchorEventForElement($elem, anchorKey);
        });
    }
    
    // 监听 hashchange 事件，支持浏览器前进后退
    $(window).off('hashchange.filter_anchor_' + anchorSyncKey).on('hashchange.filter_anchor_' + anchorSyncKey, function() {
        // 如果正在更新 anchor（由 input.filter_anchor 事件触发），不执行搜索
        // 这样可以避免用户输入时触发搜索，只在 blur 时执行搜索
        if (window[`${anchorSyncKey}_updating_anchor`]) {
            return;
        }
        
        syncFiltersFromAnchor(true);
        if (onRefresh && typeof onRefresh === 'function') {
            onRefresh();
        } else if (table && table.data('bootstrap.table')) {
            table.bootstrapTable('refresh', {pageNumber: 1});
        }
    });
    
    // 页面初始化完成，允许 anchor 更新
    setTimeout(function() {
        window[isInitializingKey] = false;
        // 标记所有筛选组件的事件已绑定完成，允许触发anchor更新
        $(`.${prefix}_filter`).each(function() {
            $(this).data('anchor-events-bound', true);
        });
    }, 1000); // 延迟 1 秒，确保所有初始化操作完成
}

/**
 * 初始化Bootstrap Table工具栏功能（服务器端分页）
 * @param {Object} config - 配置对象
 * @param {string} config.tableId - 表格ID
 * @param {string} config.prefix - 按钮和输入框ID前缀
 * @param {Array} config.filterSelectors - 筛选选择器数组，如 ['spj', 'defunct']
 * @param {string} config.searchInputId - 搜索框ID
 * @param {Function} config.customQueryParams - 自定义查询参数处理函数
 * @param {Object} config.customHandlers - 自定义事件处理器
 * @param {boolean} config.enableAnchorSync - 是否启用搜索框锚参数同步（默认false）
 * @param {string} config.anchorKey - 搜索框锚参数键名（默认'search'）
 * @param {boolean} config.enableFilterAnchorSync - 是否启用筛选组件锚参数同步（默认true）
 * @param {number} config.searchCacheSeconds - 搜索内容缓存时长（默认0表示不缓存，-1表示永久缓存，正数表示缓存的秒数）
 */
// 全局标志：记录已初始化工具栏的表格，防止重复初始化
if (typeof window.initializedToolbars === 'undefined') {
    window.initializedToolbars = new Set();
}
// 使用 var 而不是 const，避免重复加载时的重复声明错误
var initializedToolbars = window.initializedToolbars;

function initBootstrapTableToolbar(config) {
    let {
        tableId,
        prefix,
        filterSelectors = [],
        searchInputId,
        customQueryParams = null,
        customHandlers = {},
        enableAnchorSync = false,
        anchorKey = 'search',
        enableFilterAnchorSync = true,  // 默认启用筛选组件 anchor 同步
        searchCacheSeconds = 0  // 默认不缓存搜索内容
    } = config;
    
    // 如果 prefix 没有提供，根据当前 URL 计算一个简短的 prefix
    if (!prefix || prefix === '') {
        prefix = calculatePrefixFromUrl();
    }
    
    const table = $(`#${tableId}`);
    
    // 检查是否已经初始化过（防止重复初始化）
    const initKey = `${tableId}_${prefix}`;
    if (initializedToolbars.has(initKey)) {
        return;
    }
    initializedToolbars.add(initKey);
    
    // 保留原接口：如需通过本函数生成 handler，可使用 makeQueryParams
    
    // 工具栏按钮事件处理（使用命名空间事件，确保可以正确解绑）
    // 刷新按钮
    $(`#${prefix}_refresh`).off('click.toolbar').on('click.toolbar', function() {
        if (customHandlers.refresh && typeof customHandlers.refresh === 'function') {
            customHandlers.refresh();
        } else {
            table.bootstrapTable('refresh');
        }
    });
    
    // 清空筛选条件按钮
    $(`#${prefix}_clear`).off('click.toolbar').on('click.toolbar', function() {
        if (customHandlers.clear && typeof customHandlers.clear === 'function') {
            customHandlers.clear();
        } else {
            // 清空所有筛选组件（包括 input 和 select）
            $(`.${prefix}_filter`).each(function() {
                const $elem = $(this);
                const name = $elem.attr('name');
                if (!name) return;
                
                // 标记为正在清空，避免触发 anchor 更新事件
                $elem.data('initializing-from-anchor', true);
                
                // 清空筛选组件值
                if ($elem.is('input')) {
                    $elem.val('');
                } else {
                    // 对于 select，需要触发 change 事件以同步 csg-select 的显示
                    if ($elem[0]) {
                        $elem[0].value = '-1';
                        // 触发 change 事件，让 csg-select 同步更新显示
                        const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                        $elem[0].dispatchEvent(changeEvent);
                    } else {
                        $elem.val('-1').trigger('change');
                    }
                }
                
                // 延迟清除标记
                setTimeout(function() {
                    $elem.removeData('initializing-from-anchor');
                }, 100);
            });
            
            if (searchInputId) {
                $(`#${searchInputId}`).val('');
            }
            // 如果启用了锚参数同步，清空时也清除锚参数和缓存
            if (enableAnchorSync && searchInputId) {
                // 清除 URL hash
                csg.SetAnchor('', anchorKey);
                // 清除 anchor 缓存
                csg.DelStore('anchor_' + anchorKey);
            }
            // 清除搜索内容缓存
            if (searchInputId && searchCacheSeconds !== 0) {
                const searchCacheKey = `search_cache_${prefix}_${anchorKey}`;
                csg.DelStore(searchCacheKey);
            }
            // 如果启用了筛选组件锚参数同步，清空时也清除所有筛选组件的锚参数（使用namespace）
            if (enableFilterAnchorSync) {
                $(`.${prefix}_filter`).each(function() {
                    const $elem = $(this);
                    const name = $elem.attr('name');
                    if (name) {
                        // 使用带namespace的anchor参数名
                        const anchorKey = `${prefix}_${name}`;
                        const anchorVal = csg.GetAnchor(anchorKey);
                        if (anchorVal !== null && anchorVal !== '') {
                            csg.SetAnchor(null, anchorKey);
                        }
                    }
                });
            }
            table.bootstrapTable('refresh');
        }
    });
    
    // 应用筛选按钮
    $(`#${prefix}_filter`).off('click.toolbar').on('click.toolbar', function() {
        table.bootstrapTable('refresh');
    });
    
    // 筛选组件锚参数同步（如果启用）
    // 注意：enableAnchorSync 控制所有筛选组件的 anchor 同步，包括搜索框，一视同仁
    if (enableFilterAnchorSync && enableAnchorSync) {
        initFilterAnchorSync({
            tableId: tableId,
            prefix: prefix,
            table: table,
            enableAnchorSync: enableAnchorSync,
            onRefresh: function() {
                if (table.data('bootstrap.table')) {
                    table.bootstrapTable('refresh', {pageNumber: 1});
                }
            }
        });

        // 直接打开带 hash 的 URL 时不会触发 hashchange：initFilterAnchorSync 只回填控件，
        // 服务端表格需在回填后再 refresh 一次，否则仍显示首次（无筛选）请求的结果。
        (function autoApplyServerToolbarFromAnchorOnLoad() {
            const requestedKey = `${tableId}_${prefix}_autoApplyServerFromAnchor_requested`;
            const appliedKey = `${tableId}_${prefix}_autoApplyServerFromAnchor_applied`;
            if (window[requestedKey]) return;
            window[requestedKey] = true;

            if (typeof csg === 'undefined' || typeof csg.GetAnchor !== 'function') return;

            let hasAnchorFilter = false;
            $(`.${prefix}_filter`).each(function() {
                const name = $(this).attr('name');
                if (!name) return;
                const namespacedKey = `${prefix}_${name}`;
                const v1 = csg.GetAnchor(namespacedKey);
                const v2 = csg.GetAnchor(name);
                const val = (v1 !== null && v1 !== '') ? v1 : v2;
                if (val !== null && val !== '' && val !== '-1') {
                    hasAnchorFilter = true;
                    return false;
                }
            });
            if (!hasAnchorFilter && searchInputId) {
                const sk = anchorKey || 'search';
                const sv = csg.GetAnchor(sk);
                if (sv !== null && sv !== '') {
                    hasAnchorFilter = true;
                }
            }
            if (!hasAnchorFilter) return;

            function applyOnce() {
                if (window[appliedKey]) return;
                if (!table || !table.data('bootstrap.table')) return;
                table.bootstrapTable('refresh', {pageNumber: 1});
                window[appliedKey] = true;
            }

            function waitForTableReady(tryCount = 0) {
                if (table && table.data('bootstrap.table')) {
                    // initFilterAnchorSync 可能延迟到下一帧或 ~100ms 才回填控件，过早 refresh 会锁死 appliedKey 且参数仍为空
                    setTimeout(applyOnce, 220);
                    return;
                }
                if (tryCount >= 30) return;
                setTimeout(function() {
                    waitForTableReady(tryCount + 1);
                }, 100);
            }
            waitForTableReady();
        })();
    }
    
    // 筛选条件变化时自动刷新
    // 利用 Bootstrap Table 的 refresh 方法，会自动调用 queryParams 获取最新参数
    // 参考：https://www.bootstraptable.com/docs/api/methods/#refresh
    // 延迟绑定，避免初始化时设置值触发刷新
    setTimeout(function() {
        // 绑定 change 事件（用于 select）
        $(`.${prefix}_filter`).off('change.toolbar').on('change.toolbar', function() {
            // Bootstrap Table 的 refresh 方法会自动调用 queryParams 获取最新参数
            // 确保表格已初始化再刷新
            if (table.data('bootstrap.table')) {
                // 对于 select，立即刷新（不需要防抖）
                table.bootstrapTable('refresh', {pageNumber: 1});
            }
        });
        // 绑定 blur 事件（用于 input，失去焦点时执行搜索，提高性能）
        $(`.${prefix}_filter`).filter('input').off('blur.toolbar').on('blur.toolbar', function() {
            // 对于输入框，在失去焦点时刷新表格
            // 注意：anchor 同步仍然通过 input.filter_anchor 事件实时更新
            if (table.data('bootstrap.table')) {
                table.bootstrapTable('refresh', {pageNumber: 1});
            }
        });
        }, 500); // 延迟300ms绑定，确保初始化完成且 filter 值已设置
    
    // 搜索框实时搜索（防抖处理）
    if (searchInputId) {
        let searchTimeout;
        const searchInput = $(`#${searchInputId}`);
        
        // 搜索内容缓存键名
        const searchCacheKey = `search_cache_${prefix}_${anchorKey}`;
        
        // 锚参数同步辅助函数：读取（优先从 URL hash，其次从缓存）
        const getAnchorValue = function(key) {
            const urlValue = csg.GetAnchor(key);
            if (urlValue !== null && urlValue !== '') {
                return urlValue;
            }
            // 如果 URL hash 中没有，尝试从缓存读取
            const cacheKey = 'anchor_' + key;
            const cachedValue = csg.store(cacheKey);
            if (cachedValue !== null && cachedValue !== '') {
                return cachedValue;
            }
            return null;
        };
        
        // 锚参数同步辅助函数：写入（同时写入 URL hash 和缓存）
        const setAnchorValue = function(key, value) {
            // 写入 URL hash
            csg.SetAnchor(value, key);
            // 写入缓存（1小时 = 3600000毫秒）
            const cacheKey = 'anchor_' + key;
            if (value === null || value === '') {
                // 清空缓存
                csg.DelStore(cacheKey);
            } else {
                csg.store(cacheKey, value, 3600000); // 1小时缓存
            }
        };
        
        // 搜索内容缓存辅助函数：读取
        const getSearchCacheValue = function() {
            if (searchCacheSeconds === 0) {
                return null; // 不缓存
            }
            const cachedValue = csg.store(searchCacheKey);
            if (cachedValue !== null && cachedValue !== '') {
                return cachedValue;
            }
            return null;
        };
        
        // 搜索内容缓存辅助函数：写入
        const setSearchCacheValue = function(value) {
            if (searchCacheSeconds === 0) {
                return; // 不缓存
            }
            if (value === null || value === '') {
                // 清空缓存
                csg.DelStore(searchCacheKey);
            } else {
                // 根据 searchCacheSeconds 设置缓存时间
                if (searchCacheSeconds === -1) {
                    // 永久缓存（不传 expire 参数）
                    csg.store(searchCacheKey, value);
                } else {
                    // 正数表示缓存的秒数，转换为毫秒
                    csg.store(searchCacheKey, value, searchCacheSeconds * 1000);
                }
            }
        };
        
        // 页面加载时：优先从 URL hash 读取（如果启用了 anchor 同步），其次从搜索内容缓存读取
        let initialSearchValue = null;
        if (enableAnchorSync) {
            // 优先从 URL hash 读取（由 initFilterAnchorSync 处理，这里只处理搜索内容缓存）
            // 注意：如果启用了 enableFilterAnchorSync，搜索框的 anchor 同步由 initFilterAnchorSync 统一处理
        }
        // 如果启用了搜索内容缓存，从缓存读取
        if (searchCacheSeconds !== 0) {
            initialSearchValue = getSearchCacheValue();
        }
        
        // 如果从搜索内容缓存找到了初始值，设置到搜索框并触发搜索
        // 注意：如果启用了 anchor 同步，搜索框的值应该由 initFilterAnchorSync 从 anchor 设置
        if (initialSearchValue !== null && initialSearchValue !== '' && !enableAnchorSync) {
            // 只有在没有启用 anchor 同步时，才从搜索内容缓存设置
            searchInput.val(initialSearchValue);
            // 延迟触发刷新，确保表格已初始化
            setTimeout(function() {
                if (table.data('bootstrap.table')) {
                    table.bootstrapTable('refresh', {pageNumber: 1});
                }
            }, 100);
        }
        
        searchInput.off('input.toolbar').on('input.toolbar', function() {
            const searchValue = searchInput.val();
            
            // 注意：anchor 同步由 initFilterAnchorSync 统一处理（通过 input.filter_anchor 事件）
            // 这里不再单独处理 anchor 同步
            
            // 搜索内容缓存：更新缓存
            setSearchCacheValue(searchValue);
            
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(function() {
                if (table.data('bootstrap.table')) {
                    table.bootstrapTable('refresh', {pageNumber: 1});
                }
            }, 500); // 500ms 防抖
        });
        
        // 搜索框回车键事件（立即搜索）
        searchInput.off('keypress.toolbar').on('keypress.toolbar', function(e) {
            if (e.keyCode === 13 || e.which === 13) {
                e.preventDefault();
                // 清除防抖定时器
                clearTimeout(searchTimeout);
                // 立即触发搜索
                if (table.data('bootstrap.table')) {
                    table.bootstrapTable('refresh', {pageNumber: 1});
                }
            }
        });
    }
    
    // 注意：hashchange 事件由 initFilterAnchorSync 统一处理，这里不再单独处理
    // 搜索内容缓存的同步在 initFilterAnchorSync 的 hashchange 处理中完成
    
    // 表格加载完成后初始化Bootstrap 5 tooltips（使用命名空间事件，防止重复绑定）
    table.off('post-body.bs.table.toolbar').on('post-body.bs.table.toolbar', function(){
        // 表格刷新后重新初始化 tooltip
        if (window.autoTooltips) {
            window.autoTooltips.refresh();
        }
    });
    
    // 注意：不要在这里执行 customHandlers 中的函数！
    // clear、refresh 等处理器应该只在用户操作时通过事件触发，而不是在初始化时执行
    // 如果需要在初始化时执行某些逻辑，应该使用专门的 'init' 处理器
    if (customHandlers && typeof customHandlers === 'object' && typeof customHandlers.init === 'function') {
        // 只执行 init 处理器（如果存在）
        customHandlers.init();
    }
}

/**
 * 初始化Bootstrap Table工具栏功能（客户端分页）
 * @param {Object} config - 配置对象
 * @param {string} config.tableId - 表格ID
 * @param {string} config.prefix - 按钮和输入框ID前缀
 * @param {Array} config.filterSelectors - 筛选选择器数组，如 ['spj', 'defunct']
 * @param {string} config.searchInputId - 搜索框ID
 * @param {Object} config.searchFields - 搜索字段配置，如 {content: 'content', team_id: 'team_id'}
 * @param {Function} config.customFilterAlgorithm - 自定义筛选算法（存在时仍会为 .{prefix}_filter / 搜索框绑定 applyClientFilter；expsys 等页面可另绑命名空间事件协同）
 * @param {Object} config.customHandlers - 自定义事件处理器
 * @param {boolean} config.enableFilterAnchorSync - 是否启用筛选组件锚参数同步（默认true）
 */
function initBootstrapTableClientToolbar(config) {
    let {
        tableId,
        prefix,
        filterSelectors = [],
        searchInputId,
        searchFields = {},
        customFilterAlgorithm = null,
        customHandlers = {},
        enableFilterAnchorSync = true  // 默认启用筛选组件 anchor 同步
    } = config;
    
    // 如果 prefix 没有提供，根据当前 URL 计算一个简短的 prefix
    if (!prefix || prefix === '') {
        prefix = calculatePrefixFromUrl();
    }
    
    const table = $(`#${tableId}`);
    
    // 工具栏按钮事件处理
    $(function() {
        // 刷新按钮 - 支持自定义处理器
        if (customHandlers.refresh && typeof customHandlers.refresh === 'function') {
            $(`#${prefix}_refresh`).on('click', function() {
                customHandlers.refresh();
            });
        } else {
            $(`#${prefix}_refresh`).on('click', function() {
                table.bootstrapTable('refresh');
            });
        }
        
        // 清空筛选条件按钮 - 支持自定义处理器
        if (customHandlers.clear && typeof customHandlers.clear === 'function') {
            $(`#${prefix}_clear`).on('click', function() {
                customHandlers.clear();
            });
        } else {
            $(`#${prefix}_clear`).on('click', function() {
                filterSelectors.forEach(selector => {
                    $(`select[name="${selector}"]`).val('-1');
                });
                if (searchInputId) {
                    $(`#${searchInputId}`).val('');
                }
                // 如果启用了筛选组件锚参数同步，清空时也清除所有筛选组件的锚参数（使用namespace）
                if (enableFilterAnchorSync) {
                    $(`.${prefix}_filter`).each(function() {
                        const $elem = $(this);
                        const name = $elem.attr('name');
                        if (name) {
                            // 使用带namespace的anchor参数名
                            const anchorKey = `${prefix}_${name}`;
                            const anchorVal = csg.GetAnchor(anchorKey);
                            if (anchorVal !== null && anchorVal !== '') {
                                csg.SetAnchor(null, anchorKey);
                            }
                        }
                    });
                }
                // 清空bootstrap-table的筛选
                table.bootstrapTable('filterBy', {});
            });
        }
        
        // 应用筛选按钮
        $(`#${prefix}_filter`).on('click', function() {
            applyClientFilter();
        });
        
        // 筛选条件变化时自动应用客户端筛选（含自定义 filterAlgorithm）。
        // 此前在 customFilterAlgorithm 存在时不绑定 change，依赖「外部处理」，但 admin/csgoj 比赛列表未另绑，导致改筛选不生效、仅刷新后靠 anchor 才生效。
        // 使用命名空间避免重复 init 叠加；程序化回填 anchor 时见 initFilterAnchorSync 的 initializing-from-anchor，此处跳过以免与 post-body 自动应用打架。
        $(`.${prefix}_filter`).off('change.bsTableClientToolbar').on('change.bsTableClientToolbar', function() {
            if ($(this).data('initializing-from-anchor')) {
                return;
            }
            applyClientFilter();
        });
        
        // 搜索框实时搜索（防抖处理）
        if (searchInputId) {
            let searchTimeout;
            $(`#${searchInputId}`).off('input.bsTableClientToolbar').on('input.bsTableClientToolbar', function() {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(function() {
                    applyClientFilter();
                }, 500); // 500ms 防抖
            });
        }
        
        // 表格加载完成后初始化Bootstrap 5 tooltips
        table.on('post-body.bs.table', function(){
            // 表格刷新后重新初始化 tooltip
            if (window.autoTooltips) {
                window.autoTooltips.refresh();
            }
        });
        
        // 注意：不要在这里执行 customHandlers 中的函数！
        // clear、refresh 等处理器应该只在用户操作时通过事件触发，而不是在初始化时执行
        // 如果需要在初始化时执行某些逻辑，应该使用专门的 'init' 处理器
        if (customHandlers && typeof customHandlers === 'object' && typeof customHandlers.init === 'function') {
            // 只执行 init 处理器（如果存在）
            customHandlers.init();
        }
    });
    
    // 应用客户端筛选
    function applyClientFilter() {
        // 获取搜索文本
        let searchText = '';
        if (searchInputId) {
            const search = $(`#${searchInputId}`).val();
            if (search && search.trim() !== '') {
                searchText = search.trim();
            }
        }
        
        // 构建筛选数据
        let filterData = {};
        // 添加搜索条件
        if (searchText) {
            // 如果有自定义搜索字段配置，使用它
            if (Object.keys(searchFields).length > 0) {
                Object.keys(searchFields).forEach(field => {
                    filterData[field] = searchText;
                });
            }
            // 同时添加通用搜索，确保搜索所有字段
            filterData.search = searchText;
        }
        
        // 添加筛选条件（如果提供了自定义筛选算法，则获取所有筛选条件；否则只获取 filterSelectors 中的）
        if (customFilterAlgorithm) {
            // 使用自定义筛选算法时，获取所有筛选条件（包括不在 filterSelectors 中的）
            $(`.${prefix}_filter`).each(function() {
                const name = $(this).attr('name');
                const val = $(this).val();
                if (name && val != null && val !== '') {
                    if (this.tagName === 'SELECT') {
                        if (val !== '-1') {
                            filterData[name] = val;
                        }
                    } else {
                        const trimmedVal = val.trim();
                        if (trimmedVal !== '') {
                            filterData[name] = trimmedVal;
                        }
                    }
                }
            });
        } else {
            // 使用默认筛选算法时，只获取 filterSelectors 中的筛选条件
            filterSelectors.forEach(selector => {
                const value = $(`select[name="${selector}"]`).val();
                if (value != -1) {
                    filterData[selector] = value;
                }
            });
        }
        
        // 应用筛选
        if (customFilterAlgorithm && typeof customFilterAlgorithm === 'function') {
            // 使用自定义筛选算法
            table.bootstrapTable('filterBy', filterData, {
                filterAlgorithm: customFilterAlgorithm
            });
        } else {
                // 使用默认筛选算法
                // 参考：https://www.bootstraptable.com/docs/api/methods/#filterby
                table.bootstrapTable('filterBy', filterData, {
                    filterAlgorithm: function(row, filters) {
                        // 边界检查：如果 row 不存在，不显示该行
                        if (!row || typeof row !== 'object') {
                            return false;
                        }
                        
                        // 检查filters是否存在
                        if (!filters) {
                            return true; // 没有筛选条件时显示所有行
                        }
                        
                        let searchMatch = true; // 搜索条件匹配结果
                        let filterMatch = true; // 筛选条件匹配结果
                        
                        // 处理搜索条件（任意字段匹配 - OR 逻辑）
                        let hasSearchCondition = false;
                        
                        // 处理通用搜索（filters.search）
                        if (filters.search !== undefined && filters.search !== '') {
                            hasSearchCondition = true;
                            const searchLower = filters.search.toLowerCase();
                            searchMatch = false; // 初始化为false，任意字段匹配就为true
                            
                            // 搜索所有字段（性能考虑：如果字段很多，可以考虑限制搜索字段）
                            Object.keys(row).forEach(key => {
                                // 跳过函数类型的值
                                if (row[key] != null && typeof row[key] !== 'function') {
                                    try {
                                        if (row[key].toString().toLowerCase().includes(searchLower)) {
                                            searchMatch = true;
                                        }
                                    } catch (e) {
                                        // 如果转换失败，跳过该字段
                                    }
                                }
                            });
                        }
                        
                        // 处理自定义搜索字段（searchFields配置的字段）
                        if (Object.keys(searchFields).length > 0) {
                            Object.keys(searchFields).forEach(field => {
                                if (filters[field] !== undefined && filters[field] !== '') {
                                    hasSearchCondition = true;
                                    const searchLower = filters[field].toLowerCase();
                                    const fieldValue = row[searchFields[field]];
                                    
                                    if (fieldValue != null) {
                                        const searchableText = objectToString(fieldValue);
                                        if (searchableText.toLowerCase().includes(searchLower)) {
                                            searchMatch = true;
                                        }
                                    }
                                }
                            });
                        }
                        
                        // 处理筛选条件（不同筛选器之间是交集 - AND 逻辑）
                        let hasFilterCondition = false;
                        filterSelectors.forEach(selector => {
                            if (filters[selector] !== undefined && filters[selector] !== '' && filters[selector] !== '-1') {
                                hasFilterCondition = true;
                                const rowValue = row[selector];
                                
                                // 对于数组字段（如langlist），需要特殊处理
                                if (selector === 'langlist' && Array.isArray(rowValue)) {
                                    // 检查数组中是否包含筛选值
                                    if (!rowValue.includes(filters[selector])) {
                                        filterMatch = false;
                                    }
                                } else if (rowValue != null) {
                                    // 直接比较，支持字符串和数字
                                    // 使用 != 而不是 !== 以支持类型转换（如 '1' == 1）
                                    if (String(rowValue) != String(filters[selector])) {
                                        filterMatch = false;
                                    }
                                } else {
                                    // 如果行中该字段为 null/undefined，不匹配
                                    filterMatch = false;
                                }
                            }
                        });
                        
                        // 如果没有搜索条件，搜索匹配为true
                        if (!hasSearchCondition) {
                            searchMatch = true;
                        }
                        
                        // 如果没有筛选条件，筛选匹配为true
                        if (!hasFilterCondition) {
                            filterMatch = true;
                        }
                        
                        // 搜索和筛选都匹配才显示该行
                        return searchMatch && filterMatch;
                    }
                });
        }
    }
    
    // 筛选组件锚参数同步（如果启用）
    if (enableFilterAnchorSync) {
        initFilterAnchorSync({
            tableId: tableId,
            prefix: prefix,
            table: table,
            onRefresh: function() {
                applyClientFilter();
            }
        });

        // 关键修复：当 URL anchor 已存在筛选条件（例如“搜索后刷新页面”），
        // initFilterAnchorSync 只会回填控件值，但不会自动触发表格筛选。
        // 这里在表格初始化/渲染完成后，自动应用一次筛选，确保刷新后也能看到数据。
        (function autoApplyClientFilterFromAnchorOnLoad() {
            // 只注册一次等待逻辑
            const requestedKey = `${tableId}_${prefix}_autoApplyFromAnchor_requested`;
            const appliedKey = `${tableId}_${prefix}_autoApplyFromAnchor_applied`;
            if (window[requestedKey]) return;
            window[requestedKey] = true;

            // csg 未加载时无法读取 anchor，直接跳过
            if (typeof csg === 'undefined' || typeof csg.GetAnchor !== 'function') return;

            // 判断是否存在任何有效的 anchor 筛选值（排除空值和默认值）
            let hasAnchorFilter = false;
            const $filters = $(`.${prefix}_filter`);
            $filters.each(function() {
                const name = $(this).attr('name');
                if (!name) return;
                const namespacedKey = `${prefix}_${name}`;
                const v1 = csg.GetAnchor(namespacedKey);
                const v2 = csg.GetAnchor(name); // 向后兼容（旧格式）
                const val = (v1 !== null && v1 !== '') ? v1 : v2;
                if (val !== null && val !== '' && val !== '-1') {
                    hasAnchorFilter = true;
                    return false; // break
                }
            });
            if (!hasAnchorFilter) return;

            function applyOnce() {
                if (window[appliedKey]) return;
                if (!table || !table.data('bootstrap.table')) return;
                applyClientFilter();
                // 保险：应用筛选后回到第一页，避免 cookie 还原到越界页导致“空表”
                try {
                    table.bootstrapTable('selectPage', 1);
                } catch (e) {}
                window[appliedKey] = true;
            }

            // 优先在表格渲染完成后执行（更稳定），同时加一个短延迟兜底
            function waitForTableReady(tryCount = 0) {
                if (table && table.data('bootstrap.table')) {
                    table.one('post-body.bs.table.auto_apply_anchor', function() {
                        applyOnce();
                    });
                    setTimeout(applyOnce, 0);
                    return;
                }
                if (tryCount >= 30) return; // 最多等约 3 秒
                setTimeout(function() {
                    waitForTableReady(tryCount + 1);
                }, 100);
            }
            waitForTableReady();
        })();
    }
}

/**
 * 页码跳转功能
 * @param {string} tableId - 表格ID
 * @param {string} jumpButtonId - 跳转按钮ID
 * @param {string} pageInputId - 页码输入框ID
 */
function initPageJump(tableId, jumpButtonId, pageInputId) {
    const table = $(`#${tableId}`);
    const jumpButton = $(`#${jumpButtonId}`);
    const pageInput = $(`#${pageInputId}`);
    
    function jumpPage() {
        var jump_page = pageInput.val();
        if (typeof(jump_page) != 'undefined' && !isNaN(jump_page)) {
            if (jump_page.length == 0) {
                jump_page = 1;
            } else {
                jump_page = parseInt(jump_page);
                if (jump_page < 1) {
                    jump_page = 1;
                } else if (jump_page > table.bootstrapTable('getOptions')['totalPages']) {
                    jump_page = table.bootstrapTable('getOptions')['totalPages'];
                }
            }
            table.bootstrapTable('selectPage', jump_page);
            pageInput.val(jump_page);
        }
    }
    
    jumpButton.on('click', jumpPage);
    pageInput.on('keydown', function(e) {
        if (e.keyCode == '13') {
            jumpPage();
        }
    });
}



function createDateTimeFormatter(config) {
    return function(value, row, index, field) {
        if (!value || typeof(value) != 'string' || value.trim() === '') {
            return '<span class="text-muted">-</span>';
        }
        var rawTrim = value.trim();
        var ms = (typeof CsgNaiveAppTzToUtcMs === 'function') ? CsgNaiveAppTzToUtcMs(rawTrim) : NaN;
        var datePart;
        var timePart;
        var tzHtml = '';
        if (Number.isFinite(ms) && typeof DateFormat === 'function') {
            var loc = new Date(ms);
            var y2 = String(loc.getFullYear()).slice(-2);
            datePart = y2 + '-' + String(loc.getMonth() + 1).padStart(2, '0') + '-' + String(loc.getDate()).padStart(2, '0');
            timePart = String(loc.getHours()).padStart(2, '0') + ':' + String(loc.getMinutes()).padStart(2, '0') + ':' + String(loc.getSeconds()).padStart(2, '0');
            var tzLab = (typeof CsgLocalUtcOffsetLabel === 'function')
                ? CsgLocalUtcOffsetLabel(ms)
                : ((typeof CsgLocalTzOffsetSuffix === 'function')
                    ? String(CsgLocalTzOffsetSuffix(ms)).replace(/^\s*[·•]\s*/, '').trim()
                    : '');
            if (tzLab) {
                var esc = String(tzLab).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
                tzHtml = '<div class="csg-datetime-tz-row"><span class="badge rounded-2 bg-light text-muted border fw-normal csg-tz-tag">' + esc + '</span></div>';
            }
        } else {
            var legacy = rawTrim.length >= 2 ? rawTrim.substring(2) : rawTrim;
            var parts = legacy.split(' ');
            if (parts.length !== 2) {
                return legacy;
            }
            datePart = parts[0];
            timePart = parts[1];
        }

        // 根据配置返回不同优先级的显示，但保持上下位置一致
        if (config.priority === 'date') {
            // 日期优先：日期显著，时间次要，时区 tag 独占一行
            return `<div style="font-size: ${window.DATE_TIME_CONFIG.FONT_SIZE_PRIMARY}; line-height: ${window.DATE_TIME_CONFIG.LINE_HEIGHT};">
                        <div class="fw-bold">${datePart}</div>
                        <div class="text-muted" style="font-size: ${window.DATE_TIME_CONFIG.FONT_SIZE_SECONDARY};">${timePart}</div>
                        ${tzHtml}
                    </div>`;
        } else if (config.priority === 'time') {
            // 时间优先：时间显著，日期次要
            return `<div style="font-size: ${window.DATE_TIME_CONFIG.FONT_SIZE_PRIMARY}; line-height: ${window.DATE_TIME_CONFIG.LINE_HEIGHT};">
                        <div class="text-muted" style="font-size: ${window.DATE_TIME_CONFIG.FONT_SIZE_SECONDARY};">${datePart}</div>
                        <div class="fw-bold">${timePart}</div>
                        ${tzHtml}
                    </div>`;
        } else if (config.priority === 'both') {
            // 两者都显著：日期和时间都加粗显示
            return `<div style="font-size: ${window.DATE_TIME_CONFIG.FONT_SIZE_PRIMARY}; line-height: ${window.DATE_TIME_CONFIG.LINE_HEIGHT};">
                        <div class="fw-bold">${datePart}</div>
                        <div class="fw-bold">${timePart}</div>
                        ${tzHtml}
                    </div>`;
        } else {
            // 平衡显示：两者都不显著
            return `<div style="font-size: ${window.DATE_TIME_CONFIG.FONT_SIZE_SECONDARY}; line-height: ${window.DATE_TIME_CONFIG.LINE_HEIGHT};">
                        <div>${datePart}</div>
                        <div class="text-muted">${timePart}</div>
                        ${tzHtml}
                    </div>`;
        }
    };
}

// 日期优先formatter（年月日内容显著）
function FormatterDate(value, row, index, field) {
    return createDateTimeFormatter({ priority: 'date' })(value, row, index, field);
}

// 时间优先formatter（时分秒内容显著）
function FormatterTime(value, row, index, field) {
    return createDateTimeFormatter({ priority: 'time' })(value, row, index, field);
}

// 两者都显著formatter（日期和时间都加粗）
function FormatterDateTimeBoth(value, row, index, field) {
    return createDateTimeFormatter({ priority: 'both' })(value, row, index, field);
}

// 平衡formatter（两者都不显著）
function FormatterDateTime(value, row, index, field) {
    return createDateTimeFormatter({ priority: 'balanced' })(value, row, index, field);
}
// **************************************************
// bootstrap-table常用formatter
function AutoId(value, row, index, field) {
    return index + 1;
}
function FormatterIndex(value, row, index, field) {
    return index + 1;
}
function FormatterIdx(value, row, index, field) {
    return index + 1;
}
function FormatterNoWrap(value, row, index, field) {
    return `<div style="white-space:nowrap;">${value}</div>`;
}
function FormatterDomSantize(value, row, index, field) {
    return DomSantize(value);   // 在global.js
}

// ========================================
// Admin 列表操作列：统一样式与工厂（problem/contest/news 等复用）
// ========================================
// 样式常量：编辑=outline-primary，复制=outline-warning，附件=outline-info，无权限=outline-secondary disabled
window.ADMIN_LIST_BTN = {
    editClass: 'btn btn-sm btn-outline-primary',
    copyClass: 'btn btn-sm btn-outline-warning',
    attachClass: 'btn btn-sm btn-outline-info',
    disabledClass: 'btn btn-sm btn-outline-secondary disabled',
    iconEdit: 'bi bi-pencil-square',
    iconCopy: 'bi bi-files',
    iconAttach: 'bi bi-paperclip',
    iconLock: 'bi bi-lock'
};

/** 无权限时占位（锁图标） */
function createAdminDisabledSpan(title) {
    var t = title || '无权限(No Permission)';
    return '<span class="' + window.ADMIN_LIST_BTN.disabledClass + '" title="' + t + '"><i class="' + window.ADMIN_LIST_BTN.iconLock + '"></i></span>';
}

/**
 * 编辑按钮（链接）：统一样式 outline-primary + 铅笔图标
 * @param {Object} opts - { url: string, title: string, disabled: boolean }
 */
function createAdminEditBtn(opts) {
    if (opts.disabled) return createAdminDisabledSpan(opts.disabledTitle || '无权限编辑(No Permission)');
    var url = opts.url || '#';
    var title = opts.title || '编辑(Edit)';
    return '<a href="' + url + '" class="' + window.ADMIN_LIST_BTN.editClass + '" title="' + title + '"><i class="' + window.ADMIN_LIST_BTN.iconEdit + '"></i></a>';
}

/**
 * 复制按钮（链接）：统一样式 outline-warning + 复制图标
 * @param {Object} opts - { url: string, title: string, disabled: boolean }
 */
function createAdminCopyBtn(opts) {
    if (opts.disabled) return createAdminDisabledSpan(opts.disabledTitle || '无权限复制(No Permission)');
    var url = opts.url || '#';
    var title = opts.title || '复制(Copy)';
    return '<a href="' + url + '" class="' + window.ADMIN_LIST_BTN.copyClass + '" title="' + title + '"><i class="' + window.ADMIN_LIST_BTN.iconCopy + '"></i></a>';
}

/**
 * 附件按钮（弹窗）：统一样式 outline-info + 回形针图标，需配合 data-modal-url / data-modal-title 使用
 * @param {Object} opts - { modalUrl: string, modalTitle: string, title: string, disabled: boolean }
 */
function createAdminAttachBtn(opts) {
    if (opts.disabled) return createAdminDisabledSpan(opts.disabledTitle || '无权限管理附件(No Permission)');
    var modalUrl = opts.modalUrl || '#';
    var modalTitle = opts.modalTitle || '';
    var title = opts.title || '附件管理 (File Manager)';
    return '<button type="button" class="' + window.ADMIN_LIST_BTN.attachClass + '" data-modal-url="' + modalUrl + '" data-modal-title="' + modalTitle + '" title="' + title + '"><i class="' + window.ADMIN_LIST_BTN.iconAttach + '"></i></button>';
}

// 通用defunct状态formatter生成器
// @param {Object} config - 配置对象
// @param {string} config.idField - ID字段名（如 'problem_id', 'contest_id', 'course_id'）
// @param {string} config.publicText - 公开状态中文文本
// @param {string} config.hiddenText - 隐藏状态中文文本
// @param {string} config.publicTextEn - 公开状态英文文本
// @param {string} config.hiddenTextEn - 隐藏状态英文文本
// @param {string} [config.itemName] - 可选的 item_name 属性值（用于 change_status 按钮，如 'course', 'contest'）
function createDefunctFormatter(config) {
    return function(value, row, index, field) {
        var isPublic = row.defunct == '0';
        var iconClass = isPublic ? 'bi bi-unlock-fill' : 'bi bi-lock-fill';
        var currentText = isPublic ? config.publicText : config.hiddenText;
        var currentTextEn = isPublic ? config.publicTextEn : config.hiddenTextEn;
        var nextText = isPublic ? config.hiddenText : config.publicText;
        var nextTextEn = isPublic ? config.hiddenTextEn : config.publicTextEn;
        var titleStr = '当前为' + currentText + '，点击改为' + nextText + ' (' + currentTextEn + ', click to change to ' + nextTextEn + ')';
        var itemNameAttr = config.itemName ? ' item_name="' + config.itemName + '"' : '';
        if (row.is_admin) {
            return '<div class="d-flex justify-content-center">' +
                '<button type="button" field="defunct"' + itemNameAttr + ' itemid="' + (row[config.idField] ?? '') + '" ' +
                'class="change_status btn btn-sm change-status-icon-btn ' + (isPublic ? 'btn-success' : 'btn-warning') + '" ' +
                'status="' + row.defunct + '" title="' + titleStr + '">' +
                '<i class="' + iconClass + '"></i></button></div>';
        }
        return '<div class="d-flex justify-content-center">' +
            '<span class="change-status-icon-readonly ' + (isPublic ? 'text-success' : 'text-warning') + '" title="' + titleStr + '">' +
            '<i class="' + iconClass + '"></i></span></div>';
    };
}

// 题目defunct状态formatter（公开/隐藏）
function FormatterDefunctPro(value, row, index, field) {
    return createDefunctFormatter({
        idField: 'problem_id',
        publicText: '公开',
        hiddenText: '隐藏',
        publicTextEn: 'Public',
        hiddenTextEn: 'Hidden',
        itemName: 'problem'
    })(value, row, index, field);
}

// 比赛defunct状态formatter（启用/禁用）
function FormatterDefunctContest(value, row, index, field) {
    return createDefunctFormatter({
        idField: 'contest_id',
        publicText: '启用',
        hiddenText: '禁用',
        publicTextEn: 'Public',
        hiddenTextEn: 'Hidden',
        itemName: 'contest'
    })(value, row, index, field);
}


// 队伍ID formatter（带链接）
function FormatterTeamId(value, row, index, field) {
    if (row.user_info_url) {
        return `<a href="${row.user_info_url}">${value}</a>`;
    }
    return value;
}

// ========================================
// Bootstrap Table 自动刷新和宽度管理功能
// ========================================

/**
 * 重置 Bootstrap Table 宽度
 * @param {jQuery} table - 表格 jQuery 对象
 * @param {jQuery} tableDiv - 表格容器 jQuery 对象
 * @returns {boolean} - 是否成功重置宽度
 */
function ResetBootstrapTableWidth(table, tableDiv) {
    if (!table || !table.length || !tableDiv || !tableDiv.length) {
        return false;
    }
    
    const tableElement = table[0];
    const tableDivWidth = tableDiv.width();
    
    if (tableElement && tableElement.scrollWidth && tableElement.scrollWidth > tableDivWidth) {
        tableDiv.width(tableElement.scrollWidth + 20);
        return true;
    }
    return false;
}

/**
 * 为带有 bootstraptable_refresh_local class 的表格初始化 F5 刷新和宽度管理功能
 * 自动检测页面中所有带有该 class 的表格并绑定相应功能
 */
(function() {
    // 全局状态：确保 F5 和 resize 事件监听器只绑定一次
    let globalHandlersInitialized = false;
    const tableWidthStates = new Map();
    let resizeTimeout;
    
    /**
     * 初始化单个表格的宽度管理功能
     * @param {jQuery} $table - 表格 jQuery 对象
     */
    function initTableWidthManagement($table) {
        const tableId = $table.attr('id') || `table_${Date.now()}_${Math.random()}_${Math.random()}`;
        const $tableDiv = $table.closest('.bootstrap-table');
        
        // 如果已经初始化过，跳过
        if ($table.data('refresh-local-initialized')) {
            return;
        }
        $table.data('refresh-local-initialized', true);
        
        // 初始化宽度状态
        tableWidthStates.set(tableId, { widthAlreadyReset: false });
        
        // 表格加载完成后重置宽度
        $table.on('post-body.bs.table.refresh-local', function() {
            const state = tableWidthStates.get(tableId);
            if (state && !state.widthAlreadyReset) {
                if (ResetBootstrapTableWidth($table, $tableDiv)) {
                    state.widthAlreadyReset = true;
                }
            }
        });
        
        // 表格加载成功后重置宽度
        $table.on('load-success.bs.table.refresh-local', function() {
            const state = tableWidthStates.get(tableId);
            if (state && !state.widthAlreadyReset) {
                if (ResetBootstrapTableWidth($table, $tableDiv)) {
                    state.widthAlreadyReset = true;
                }
            }
        });
        
        // 表格刷新时重置宽度状态
        $table.on('refresh.bs.table.refresh-local', function() {
            const state = tableWidthStates.get(tableId);
            if (state) {
                state.widthAlreadyReset = false;
            }
        });
    }
    
    /**
     * 初始化全局事件处理器（F5 刷新和窗口 resize）
     */
    function initGlobalHandlers() {
        if (globalHandlersInitialized) {
            return;
        }
        globalHandlersInitialized = true;
        
        // F5 刷新功能：全局事件监听（只绑定一次）
        $(window).on('keydown.bsTableRefreshLocal', function(e) {
            // F5 键的 keyCode 是 116
            if (e.keyCode === 116 && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                
                // 刷新所有带有 bootstraptable_refresh_local class 的表格
                $('.bootstraptable_refresh_local').each(function() {
                    const $table = $(this);
                    // 确保表格已初始化
                    if ($table.data('bootstrap.table')) {
                        $table.bootstrapTable('refresh');
                    }
                });
            }
        });
        
        // 窗口 resize 时重置视图和宽度
        $(window).on('resize.bsTableRefreshLocal', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
                $('.bootstraptable_refresh_local').each(function() {
                    const $table = $(this);
                    const $tableDiv = $table.closest('.bootstrap-table');
                    
                    if ($table.data('bootstrap.table')) {
                        // 使用 resetView 重置表格视图（包括列宽等）
                        $table.bootstrapTable('resetView');
                        // 重置宽度状态，允许重新计算
                        const tableId = $table.attr('id');
                        if (tableId) {
                            const state = tableWidthStates.get(tableId);
                            if (state) {
                                state.widthAlreadyReset = false;
                            }
                        }
                        // 重新计算并设置宽度
                        ResetBootstrapTableWidth($table, $tableDiv);
                    }
                });
            }, 150); // 防抖处理
        });
    }
    
    /**
     * 初始化所有带有 bootstraptable_refresh_local class 的表格
     */
    function initBootstrapTableRefreshLocal() {
        const refreshTables = $('.bootstraptable_refresh_local');
        
        if (refreshTables.length === 0) {
            return;
        }
        
        // 初始化全局事件处理器
        initGlobalHandlers();
        
        // 为每个表格初始化宽度管理功能
        refreshTables.each(function() {
            initTableWidthManagement($(this));
        });
    }
    
    // 页面加载完成后自动初始化
    $(function() {
        // 延迟初始化，确保所有表格都已渲染
        setTimeout(function() {
            initBootstrapTableRefreshLocal();
        }, 100);
        
        // 监听动态添加的表格（使用 MutationObserver）
        if (typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver(function(mutations) {
                let shouldInit = false;
                mutations.forEach(function(mutation) {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(function(node) {
                            if (node.nodeType === 1) { // Element node
                                const $node = $(node);
                                if ($node.hasClass('bootstraptable_refresh_local') || 
                                    $node.find('.bootstraptable_refresh_local').length > 0) {
                                    shouldInit = true;
                                }
                            }
                        });
                    }
                });
                if (shouldInit) {
                    setTimeout(function() {
                        initBootstrapTableRefreshLocal();
                    }, 100);
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    });
})();
