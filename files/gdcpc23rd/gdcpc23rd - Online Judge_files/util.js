var csg = {
    /**
     * 解析 AJAX 请求参数
     * 支持两种模式：
     * 1. 传统模式：ajax(method, url, data, headers, dtype, contentType)
     * 2. 对象模式：ajax({method, url, data, headers, dtype, contentType})
     * @returns {object} 解析后的参数对象 {method, url, data, headers, dtype, contentType}
     */
    _parseAjaxParams: function(...args) {
        // 如果第一个参数是对象且包含 url 或 method 属性，则认为是对象模式
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) && (args[0].url || args[0].method)) {
            const config = args[0];
            return {
                method: config.method || 'GET',
                url: config.url || '',
                data: config.data !== undefined ? config.data : {},
                headers: config.headers !== undefined ? config.headers : {},
                dtype: config.dtype !== undefined ? config.dtype : 'json',
                contentType: config.contentType !== undefined ? config.contentType : 'json'
            };
        } else {
            // 传统模式：method, url, data, headers, dtype, contentType
            // 处理默认参数：如果参数是 undefined，使用默认值
            return {
                method: args[0] !== undefined ? args[0] : 'GET',
                url: args[1] !== undefined ? args[1] : '',
                data: args[2] !== undefined ? args[2] : {},
                headers: args[3] !== undefined ? args[3] : {},
                dtype: args[4] !== undefined ? args[4] : 'json',
                contentType: args[5] !== undefined ? args[5] : 'json'
            };
        }
    },
    
    // 统一的 AJAX 请求方法，支持 then 和 await
    // 支持两种调用方式：
    // 1. 传统模式：ajax(method, url, data, headers, dtype, contentType)
    // 2. 对象模式：ajax({method, url, data, headers, dtype, contentType})
    // contentType: 'json' | 'form' | 'formdata' | 'blob' | null (null 表示不设置，让浏览器自动处理)
    ajax: async function(...args) {
        // 解析参数（支持传统模式和对象模式）
        const params = this._parseAjaxParams(...args);
        let {method, url, data, headers, dtype, contentType} = params;
        // 默认 headers，始终包含 X-Requested-With
        let defaultHeaders = {'X-Requested-With': 'XMLHttpRequest'};
        
        let fetchBody = {
            method: method,
            headers: {},
            // 统一携带登录态（跨端口同域导出附件需要 Cookie）
            credentials: 'include',
        };
        
        // 处理 GET 请求
        if(method.toLowerCase() == 'get') {
            let tmp = this.Json2Url(data);
            if(tmp !== undefined) {
                if(url.indexOf("?") != -1) {
                    url += "&"
                } else {
                    url += "?"
                }
                url += tmp;
            }
            // GET 请求不需要设置 Content-Type
            fetchBody.headers = Object.assign({}, defaultHeaders, headers);
        } else {
            // POST/PUT/DELETE 等请求需要处理 body
            let body = null;
            let finalContentType = contentType;
            
            // 自动检测数据类型
            if (data instanceof URLSearchParams) {
                // URLSearchParams 对象
                body = data.toString();
                finalContentType = 'form';
            } else if (data instanceof FormData) {
                // FormData 对象，不设置 Content-Type（让浏览器自动设置 boundary）
                body = data;
                finalContentType = null;
            } else if (dtype === 'blob') {
                // blob 类型，不设置 Content-Type
                finalContentType = null;
            } else if (contentType === 'form' || contentType === 'form-urlencoded') {
                // 明确指定为 form-urlencoded 格式
                body = this.Json2Url(data);
                finalContentType = 'form';
            } else {
                // 默认使用 JSON 格式
                body = JSON.stringify(data);
                finalContentType = 'json';
            }
            
            // 设置 Content-Type
            if (finalContentType === 'form' || finalContentType === 'form-urlencoded') {
                defaultHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
            } else if (finalContentType === 'json') {
                defaultHeaders['Content-Type'] = 'application/json';
            }
            // finalContentType === null 时不设置 Content-Type（用于 FormData 和 blob）
            
            fetchBody.headers = Object.assign({}, defaultHeaders, headers);
            fetchBody['body'] = body;
        }
        
        const response = await fetch(url, fetchBody);
        
        // 根据 dtype 返回不同类型的数据
        if(dtype === 'blob') {
            return response;
        } else if(dtype === 'text') {
            return await response.text();
        } else if(dtype === 'json') {
            return await response.json();
        } else {
            // 默认返回原始 Response 对象
            return response;
        }
    },
    /**
     * ThinkPHP JSON 失败（code!=1）：双语约定在 data.msg_cn / data.msg_en（data.flg_bilingual），顶层 msg 常为空。
     * @param {*} ret
     * @param {string} fallbackCn
     * @param {string} fallbackEn
     * @returns {{cn:string,en:string}}
     */
    ajaxErrorBilingualPair: function (ret, fallbackCn, fallbackEn) {
        const d = ret && ret.data;
        if (d && d.flg_bilingual && d.msg_cn != null && d.msg_en != null) {
            return { cn: String(d.msg_cn), en: String(d.msg_en) };
        }
        const m = ret && ret.msg != null ? String(ret.msg).trim() : '';
        if (m) {
            return { cn: m, en: m };
        }
        return { cn: String(fallbackCn != null ? fallbackCn : ''), en: String(fallbackEn != null ? fallbackEn : '') };
    },
    // GET 请求
    // 支持两种调用方式：
    // 1. 传统模式：get(url, data, headers, dtype, contentType)
    // 2. 对象模式：get({url, data, headers, dtype, contentType})
    get: async function(...args) {
        // 如果是对象模式，添加 method；否则在参数前插入 method
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) && (args[0].url || args[0].method)) {
            return this.ajax({...args[0], method: 'GET'});
        } else {
            return this.ajax('GET', ...args);
        }
    },
    // POST 请求
    // 支持两种调用方式：
    // 1. 传统模式：post(url, data, headers, dtype, contentType)
    // 2. 对象模式：post({url, data, headers, dtype, contentType})
    post: async function(...args) {
        // 如果是对象模式，添加 method；否则在参数前插入 method
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) && (args[0].url || args[0].method)) {
            return this.ajax({...args[0], method: 'POST'});
        } else {
            return this.ajax('POST', ...args);
        }
    },
    // PUT 请求
    // 支持两种调用方式：
    // 1. 传统模式：put(url, data, headers, dtype, contentType)
    // 2. 对象模式：put({url, data, headers, dtype, contentType})
    put: async function(...args) {
        // 如果是对象模式，添加 method；否则在参数前插入 method
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) && (args[0].url || args[0].method)) {
            return this.ajax({...args[0], method: 'PUT'});
        } else {
            return this.ajax('PUT', ...args);
        }
    },
    // DELETE 请求
    // 支持两种调用方式：
    // 1. 传统模式：delete(url, data, headers, dtype, contentType)
    // 2. 对象模式：delete({url, data, headers, dtype, contentType})
    delete: async function(...args) {
        // 如果是对象模式，添加 method；否则在参数前插入 method
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) && (args[0].url || args[0].method)) {
            return this.ajax({...args[0], method: 'DELETE'});
        } else {
            return this.ajax('DELETE', ...args);
        }
    },
    Json2Url(data) {
        return new URLSearchParams(data).toString();
    },
    Url2Json() {
        return Object.fromEntries(new URLSearchParams(location.search));
    },
    docready: function(readyfunc) {
        // 会比 $(document).ready() 触发时机更早，慎用
        document.addEventListener("DOMContentLoaded", readyfunc); 
    },
    getdom: function(domstr) {
        let ret = document.querySelectorAll(domstr);
        if(domstr[0] == '#') {
            return ret[0];
        } else if(domstr[0] == '.') {
            // return document.getElementsByClassName(domstr.slice(1));
            return ret;
        } else if(domstr[0] == '/') {
            return document.getElementsByName(domstr.slice(1));
        } else{
            return document.getElementsByTagName(domstr);
        }
        return ret;
    },
    sleep: function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    keydown: function(func) {
        this.on('keydown', func);
    },
    keyup: function(func) {
        this.on('keyup', func);
    },
    // Event Handler
    on: function(eventName, func) {
        window.addEventListener(eventName, func);
    },
    create: function(domstr) {
        return new DOMParser().parseFromString(domstr, "text/html").body.firstElementChild;
    },
    DateFormat: function(date, fmt='yyyy-MM-dd HH:mm:ss') {
        const opt = {
            "y+": date.getFullYear().toString(),      
            "M+": (date.getMonth() + 1).toString(),   
            "d+": date.getDate().toString(),          
            "H+": date.getHours().toString(),         
            "m+": date.getMinutes().toString(),       
            "s+": date.getSeconds().toString()        
        };
        for (let k in opt) {
            ret = new RegExp("(" + k + ")").exec(fmt);
            if (ret) {
                fmt = fmt.replace(ret[1], (ret[1].length == 1) ? (opt[k]) : (opt[k].padStart(ret[1].length, "0")))
            };
        };
        return fmt;
    },
    TimeNow: function(fmt='yyyy-MM-dd HH:mm:ss') {
        return this.DateFormat(new Date(), fmt);
    },
    GetAnchor: function(key=null) {
        // 使用 slice 替代已废弃的 substr
        let anchor_str = window.location.hash.slice(1);
        
        if(key === null) return anchor_str;
        
        // 如果 key 为空字符串，返回 null
        if(key === '') return null;
        
        // 转义 key 中的特殊字符，防止正则表达式注入
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 改进正则表达式：支持参数在开头、中间或结尾
        const reg = new RegExp("(^|#)" + escapedKey + "=([^#]*?)(#|$)", "g");
        const r = anchor_str.match(reg);
        if (r != null && r.length > 0) {
            // 取第一个匹配的结果
            const match = new RegExp("(^|#)" + escapedKey + "=([^#]*?)(#|$)").exec(anchor_str);
            if (match && match[2] !== undefined) {
                try {
                    const decoded = decodeURIComponent(match[2]);
                    return decoded;
                } catch (e) {
                    // 如果解码失败，尝试使用 decodeURI
                    try {
                        const decoded = decodeURI(match[2]);
                        return decoded;
                    } catch (e2) {
                        // 如果都失败，返回原始值
                        return match[2];
                    }
                }
            }
        }
        return null;
    },
    SetAnchor: function(val, key=null) {
        // 处理 null 和 undefined
        if (val === null || val === undefined) {
            val = '';
        }

        let anchor_str = "";
        if(key === null) {
            // 如果 key 为 null，直接设置整个 hash
            anchor_str = val || '';
        } else {
            // 如果 key 为空字符串，不处理
            if(key === '') {
                return;
            }

            // 使用 slice 替代已废弃的 substr
            anchor_str = window.location.hash.slice(1);

            // 转义 key 中的特殊字符，防止正则表达式注入
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const reg = new RegExp("(^|#)" + escapedKey + "=([^#]*?)(#|$)", "g");
            const r = anchor_str.match(reg);

            if(val === null || val === "" || val === '-1') {
                // 删除参数（-1 表示默认值，也应该删除）
                if(r !== null && r.length > 0) {
                    anchor_str = anchor_str.replace(reg, "");
                    // 清理多余的分隔符：移除开头的 #，以及连续的 ##
                    anchor_str = anchor_str.replace(/^#+/, '').replace(/#+/g, '#');
                    // 清理末尾的 #
                    anchor_str = anchor_str.replace(/#$/, '');
                }
            } else {
                // 设置或更新参数值，对值进行 URL 编码
                const encodedVal = encodeURIComponent(String(val));

                if(r !== null && r.length > 0) {
                    // 更新现有参数 - 简化逻辑，直接替换
                    const replacement = '$1' + key + '=' + encodedVal + '$3';
                    anchor_str = anchor_str.replace(reg, replacement);
                } else {
                    // 添加新参数
                    if(anchor_str === "") {
                        anchor_str = key + '=' + encodedVal;
                    } else {
                        anchor_str += '#' + key + '=' + encodedVal;
                    }
                }
            }
        }

        // 设置 hash，如果为空则设置为空字符串而不是 #
        const newHash = anchor_str === '' ? '' : '#' + anchor_str;
        window.location.hash = newHash;
    },
    GetUrlParam: function() {
        const searchURL = location.search; // 获取到URL中的参数串
        const params = new URLSearchParams(searchURL); // 创建一个URLSearchParams对象
        const valueObj = Object.fromEntries(params); // 转换为普通对象
        return valueObj; // 返回对象
    },
    cookie: function(key, value=null) {
        if(value === null) {
            return this.GetCookie(key);
        }
        this.SetCookie(key, value)
    },
    cookie_json: function(key, value=null) {
        if(value === null) {
            return JSON.parse(this.GetCookie(key));
        }
        this.SetCookie(key, JSON.stringify(value));
    },
    // 读取cookie
    GetCookie: function(key, default_v=null) {
        let cookie = document.cookie;
        let cookieName = encodeURIComponent(key) + "=";
        let cookieStart = cookie.indexOf(cookieName);
        let cookieValue = null;
        if (cookieStart > -1) {
            let cookieEnd = cookie.indexOf(";", cookieStart);
            if (cookieEnd == -1) {
                cookieEnd = cookie.length;
            }
            cookieValue = decodeURIComponent(cookie.substring(cookieStart + cookieName.length, cookieEnd));
        } else {
            cookieValue = default_v;
        }
        return cookieValue;
    },
  // 设置cookie
    SetCookie: function(key, value, expires, path, domain, secure) {
        let cookieText = encodeURIComponent(key) + "=" + encodeURIComponent(value);
        if (expires instanceof Date) {
            cookieText += "; expires=" + expires.toUTCString();
        } else if(typeof expires === 'number') {
            var date = new Date();
            date.setTime(date.getTime() + (expires * 60 * 60 * 1000));  // expires表示小时
            cookieText += "; expires=" + date.toUTCString();
        }
        if (path) {
            cookieText += "; path=" + path;
        }
        if (domain) {
            cookieText += "; domain=" + domain;
        }
        if (secure) {
            cookieText += "; secure";
        }
        document.cookie = cookieText;
    },
    // 删除cookie
    DelCookie: function(key, path, domain, secure) {
        this.SetCookie(key, "", new Date(0), path, domain, secure);
    },
    store: function(key, val=null, expire=null) {
        // expire 单位毫秒
        if(val === null) {
            return this.GetStore(key);
        }
        this.SetStore(key, val, expire);
    },
    GetStore: function(key, default_val=null) {
        let val = localStorage.getItem(key);
        if (val) {
            let item = JSON.parse(val);
            if(item.expire != null && Date.now() - item.time > item.expire) {
                localStorage.removeItem(key);
                return null;
            } else {
                return item.data;
            }
        }
        return default_val;

    },
    SetStore: function(key, val, expire=null) {
        const item = {
            data: val,
            time: Date.now(),
            expire: expire
        };
        localStorage.setItem(key, JSON.stringify(item));
    },
    DelStore: function(key) {
        localStorage.removeItem(key);
    },
    
    // 清洗文件名，移除非法字符，处理空白字符
    sanitizeFilename: function(filename) {
        if (!filename) return 'unknown';
        
        // 移除或替换非法文件名字符
        let sanitized = filename.replace(/[<>:"/\\|?*]/g, '');
        
        // 处理空白字符：连续空白字符替换为单个下划线
        sanitized = sanitized.replace(/\s+/g, '_');
        
        // 移除开头和结尾的下划线
        sanitized = sanitized.replace(/^_+|_+$/g, '');
        
        // 如果结果为空，返回默认值
        if (!sanitized) return 'unknown';
        
        return sanitized;
    },
    
    /**
     * 批量并发请求（支持并发控制）
     * 使用并发限制机制控制同时执行的请求数量，避免服务器过载
     * @param {Array} tasks - 任务数组，每个任务是一个对象 {id, requestFn}
     *   - id: 任务标识符（用于结果匹配）
     *   - requestFn: 返回 Promise 的请求函数
     * @param {Object} options - 配置选项
     *   - concurrency: 最大并发数，默认 5
     *   - onProgress: 进度回调函数 (completed, total, currentTask) => void
     * @returns {Promise<Object>} 返回结果对象
     *   - results: 成功结果数组 [{id, data, success: true}]
     *   - errors: 失败结果数组 [{id, error, message, success: false}]
     *   - summary: 汇总信息 {total, successCount, failCount}
     */
    batchRequest: async function(tasks, options = {}) {
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return {
                results: [],
                errors: [],
                summary: { total: 0, successCount: 0, failCount: 0 }
            };
        }
        
        const concurrency = options.concurrency || 5;
        const onProgress = options.onProgress || (() => {});
        
        const results = [];
        const errors = [];
        let completed = 0;
        const total = tasks.length;
        
        // 创建任务队列
        const taskQueue = [...tasks];
        const running = new Set();
        
        // 执行单个任务
        const executeTask = async (task) => {
            const taskId = task.id;
            running.add(taskId);
            
            try {
                const data = await task.requestFn();
                results.push({
                    id: taskId,
                    data: data,
                    success: true
                });
            } catch (error) {
                // 处理不同类型的错误
                let errorMessage = '未知错误';
                if (error && typeof error === 'object') {
                    // 优先使用 msg（ThinkPHP 格式），然后是 message
                    if (error.msg) {
                        errorMessage = error.msg;
                    } else if (error.message) {
                        errorMessage = error.message;
                    } else if (error.code !== undefined && error.code !== 1) {
                        errorMessage = error.msg || '请求失败';
                    }
                } else if (typeof error === 'string') {
                    errorMessage = error;
                }
                
                errors.push({
                    id: taskId,
                    error: error,
                    message: errorMessage,
                    success: false
                });
            } finally {
                running.delete(taskId);
                completed++;
                onProgress(completed, total, task);
            }
        };
        
        // 并发执行任务
        const runNext = async () => {
            while (taskQueue.length > 0 || running.size > 0) {
                // 如果当前运行数小于并发数，且还有待处理任务，则启动新任务
                while (running.size < concurrency && taskQueue.length > 0) {
                    const task = taskQueue.shift();
                    executeTask(task);
                }
                
                // 等待一小段时间，避免忙等待
                if (running.size > 0) {
                    await this.sleep(10);
                }
            }
        };
        
        // 等待所有任务完成
        await runNext();
        
        return {
            results: results,
            errors: errors,
            summary: {
                total: total,
                successCount: results.length,
                failCount: errors.length
            }
        };
    },

    /**
     * 批量顺序调用并节流（每 N 次后短暂等待，避免拥堵与 UI 卡顿）
     * 适用于需逐个调用接口、且希望定期停顿的场景（如批量下载、批量删除）。
     * @param {Array<Function>} tasks - 任务数组，每项为 () => Promise<any>
     * @param {Object} options - 配置选项
     *   - batchSize: 每执行多少个任务后等待一次，默认 5
     *   - waitAfterBatchMs: 每批后的等待毫秒数，默认 300
     *   - onProgress: 进度回调 (completed, total) => void
     * @returns {Promise<Array>} 按顺序的 results 数组（与 tasks 一一对应，失败项为 undefined 或由 task 自行决定）
     */
    batchCallWithThrottle: async function(tasks, options = {}) {
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return [];
        }
        const batchSize = Math.max(1, parseInt(options.batchSize, 10) || 5);
        const waitAfterBatchMs = Math.max(0, parseInt(options.waitAfterBatchMs, 10) || 300);
        const onProgress = options.onProgress || (() => {});
        const total = tasks.length;
        const results = [];
        for (let i = 0; i < tasks.length; i++) {
            try {
                const value = await tasks[i]();
                results.push(value);
            } catch (err) {
                results.push(undefined);
            }
            onProgress(i + 1, total);
            if ((i + 1) % batchSize === 0 && i + 1 < tasks.length) {
                await this.sleep(waitAfterBatchMs);
            }
        }
        return results;
    }
}

// =========================================================
// Hash Color Utilities (Reusable across modules)
// =========================================================
// 说明：
// - 用于根据字符串哈希出“和谐的颜色系”（主要用于 UI 的轻量差异化）
// - 颜色取自 Bootstrap 5 常用色系的近似值，保持整体协调
// - 同时提供自动文字颜色（深/浅）以保证可读性

/**
 * 基础调色板（可按需扩展/替换）
 * 这些颜色覆盖：blue/indigo/purple/pink/red/orange/green/teal/cyan/slate
 */
// 更柔和的配色（与 Bootstrap 5 气质一致，但降低“刺眼”程度）
csg.HASH_COLOR_PALETTE = [
    '#4d7cff', // soft blue
    '#7a5cff', // soft indigo
    '#8a6dd3', // soft purple
    '#e06aa6', // soft pink
    '#e05b65', // soft red
    '#f29a4a', // soft orange
    '#4fb286', // soft green
    '#4cc9b0', // soft teal
    '#5bd3e8', // soft cyan
    '#7b8794', // soft slate
];

/**
 * 字符串哈希（返回非负 32-bit int）
 */
csg.hashString = function(str) {
    str = String(str ?? '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // 32-bit
    }
    return Math.abs(hash);
};

/**
 * 根据字符串得到颜色索引
 */
csg.hashColorIndex = function(str, modulo = 8) {
    const m = Math.max(1, parseInt(modulo, 10) || 1);
    return csg.hashString(str) % m;
};

// ---- color helpers ----
csg._clamp01 = function(v) {
    return Math.max(0, Math.min(1, v));
};

csg._hexToRgb = function(hex) {
    let h = String(hex || '').trim();
    if (h.startsWith('#')) h = h.slice(1);
    if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
};

csg._rgbToHex = function(r, g, b) {
    const toHex = (n) => {
        const v = Math.max(0, Math.min(255, Math.round(n)));
        return v.toString(16).padStart(2, '0');
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * 颜色微调（percent: -0.2~0.2 之类的比例，正=变亮，负=变暗）
 */
csg.adjustHexColor = function(hex, percent) {
    const p = Number(percent) || 0;
    const { r, g, b } = csg._hexToRgb(hex);
    const adj = (c) => c + (p >= 0 ? (255 - c) * p : c * p);
    return csg._rgbToHex(adj(r), adj(g), adj(b));
};

/**
 * 相对亮度（WCAG）
 */
csg.relativeLuminance = function(hex) {
    const { r, g, b } = csg._hexToRgb(hex);
    const srgb = [r, g, b].map(v => v / 255);
    const lin = srgb.map(v => v <= 0.03928 ? (v / 12.92) : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

/**
 * 根据背景色选择文字色（深/浅）
 */
csg.getContrastTextColor = function(bgHex) {
    const lum = csg.relativeLuminance(bgHex);
    // 简化阈值：亮度较高 => 深色字；否则白字
    return lum > 0.55 ? '#212529' : '#ffffff';
};

/**
 * 哈希出“背景/hover/active/文字色”的一套方案
 */
csg.hashColorScheme = function(key, palette = csg.HASH_COLOR_PALETTE) {
    const pal = Array.isArray(palette) && palette.length > 0 ? palette : csg.HASH_COLOR_PALETTE;
    const idx = csg.hashColorIndex(key, pal.length);
    const base = pal[idx];
    // 在柔和基色上再做轻微“粉化/浅化”，更贴合窄侧边栏视觉
    const bg = csg.adjustHexColor(base, 0.10);
    const fg = csg.getContrastTextColor(bg);

    // hover/active 做轻微变化：亮背景略变暗，暗背景略变亮
    const lum = csg.relativeLuminance(bg);
    const hover = csg.adjustHexColor(bg, lum > 0.55 ? -0.06 : 0.06);
    const active = csg.adjustHexColor(bg, lum > 0.55 ? -0.10 : 0.10);

    return { bg, hover, active, fg, idx };
};

/**
 * HTML 转义（拼接到 innerHTML 前）。优先使用 **`global.js`** 的 **`DomSantize`**（**`global_js.php`** 已先于 util 加载）。
 * @param {*} str
 * @returns {string}
 */
csg.escapeHtml = function (str) {
    if (typeof DomSantize === 'function') {
        return DomSantize(str);
    }
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * 根据字符串哈希生成**小标签** HTML（Bootstrap Table 列、筛选 chip 等统一复用；配色基于 **`csg.hashColorScheme`**）。
 * @param {string} text 展示文本
 * @param {string} [hashKey] 参与哈希的键，默认与 text 相同（展示可与哈希键分离，例如展示为「中文 / EN」仍以原始 code 配色）
 * @param {{ allowWrap?: boolean, maxLen?: number, hideWhenEmpty?: boolean, emptyLabel?: string, titleForTooltip?: string, copyAffiliationId?: string }} [opts]
 *   - allowWrap：长文案允许折行（如学校名）；默认不换行 + ellipsis
 *   - maxLen：超出则截断并加 …（title 仍为全文）
 *   - hideWhenEmpty：空串时不输出占位
 *   - emptyLabel：空时占位文案，默认 「—」
 *   - titleForTooltip：悬停 title 全文（默认与展示原文 raw 一致；赛事归属等可传 key 说明）
 *   - copyAffiliationId：非空时加 data-csg-affiliation-id，双击由全局监听复制（ClipboardWrite）
 * @returns {string}
 */
csg.hashTagBadgeHtml = function (text, hashKey, opts) {
    opts = opts || {};
    const raw = String(text ?? '').trim();
    if (!raw) {
        if (opts.hideWhenEmpty) return '';
        const elab = opts.emptyLabel != null ? String(opts.emptyLabel) : '—';
        return '<span class="csg-hash-tag-empty text-muted" aria-hidden="true">' + csg.escapeHtml(elab) + '</span>';
    }
    const key = hashKey != null && String(hashKey).trim() !== '' ? String(hashKey).trim() : raw;
    const scheme = csg.hashColorScheme(key);
    let display = raw;
    const ml = parseInt(opts.maxLen, 10);
    if (ml > 0 && raw.length > ml) {
        display = raw.slice(0, ml) + '…';
    }
    const esc = csg.escapeHtml(display);
    const tipSource = opts.titleForTooltip != null ? String(opts.titleForTooltip) : raw;
    const titleFull = csg.escapeHtml(tipSource).replace(/"/g, '&quot;');
    const wrap = opts.allowWrap
        ? 'white-space:normal;word-break:break-word;'
        : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const mw = opts.maxWidth ? 'max-width:' + String(opts.maxWidth) + ';' : 'max-width:100%;';
    const borderCol = scheme.active || scheme.hover || scheme.bg;
    const copyId =
        opts.copyAffiliationId != null && String(opts.copyAffiliationId).trim() !== ''
            ? String(opts.copyAffiliationId).trim()
            : '';
    const copyAttr = copyId
        ? ' data-csg-affiliation-id="' + csg.escapeHtml(copyId).replace(/"/g, '&quot;') + '"'
        : '';
    const affCls = copyId ? ' csg-hash-tag-badge--affiliation' : '';
    return (
        '<span class="csg-hash-tag-badge' +
        affCls +
        '"' +
        copyAttr +
        ' title="' +
        titleFull +
        '" style="' +
        wrap +
        mw +
        'display:inline-block;padding:0.1em 0.4em;margin:0;border-radius:0.35rem;font-size:0.78em;line-height:1.35;font-weight:600;' +
        'background:' +
        scheme.bg +
        ';color:' +
        scheme.fg +
        ';border:1px solid ' +
        borderCol +
        ';">' +
        esc +
        '</span>'
    );
};

/**
 * 分隔串拆成多段，每段一个哈希标签（如 group_id 列表）。
 * @param {string} joined
 * @param {string|RegExp} [delimiter=/[,，;；]+/]
 * @param {{ allowWrap?: boolean }} [opts]
 * @returns {string}
 */
csg.hashTagBadgeListHtml = function (joined, delimiter, opts) {
    opts = opts || {};
    const d = delimiter != null ? delimiter : /[,，;；\s]+/;
    const raw = String(joined ?? '').trim();
    if (!raw) {
        return csg.hashTagBadgeHtml('', '', { hideWhenEmpty: false });
    }
    const parts = (d instanceof RegExp ? raw.split(d) : raw.split(String(d)))
        .map((s) => s.trim())
        .filter(Boolean);
    if (!parts.length) {
        return csg.hashTagBadgeHtml('', '', { hideWhenEmpty: false });
    }
    const inner = parts
        .map((p) => csg.hashTagBadgeHtml(p, p, { allowWrap: !!opts.allowWrap, maxLen: opts.maxLen }))
        .join('');
    return '<span class="csg-hash-tag-list d-inline-flex flex-wrap align-items-center gap-1">' + inner + '</span>';
};

/**
 * CSV / 分隔串 → 赛事归属 { id, name } 列表（name 来自 catalog，缺省为 id）。
 * @param {string} csv
 * @param {Array<{group_id?:string,id?:string,group_name?:string,name?:string}>|null} catalog
 * @returns {Array<{id:string,name:string}>}
 */
csg.contestGroupAffiliationPairsFromCsv = function (csv, catalog) {
    const map = new Map();
    (catalog || []).forEach(function (g) {
        const id = String(g.group_id != null ? g.group_id : g.id != null ? g.id : '').trim();
        if (!id) return;
        const nm = String(g.group_name != null ? g.group_name : g.name != null ? g.name : '').trim();
        map.set(id, nm || id);
    });
    const parts = String(csv || '')
        .trim()
        .split(/[,，;；\s]+/)
        .map(function (s) {
            return s.trim();
        })
        .filter(Boolean);
    return parts.map(function (id) {
        return { id: id, name: map.has(id) ? map.get(id) : id };
    });
};

/**
 * Bootstrap Table 行 → 归属对列表：优先 row.group_labels（获奖页等），否则 value / row.group_affiliations_csv + catalog。
 */
csg.contestGroupAffiliationResolvePairs = function (value, row, catalog) {
    row = row || {};
    if (Array.isArray(row.group_labels) && row.group_labels.length) {
        return row.group_labels
            .map(function (g) {
                const id = String(g.id != null ? g.id : g.group_id != null ? g.group_id : '').trim();
                if (!id) return null;
                const name = String(g.name != null ? g.name : g.group_name != null ? g.group_name : '').trim();
                return { id: id, name: name || id };
            })
            .filter(Boolean);
    }
    const csv =
        value != null && String(value).trim() !== ''
            ? String(value)
            : row.group_affiliations_csv != null
              ? String(row.group_affiliations_csv)
              : '';
    return csg.contestGroupAffiliationPairsFromCsv(csv, catalog);
};

/**
 * 赛事归属列 HTML：展示标题（name），悬停为 key 说明，双击 chip 复制 key（global.js 的 ClipboardWrite）。
 * @param {Array<{id:string,name?:string}>} pairs
 * @param {{ allowWrap?: boolean }} [opts]
 * @returns {string}
 */
csg.contestGroupAffiliationListHtml = function (pairs, opts) {
    opts = opts || {};
    if (!Array.isArray(pairs) || !pairs.length) {
        return '<span class="text-muted">—</span>';
    }
    const inner = pairs
        .map(function (p) {
            const id = String(p.id || '').trim();
            if (!id) return '';
            const nameRaw = p.name != null && String(p.name).trim() !== '' ? String(p.name).trim() : id;
            const tip = '归属 ID: ' + id + ' / Affiliation ID: ' + id;
            return csg.hashTagBadgeHtml(nameRaw, id, {
                allowWrap: !!opts.allowWrap,
                titleForTooltip: tip,
                copyAffiliationId: id,
            });
        })
        .filter(Boolean)
        .join('');
    return '<span class="csg-hash-tag-list d-inline-flex flex-wrap align-items-center gap-1">' + inner + '</span>';
};

csg.formatterContestGroupAffiliationColumn = function (value, row, index, field) {
    if (typeof csg === 'undefined' || !csg.contestGroupAffiliationListHtml) {
        return '<span class="text-muted">—</span>';
    }
    const catalog =
        typeof window !== 'undefined' && window.TEAMGEN_CONFIG && Array.isArray(window.TEAMGEN_CONFIG.contest_groups)
            ? window.TEAMGEN_CONFIG.contest_groups
            : typeof window !== 'undefined' && window.RANK_TEAM_CONFIG && Array.isArray(window.RANK_TEAM_CONFIG.contest_groups)
              ? window.RANK_TEAM_CONFIG.contest_groups
              : null;
    const pairs = csg.contestGroupAffiliationResolvePairs(value, row, catalog);
    const inner = csg.contestGroupAffiliationListHtml(pairs, { allowWrap: false });
    return (
        '<div class="csg-contest-group-affiliation-cell csg-award-hash-cell teamgen-hash-cell csg-award-hash-cell--center teamgen-hash-cell--center">' +
        inner +
        '</div>'
    );
};

(function csgBindContestGroupAffiliationCopyOnce() {
    if (typeof document === 'undefined' || csg._csgAffiliationCopyBound) return;
    csg._csgAffiliationCopyBound = true;
    document.addEventListener(
        'dblclick',
        function (ev) {
            var t = ev.target && ev.target.closest ? ev.target.closest('[data-csg-affiliation-id]') : null;
            if (!t || !t.getAttribute) return;
            var id = t.getAttribute('data-csg-affiliation-id');
            if (id == null || String(id) === '') return;
            if (typeof ClipboardWrite !== 'function') return;
            ev.preventDefault();
            var ret = ClipboardWrite(String(id));
            if (ret && typeof ret.then === 'function') {
                ret.then(function () {}, function () {});
            }
        },
        true
    );
})();

window.FormatterContestGroupAffiliationColumn = function (value, row, index, field) {
    return csg.formatterContestGroupAffiliationColumn(value, row, index, field);
};

window.FormatterContestGroupAffiliationColumnCellStyle = function () {
    return {
        css: {
            verticalAlign: 'middle',
            textAlign: 'center',
            padding: '0.3rem 0.35rem',
            maxWidth: '12rem',
        },
    };
};

/**
 * 打开后台任务列表并带上 #bt_task_id= 筛选（与 backtask/index.php 中 csg.GetAnchor('bt_task_id') 一致）。
 * 保留 baseUrl 的 query（如 ?item=backtask），避免旧实现 strip 掉查询串。
 * @param {string} baseUrl 相对或绝对 URL，如 /admin/backtask?item=backtask
 * @param {number|string} taskId
 * @param {{ newTab?: boolean }} [opts]
 */
csg.openBacktaskWithTaskFilter = function (baseUrl, taskId, opts) {
    opts = opts || {};
    const tid = String(taskId == null ? '' : taskId).trim();
    if (!tid) return;
    const raw = String(baseUrl || '').trim();
    const noHash = raw.split('#')[0];
    let u;
    try {
        u = new URL(noHash, window.location.origin);
    } catch (e) {
        return;
    }
    let path = u.pathname.replace(/\/$/, '');
    if (!/\/backtask\/index$/.test(path)) {
        path = path.replace(/\/backtask$/, '/backtask/index');
        if (!/\/backtask\/index$/.test(path)) {
            path += '/backtask/index';
        }
    }
    const search = u.search || '';
    const url = path + search + '#bt_task_id=' + encodeURIComponent(tid);
    if (opts.newTab) {
        window.open(url, '_blank', 'noopener,noreferrer');
    } else {
        window.location.href = url;
    }
};