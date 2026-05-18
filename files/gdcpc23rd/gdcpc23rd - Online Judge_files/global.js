var g_submitDelayInfo = 500; //提交后通知延迟跳转
var g_submitDelayOper = 5; //提交后延迟下次操作

// 图像上传尺寸全局常量（前端预处理用）
window.CSGOJ_IMAGE_MAX_DIM = 1024;

function button_delay(button, delay, ori, tips, enText) {
    button.attr('disabled', true);
    
    // 保存原始的中文和英文内容
    var originalText = ori;
    var originalEnText = enText;
    
    if (ori !== null) {
        // 检查是否存在en-text元素
        var enTextElement = button.find('.en-text');
        if (enTextElement.length === 0 && enText !== null) {
            // 如果不存在en-text元素且提供了英文内容，则创建
            button.html(ori + '<span class="en-text">' + enText + '</span>');
        } else if (enTextElement.length > 0 && enText !== null) {
            // 如果存在en-text元素且提供了英文内容，则更新
            enTextElement.text(enText);
        }
        
        // 设置延迟提示文本
        var delayText = tips ? (tips + "(" + delay + "s)") : `${delay} 秒`;
        var delayEnText = tips ? (tips + "(" + delay + "s)") : `${delay}s`;
        
        // 更新按钮内容
        if (enTextElement.length > 0 || enText !== null) {
            button.html(delayText + '<span class="en-text">' + delayEnText + '</span>');
        } else {
            button.text(delayText);
        }
    }
        
    var timer = setInterval(
        function() {
            delay--;
            if (delay <= 0) {
                if (ori !== null) {
                    // 恢复原始内容
                    if (enTextElement.length > 0 || originalEnText !== null) {
                        button.html(originalText + '<span class="en-text">' + originalEnText + '</span>');
                    } else {
                        button.text(originalText);
                    }
                }
                button.removeAttr('disabled');
                clearInterval(timer);
                return;
            }
            if (ori !== null) {
                // 更新倒计时
                var delayText = tips ? (tips + "(" + delay + "s)") : `${delay} 秒`;
                var delayEnText = tips ? (tips + "(" + delay + "s)") : `${delay}s`;
                
                if (enTextElement.length > 0 || enText !== null) {
                    button.html(delayText + '<span class="en-text">' + delayEnText + '</span>');
                } else {
                    button.text(delayText);
                }
            }
        },
        1000
    );
}

/**
 * 按钮延迟处理函数（自动保存和恢复DOM内容）
 * @param {jQuery|HTMLElement} button - 按钮DOM对象
 * @param {number} delay - 延迟时长（秒）
 * @param {string} flg_status - 状态标志："before"（禁用但不倒计时）或 "start"（开始倒计时）
 * @param {string} [tip] - 提示文本（可选，默认为"提交中"/"Submitting"）
 */
function button_delay_auto(button, delay, flg_status, tip) {
    var $button = $(button);
    
    // 保存原始HTML内容（包括图标、双语结构等）
    if (!$button.data('original-html')) {
        $button.data('original-html', $button.html());
    }
    var originalHtml = $button.data('original-html');
    
    // 检查是否存在双语结构（基于原始HTML检查）
    var tempDiv = $('<div>').html(originalHtml);
    var hasBilingual = tempDiv.find('.en-text').length > 0;
    
    // 禁用按钮
    $button.attr('disabled', true);
    
    // 如果tip为空，使用默认的中英双语文本
    var defaultTip = '提交中';
    var defaultTipEn = 'Submitting';
    var actualTip = (tip && tip.trim() !== '') ? tip : defaultTip;
    var actualTipEn = (tip && tip.trim() !== '') ? tip : defaultTipEn;
    
    // 更新按钮内容为提示文本
    function updateButtonText(currentDelay) {
        var delayText = actualTip + "(" + currentDelay + "s)";
        var delayEnText = actualTipEn + "(" + currentDelay + "s)";
        
        if (hasBilingual) {
            // 与页面按钮一致：中文 .cn-text + 英文 .en-text，纵向排列（勿用裸文本 + .en-text，否则与 .btn.bilingual-inline 左右规则混杂）
            $button.html('<span class="cn-text">' + delayText + '</span><span class="en-text">' + delayEnText + '</span>');
        } else {
            $button.text(delayText);
        }
    }
    
    if (flg_status === 'before') {
        // before状态：只显示提示，不开始倒计时
        // 清除可能存在的旧timer
        var oldTimer = $button.data('delay-timer');
        if (oldTimer) {
            clearInterval(oldTimer);
            $button.removeData('delay-timer');
        }
        updateButtonText(delay);
    } else if (flg_status === 'start') {
        // start状态：开始倒计时
        // 清除可能存在的旧timer
        var oldTimer = $button.data('delay-timer');
        if (oldTimer) {
            clearInterval(oldTimer);
        }
        
        updateButtonText(delay);
        
        // 使用局部变量保存倒计时值
        var currentDelay = delay;
        
        var timer = setInterval(function() {
            currentDelay--;
            if (currentDelay <= 0) {
                // 倒计时结束，恢复原始HTML内容
                $button.html(originalHtml);
                $button.removeAttr('disabled');
                $button.removeData('original-html');
                $button.removeData('delay-timer');
                clearInterval(timer);
                return;
            }
            // 更新倒计时显示
            updateButtonText(currentDelay);
        }, 1000);
        
        // 将timer保存到button上，以便外部可以清除
        $button.data('delay-timer', timer);
    }
}


function DoUploadFile(upload_file_input, upload_file_form, upload_file_button)
{
    upload_file_form.ajaxForm({
        beforeSend: function() {
            upload_file_button.attr('disabled', true);
            var percentVal = '0%';
            upload_file_button.text('Uploading'+percentVal);
        },
        uploadProgress: function(event, position, total, percentComplete) {
            var percentVal = percentComplete + '%';
            upload_file_button.text('Uploading'+percentVal);
        },
        success: function() {
            var percentVal = '100%';
            upload_file_button.text("Uploaded");
        },
        complete: function(e) {
            ret = JSON.parse(e.responseText);
            if(ret['code'] == 1)
            {
                alerty.success("Uploaded.", "Uploaded.");
                button_delay(upload_file_button, 1, 'Upload File', 'Upload File');
                return true;
            }
            else
            {
                alerty.error(ret['msg']);
                button_delay(upload_file_button, 1, 'Upload File', 'Upload File');
                return false;
            }
        }
    });
    upload_file_form.submit();
    upload_file_input.val('');
}


function checkfile(upload_input, maxfilesize) {
    var maxsizeMB = Math.ceil(maxfilesize / 1024 / 1024);
    var errMsg = "Filesize must not exceed " + maxsizeMB + "Mb";
    var tipMsg = "Your browser does not support the size of the uploaded file before uploading. Please make sure that the uploaded file does not exceed" + maxfilesize + "Mb.";
    var browserCfg = {};
    var ua = window.navigator.userAgent;
    if (ua.indexOf("MSIE") >= 1) {
        browserCfg.ie = true;
    } else if (ua.indexOf("Firefox") >= 1) {
        browserCfg.firefox = true;
    } else if (ua.indexOf("Chrome") >= 1) {
        browserCfg.chrome = true;
    }
    try {
        var obj_file = upload_input;
        if (obj_file.value == "") {
            return [false, "Please chose a file."];
        }
        var filesize = 0;
        if (browserCfg.firefox || browserCfg.chrome) {
            filesize = obj_file.files[0].size;
        } else if (browserCfg.ie) {
            var obj_img = document.getElementById('tempimg');
            obj_img.dynsrc = obj_file.value;
            filesize = obj_img.fileSize;
        } else {
            return [true, tipMsg];
        }
        if (filesize == -1) {
            return [true, tipMsg];
        } else if (filesize > maxfilesize) {
            return [false, errMsg];
        } else {
            return [true, null];
        }
    } catch (e) {
        return [true, null];
    }
}
function pad0left(num, n, padcontent)
{
    if(padcontent == null)
        padcontent = ' ';
    return (new Array(n).join(padcontent) + num).slice(-n);
}

function FNV1aHash(str) {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0; // Convert to 32bit unsigned integer
}

function FNV1aHash2Str(str, len=32) {
    let hash = FNV1aHash(str);
    let hashStr = hash.toString(16).toUpperCase();
    while (hashStr.length < len) {
        hashStr += FNV1aHash(hashStr).toString(16).toUpperCase();
    }
    return hashStr.slice(0, len);
}
// **************************************************
// cookie 封装，可处理中文
function SetCookie(key, value, exp={})
{
    window.localStorage.setItem(key, window.btoa(encodeURIComponent(JSON.stringify(value))));
}
function GetCookie(key)
{
    let cookiestr = window.localStorage.getItem(key);
    if(typeof(cookiestr) == "undefined" || !cookiestr)
        return false;
    let cookieobj = JSON.parse(unescape(decodeURIComponent(window.atob(cookiestr))));
    return cookieobj;
}
function DelCookie(key)
{
    window.localStorage.removeItem(key);
}
// **************************************************
// 时间日期格式相关
function DateFormat(date, fmt='yyyy-MM-dd HH:mm:ss') {
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
}
function Timestamp2Time(timestamp, fmt='yyyy-MM-dd HH:mm:ss') {
    if(timestamp.toString().length < 13) {
        timestamp *= 1000;
    }
    let date = new Date(timestamp);
    return DateFormat(date, fmt);
}
function Timestr2Sec(timestr) {
    // xx:xx:xx 的时间转为秒
    let time_item = timestr.split(':');
    let res = 0;
    for(let i = 0; i < time_item.length; i ++) {
        res *= 60;
        res += parseInt(time_item[i]);
    }
    return res;
}
function Timeint2Str(sec_int) {
    let hour = Math.floor(sec_int / 3600 + 0.00000001);
    let mi = Math.floor(sec_int / 60 + 0.00000001) % 60;
    let sec = sec_int % 60;
    return `${pad0left(hour, 2, '0')}:${pad0left(mi, 2, '0')}:${pad0left(sec, 2, '0')}`;
}
function TimeLocal(timestr=null, fmt='yyyy-MM-dd HH:mm:ss') {
    let date;
    if(timestr === null) {
        date = new Date();
    } else {
        date = new Date(timestr);
    }
    return DateFormat(date, fmt);
}

// ---------- 应用时区（与 PHP app.default_timezone 一致）：global_js 已在 #csg-app-tz-root 写好 data-app-timezone ----------
(function () {
    function csgReadAppTzFromDomTrim() {
        var el = document.getElementById('csg-app-tz-root');
        return el && el.getAttribute('data-app-timezone') ? String(el.getAttribute('data-app-timezone')).trim() : '';
    }
    var domTz = csgReadAppTzFromDomTrim();
    /**
     * 自 DOM 读取的 IANA（与 data-app-timezone 一致）；空串表示未下发。wire/外榜工具包等须用非空值；
     * UI 与 naive 解析见 {@link CsgGetAppTimezone}（空时回退 Asia/Shanghai）。
     * @type {string}
     */
    window.CSGOJ_APP_TIMEZONE = domTz;
    window.CsgGetAppTimezone = function () {
        return domTz || 'Asia/Shanghai';
    };
})();

/**
 * 与 **window.CSGOJ_APP_TIMEZONE** 相同语义：须非空，否则抛错（禁止无 DOM 猜时区）。
 * @returns {string}
 */
function CsgRequireAppTimezoneForWireExport() {
    var tz = typeof window !== 'undefined' && typeof window.CSGOJ_APP_TIMEZONE === 'string' ? window.CSGOJ_APP_TIMEZONE.trim() : '';
    if (!tz) {
        throw new Error('缺少 #csg-app-tz-root[data-app-timezone]，无法写入导出时区侧车');
    }
    return tz;
}

/**
 * 将「应用时区下的墙钟时间」格式化为与 Intl 比较用的 yyyy-MM-dd HH:mm:ss（各段两位补零）。
 * @param {number} ms UTC 毫秒
 * @param {string} timeZone IANA
 */
function CsgWallClockStringInTimeZone(ms, timeZone) {
    try {
        var fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        var parts = fmt.formatToParts(new Date(ms));
        var o = {};
        for (var i = 0; i < parts.length; i++) {
            if (parts[i].type !== 'literal') {
                o[parts[i].type] = parts[i].value;
            }
        }
        return o.year + '-' + o.month + '-' + o.day + ' ' + o.hour + ':' + o.minute + ':' + o.second;
    } catch (e) {
        return '';
    }
}

/**
 * 解析「naive datetime（语义为给定 IANA 时区墙钟）」→ UTC 毫秒。
 * @param {string} naiveStr
 * @param {string} iana IANA 时区 id
 * @returns {number} NaN 表示无法解析
 */
function CsgNaiveIanaToUtcMs(naiveStr, iana) {
    if (naiveStr == null) {
        return NaN;
    }
    var s = String(naiveStr).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) {
        return NaN;
    }
    var tz = (iana && String(iana).trim()) ? String(iana).trim() : 'Asia/Shanghai';
    /** Luxon 3.x（global_js 引入）：IANA 墙钟 naive → UTC 毫秒，避免 Intl 二分；未加载或解析失败时回退旧实现 */
    if (typeof luxon !== 'undefined' && luxon && luxon.DateTime && typeof luxon.DateTime.fromFormat === 'function') {
        try {
            var dtLux = luxon.DateTime.fromFormat(s, 'yyyy-MM-dd HH:mm:ss', { zone: tz });
            if (dtLux && dtLux.isValid) {
                return dtLux.toMillis();
            }
        } catch (eLx) {
            /* fall through */
        }
    }
    var target = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    var hh = parseInt(m[4], 10);
    var mi = parseInt(m[5], 10);
    var sec = parseInt(m[6], 10);
    var est = Date.UTC(y, mo - 1, d, hh, mi, sec);
    var lo = est - 48 * 3600000;
    var hi = est + 48 * 3600000;
    var best = NaN;
    while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        var w = CsgWallClockStringInTimeZone(mid, tz);
        if (w === target) {
            best = mid;
            break;
        }
        if (w < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (Number.isFinite(best)) {
        return best;
    }
    for (var step = -48 * 3600000; step <= 48 * 3600000; step += 1000) {
        var t2 = est + step;
        if (CsgWallClockStringInTimeZone(t2, tz) === target) {
            return t2;
        }
    }
    return NaN;
}

/**
 * 解析「数据库 naive datetime，语义为应用时区墙钟」→ UTC 毫秒。
 * @param {string} naiveStr
 * @returns {number} NaN 表示无法解析
 */
function CsgNaiveAppTzToUtcMs(naiveStr) {
    var tz = typeof CsgGetAppTimezone === 'function' ? CsgGetAppTimezone() : 'Asia/Shanghai';
    return CsgNaiveIanaToUtcMs(naiveStr, tz);
}

/**
 * Wire 时间串 → UTC 毫秒：优先 RFC3339/ISO 偏移；否则 naive + time_context.wall_clock_timezone 或 appDefaultTz/应用时区。
 * @param {string} s
 * @param {object} [timeContext]
 * @param {string} [appDefaultTz] 缺省用 {@link CsgGetAppTimezone}
 * @returns {number}
 */
function CsgWireInstantMs(s, timeContext, appDefaultTz) {
    var raw = String(s == null ? '' : s).trim();
    if (!raw) {
        return NaN;
    }
    if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw) || /[+-]\d{4}$/.test(raw)) {
        var msIso = Date.parse(raw);
        return Number.isFinite(msIso) ? msIso : NaN;
    }
    var tc = timeContext && typeof timeContext === 'object' ? timeContext : {};
    var w = tc.wall_clock_timezone != null ? String(tc.wall_clock_timezone).trim() : '';
    var iana = w;
    if (!iana) {
        if (typeof appDefaultTz === 'string' && appDefaultTz.trim()) {
            iana = appDefaultTz.trim();
        } else if (typeof CsgGetAppTimezone === 'function') {
            iana = CsgGetAppTimezone();
        } else {
            iana = 'Asia/Shanghai';
        }
    }
    return CsgNaiveIanaToUtcMs(raw, iana);
}

/**
 * 浏览器本地时区相对 UTC 的紧凑标签（与区域语言无关），如 UTC+8、UTC-5、UTC+5:30。
 * 采用「UTC±偏移」而非 IANA 名，短小且技术文档常见；与 ISO 8601 数值偏移同语义（整点不写 :00）。
 * @param {number} ms UTC 毫秒
 * @returns {string}
 */
function CsgLocalUtcOffsetLabel(ms) {
    if (!Number.isFinite(ms)) {
        return '';
    }
    var d = new Date(ms);
    var offMin = -d.getTimezoneOffset();
    var sign = offMin >= 0 ? '+' : '-';
    var abs = Math.abs(offMin);
    var hh = Math.floor(abs / 60);
    var mm = abs % 60;
    if (mm === 0) {
        return 'UTC' + sign + hh;
    }
    return 'UTC' + sign + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

/**
 * 浏览器本地时区的紧凑偏移后缀（兼容旧用法：前导「 · 」+ {@link CsgLocalUtcOffsetLabel}）。
 * @param {number} ms UTC 毫秒
 * @returns {string}
 */
function CsgLocalTzOffsetSuffix(ms) {
    var lab = CsgLocalUtcOffsetLabel(ms);
    return lab ? (' · ' + lab) : '';
}

/**
 * 列表页等：从 #page_info[time_stamp] 或当前时间得到「现在」的 UTC 毫秒。
 */
function CsgContestPageNowMs() {
    var raw = null;
    try {
        var $p = (typeof jQuery !== 'undefined') ? jQuery('#page_info') : null;
        if ($p && $p.length) {
            raw = $p.attr('time_stamp');
        }
    } catch (e) { /* ignore */ }
    if (raw != null && String(raw).length > 0) {
        var v = parseFloat(String(raw));
        if (Number.isFinite(v)) {
            return v * 1000;
        }
    }
    try {
        if (typeof window !== 'undefined' && window.expContestPageInfo && window.expContestPageInfo.timeStamp != null) {
            var ts0 = parseFloat(String(window.expContestPageInfo.timeStamp));
            if (Number.isFinite(ts0)) {
                return ts0 * 1000;
            }
        }
    } catch (e0) { /* ignore */ }
    return Date.now();
}

/**
 * 比赛列表状态列：与 naive 开始/结束比较（语义同 PHP strtotime）。
 * @returns {-1|0|1} -1 未开始，0 进行中，1 已结束
 */
function CsgContestPhaseByRowTimes(row) {
    if (!row) {
        return -1;
    }
    var nowMs = CsgContestPageNowMs();
    var st = typeof CsgNaiveAppTzToUtcMs === 'function' ? CsgNaiveAppTzToUtcMs(String(row.start_time || '')) : NaN;
    var et = typeof CsgNaiveAppTzToUtcMs === 'function' ? CsgNaiveAppTzToUtcMs(String(row.end_time || '')) : NaN;
    if (!Number.isFinite(st) || !Number.isFinite(et)) {
        var ns = typeof Timestamp2Time === 'function' ? Timestamp2Time(nowMs) : '';
        var rs = String(row.start_time || '');
        var re = String(row.end_time || '');
        if (ns < rs) {
            return -1;
        }
        if (ns <= re) {
            return 0;
        }
        return 1;
    }
    if (nowMs < st) {
        return -1;
    }
    if (nowMs <= et) {
        return 0;
    }
    return 1;
}

Number.prototype.Pad = function(size) {
    var s = String(this);
    while (s.length < (size || 2)) {s = "0" + s;}
    return s;
}
function ItemShining(item, tm=5, to=200) {
    if(tm & 1) {
        item.hide();
    } else {
        item.show();
    }
    if(tm > 0) setTimeout(function(){ItemShining(item, tm - 1)}, to);
}
function ToggleFullScreen(id_name, target_item=null, set_full=null) {
    // dom对象全屏
    if(target_item == null) {
        target_item = document.getElementById(id_name);
    }        
    if (!document.fullscreenElement || set_full === true) {
        try {
            if (target_item.requestFullscreen) {
                target_item.requestFullscreen();
            } else if (target_item.webkitRequestFullscreen) { /* Safari */
                target_item.webkitRequestFullscreen();
            } else if (target_item.msRequestFullscreen) { /* IE11 */
                target_item.msRequestFullscreen();
            }
        } catch(e) {
            alerty.error(`尝试启用全屏模式时出错：${e}`, `Error attempting to enable full-screen mode: ${e}`);
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* Safari */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* IE11 */
            document.msExitFullscreen();
        }
    }
}
function SetFrontAlerty(target_div_id) {
    // 手动初始化 alerty 对象位置以便在答题界面全屏时也能正常显示
    // alerty 使用 Bootstrap 5 模态框，需要将模态框附加到指定容器
    // 所有依赖已全局引入，直接使用
    
    const targetDiv = document.getElementById(target_div_id);
    if (!targetDiv) {
        console.warn(`SetFrontAlerty: Target div #${target_div_id} not found`);
        return;
    }
    
    // 监听模态框显示事件，将模态框移动到指定容器
    $(document).on('shown.bs.modal', '.modal', function() {
        const $modal = $(this);
        const $targetDiv = $(`#${target_div_id}`);
        if ($targetDiv.length > 0 && $modal.parent().attr('id') !== target_div_id) {
            $modal.appendTo($targetDiv);
        }
    });
    
    // 使用 MutationObserver 监听通知容器的插入（替代已废弃的 DOMNodeInserted）
    const observer = new MutationObserver(function(mutations) {
        const notifications = document.getElementById('alerty-notifications');
        if (notifications && notifications.parentElement && notifications.parentElement.id !== target_div_id) {
            targetDiv.appendChild(notifications);
        }
    });
    
    // 观察 document.body 的变化，监听 alerty-notifications 的插入
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // 如果通知容器已经存在，立即移动到目标容器
    const existingNotifications = document.getElementById('alerty-notifications');
    if (existingNotifications && existingNotifications.parentElement && existingNotifications.parentElement.id !== target_div_id) {
        targetDiv.appendChild(existingNotifications);
    }
}
function StrWidthLength(s) {
    var len = 0;
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c >= 0x0000 && c <= 0x00FF) {
            len += 1;
        } else {
            len += 2;
        }
    }
    return len;

}
function StrByteLength(s) {
    var len = 0;
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
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
}
function Any2Ascii(str) {
    let utf8Str = encodeURIComponent(str);
    let base64Str = btoa(utf8Str);
    let asciiStr = base64Str.replace(/[^a-zA-Z0-9]/g, '_');
    return asciiStr;
}
function OpenBlobHtml(html_str) {
    let blob = new Blob([html_str], {type: "text/html"});
    let url = URL.createObjectURL(blob);
    window.open(url, "_blank");
}
async function ClipboardWrite(st) {
    if(st == "") {
        st = " ";
    }
    
    // 方法1: 现代 Clipboard API (需要 HTTPS 或 localhost)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(st);

            return true;
        } catch (error) {
            // console.warn('Clipboard API failed, falling back to legacy method:', error);
            // 如果 Clipboard API 失败，继续尝试传统方法
        }
    }
    
    // 方法2: 传统 document.execCommand 方法
    try {
        const textArea = document.createElement("textarea");
        textArea.value = st;
        
        // 设置样式使其不可见但可选择
        // 注意：不能设置为 display: none，否则 select() 可能失败
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.width = "2em";
        textArea.style.height = "2em";
        textArea.style.padding = "0";
        textArea.style.border = "none";
        textArea.style.outline = "none";
        textArea.style.boxShadow = "none";
        textArea.style.background = "transparent";
        textArea.style.opacity = "0";
        textArea.style.zIndex = "-1";
        textArea.style.pointerEvents = "none";
        
        // 添加到 DOM
        document.body.appendChild(textArea);
        
        // 尝试多种方式选择文本，确保兼容性
        // 关键：必须在用户交互事件的同步上下文中执行 select 和 execCommand
        textArea.focus();
        
        // 对于移动端，使用 setSelectionRange
        if (navigator.userAgent.match(/(ipad|iphone|ipod|android|windows phone)/i)) {
            textArea.setSelectionRange(0, st.length);
        } else {
            // 桌面端使用 select()
            textArea.select();
            // 额外确保选择（某些浏览器需要）
            if (document.activeElement !== textArea) {
                textArea.focus();
                textArea.select();
            }
        }
        
        // 执行复制
        // 注意：document.execCommand('copy') 必须在用户交互事件的同步上下文中执行
        // 不能放在 setTimeout 或 Promise 中，否则可能失败
        let successful = false;
        try {
            // 确保在同步上下文中执行
            successful = document.execCommand('copy');
            
            // 验证复制是否成功（在某些浏览器中，execCommand 可能返回 true 但实际未复制）
            // 注意：直接读取剪贴板需要权限，且可能不可用
            // 但我们可以通过检查浏览器是否支持 Clipboard API 来间接验证
            if (successful && navigator.clipboard && window.isSecureContext) {
                // 如果支持 Clipboard API，可以尝试验证（但会增加延迟）
                // 这里先不验证，因为 Clipboard API 已经在第一步尝试过了
            }
        } catch (err) {
            // 某些浏览器在非用户交互上下文中会抛出错误
            console.warn('execCommand copy failed:', err);
            successful = false;
        }
        
        // 验证复制是否成功（通过读取剪贴板内容，但这个方法在某些浏览器中需要权限）
        // 如果 execCommand 返回 true，通常意味着复制成功
        // 但我们也可以尝试读取来验证（注意：readText 需要用户授权）
        
        // 清理
        document.body.removeChild(textArea);
        
        return successful;
    } catch (error) {
        console.error('All clipboard methods failed:', error);
        return false;
    }
}

/**
 * HTML 转义函数（防止 XSS 攻击）
 * 转义 HTML 特殊字符：& < > " '
 * 
 * @param {string|number|null|undefined} st - 需要转义的文本
 * @returns {string} 转义后的文本（null/undefined 转为空字符串）
 * 
 * @example
 * DomSantize('<script>alert("xss")</script>') // '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 * DomSantize(null) // ''
 * DomSantize(123) // '123'
 */
function DomSantize(st) {
    // 处理 null/undefined/非字符串类型
    if (st == null) return '';
    if (typeof st !== 'string') st = String(st);
    
    // 转义顺序很重要：必须先转义 &，否则已转义的字符会被再次转义
    return st
        .replace(/&/g, '&amp;')   // 必须先转义 &，防止双重转义
        .replace(/</g, '&lt;')    // 转义 <
        .replace(/>/g, '&gt;')    // 转义 >
        .replace(/"/g, '&quot;')  // 转义双引号（用于 HTML 属性）
        .replace(/'/g, '&#39;');  // 转义单引号（用于 HTML 属性）
}
// **************************************************
// 颜色规范化函数 - 统一处理气球颜色格式
// **************************************************
/**
 * 规范化颜色格式
 * @param {string|number} color - 颜色值（可以是十六进制、颜色名称、数字等）
 * @param {object} options - 选项对象
 * @param {boolean} options.strict - 严格模式（用于输入验证），默认 false（用于显示）
 * @param {boolean} options.trustInput - 是否信任输入（用于显示端），默认 true
 * @returns {string|null} - 规范化后的颜色字符串，无效时返回 null
 */
function NormalizeColor(color, options = {}) {
    const { strict = false, trustInput = true } = options;
    
    // 处理 null、undefined、空字符串
    if (color === null || color === undefined) {
        return null;
    }
    
    // 处理数字类型（0-16777215）
    if (typeof color === 'number') {
        if (color >= 0 && color <= 16777215) {
            return '#' + color.toString(16).toUpperCase().padStart(6, '0');
        }
        return null;
    }
    
    // 必须是字符串类型
    if (typeof color !== 'string') {
        return null;
    }
    
    const originalColor = color.trim();
    if (originalColor === '') {
        return null;
    }
    
    // 处理十六进制颜色（6位，不带#）
    if (/^[0-9A-Fa-f]{6}$/.test(originalColor)) {
        return '#' + originalColor.toUpperCase();
    }
    
    // 处理十六进制颜色（3位，不带#）
    if (/^[0-9A-Fa-f]{3}$/.test(originalColor)) {
        const expanded = originalColor.split('').map(c => c + c).join('');
        return '#' + expanded.toUpperCase();
    }
    
    // 处理带#的十六进制颜色（6位）
    if (/^#[0-9A-Fa-f]{6}$/i.test(originalColor)) {
        return originalColor.toUpperCase();
    }
    
    // 处理带#的十六进制颜色（3位）
    if (/^#[0-9A-Fa-f]{3}$/i.test(originalColor)) {
        const hexPart = originalColor.substring(1);
        const expanded = hexPart.split('').map(c => c + c).join('');
        return '#' + expanded.toUpperCase();
    }
    
    // 处理 0x 前缀的十六进制（如 0xFF0000）
    if (/^0x[0-9A-Fa-f]{6}$/i.test(originalColor)) {
        const hexValue = originalColor.substring(2);
        return '#' + hexValue.toUpperCase();
    }
    
    // 处理 RGB/RGBA/HSL 格式（直接返回）
    if (/^(rgb|rgba|hsl|hsla)\(/i.test(originalColor)) {
        return originalColor;
    }
    
    // 处理颜色名称（如 red, blue, green）
    // 如果是严格的十六进制格式（带#但不匹配3或6位），在严格模式下返回null
    if (strict && originalColor.startsWith('#')) {
        // 严格模式下，如果带#但不是有效格式，返回null
        return null;
    }
    
    // 非严格模式或颜色名称：使用浏览器验证
    // 对于显示端（trustInput=true），更信任输入，直接返回原值或小写
    if (trustInput) {
        // 检查是否为有效的CSS颜色名称
        const tempElement = document.createElement('div');
        tempElement.style.color = originalColor;
        if (tempElement.style.color !== '') {
            // 如果是纯字母（颜色名称），返回小写
            if (/^[a-zA-Z]+$/.test(originalColor)) {
                return originalColor.toLowerCase();
            }
            // 其他有效颜色格式，返回原值
            return originalColor;
        }
    } else {
        // 输入验证模式：更严格的验证
        const tempElement = document.createElement('div');
        tempElement.style.color = originalColor;
        if (tempElement.style.color !== '') {
            if (/^[a-zA-Z]+$/.test(originalColor)) {
                return originalColor.toLowerCase();
            }
            return originalColor;
        }
    }
    
    return null;
}

/**
 * 规范化颜色用于显示（显示端使用，更信任输入）
 * @param {string|number} color - 颜色值
 * @returns {string|null} - 规范化后的颜色，无效时返回 null
 */
function NormalizeColorForDisplay(color) {
    return NormalizeColor(color, { strict: false, trustInput: true });
}

/**
 * 规范化颜色用于输入验证（管理后台使用，更严格）
 * @param {string|number} color - 颜色值
 * @returns {string|null} - 规范化后的颜色，无效时返回 null
 */
function NormalizeColorForInput(color) {
    return NormalizeColor(color, { strict: true, trustInput: false });
}

function IsNothing(vobj) {
    // 判断对象是否未定义
    return typeof(vobj) === 'undefined' || vobj === null;
}
function TextAllowTab(textarea_id) {
    // 允许 textarea 内 tab
    const text_dom = document.getElementById(textarea_id);
    if(text_dom) {
        text_dom.addEventListener('keydown', function(e) {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this.selectionStart;
                const end = this.selectionEnd;
                this.value = this.value.substring(0, start) + '\t' + this.value.substring(end);
                this.selectionStart = this.selectionEnd = start + 1;
            }
        });
    }
}

/**
 * 拆除某元素上的 Bootstrap Tooltip 触发器（实例、事件、标记），不处理子节点。
 * 用于更新文案前清理，或与 CsgSetTitleAndTooltip 配合摘掉误绑在父容器上的 tooltip。
 * @param {Element} el
 */
function CsgStripBootstrapTooltipTrigger(el) {
    if (!el || el.nodeType !== 1) {
        return;
    }
    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
        var tip = bootstrap.Tooltip.getInstance(el);
        if (tip) {
            tip.dispose();
        }
    }
    if (el._tooltipMouseleaveHandler) {
        el.removeEventListener('mouseleave', el._tooltipMouseleaveHandler);
        delete el._tooltipMouseleaveHandler;
    }
    if (el._tooltipClickHandler) {
        el.removeEventListener('click', el._tooltipClickHandler);
        delete el._tooltipClickHandler;
    }
    if (el.dataset) {
        delete el.dataset.tooltipListenersAdded;
    }
    el.removeAttribute('data-bs-toggle');
    el.removeAttribute('data-bs-placement');
    el.removeAttribute('data-bs-title');
    el.removeAttribute('csg-target-tooltip');
}

// 自动将 title 属性转换为 Bootstrap 5 tooltip 的全局功能
function AutoInitBootstrapTooltips() {
    var observer = null;
    var isInitialized = false;
    var domScanTimer = null;

    function scheduleInitTooltipsFromTitleDebounced() {
        if (domScanTimer) {
            clearTimeout(domScanTimer);
        }
        domScanTimer = setTimeout(function () {
            domScanTimer = null;
            initTooltipsFromTitle();
        }, 120);
    }

    // 为单个元素创建 Bootstrap Tooltip（供 init 与 updateElement 复用）
    function createSingleTooltip(tooltipTriggerEl, titleText) {
        if (!titleText || String(titleText).trim() === '') return null;
        var tipOpts = {
            title: titleText,
            trigger: 'hover focus',
            delay: { show: 100, hide: 100 },
            container: 'body',
            boundary: 'viewport',
            fallbackPlacements: ['top', 'bottom', 'left', 'right']
        };
        if (tooltipTriggerEl.getAttribute('data-csg-tooltip-preline') === 'true') {
            tipOpts.customClass = 'csg-tooltip-preline';
        }
        var tooltip = new bootstrap.Tooltip(tooltipTriggerEl, tipOpts);
        if (tooltipTriggerEl.dataset.tooltipListenersAdded !== 'true') {
            var mouseleaveHandler = function() {
                setTimeout(function() {
                    try {
                        var currentTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                        if (currentTooltip && currentTooltip._isEnabled) {
                            currentTooltip.hide();
                        }
                    } catch (eHide) {
                        /* BS 5.3：hide/_leave 中 _isWithActiveTrigger 会对 undefined 做 Object.values（DOM 已移除或实例半销毁时） */
                    }
                }, 150);
            };
            var clickHandler = function() {
                try {
                    var currentTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                    if (currentTooltip && currentTooltip._isEnabled) {
                        currentTooltip.hide();
                    }
                } catch (eHide) {
                    /* 同上 */
                }
            };
            tooltipTriggerEl._tooltipMouseleaveHandler = mouseleaveHandler;
            tooltipTriggerEl._tooltipClickHandler = clickHandler;
            tooltipTriggerEl.addEventListener('mouseleave', mouseleaveHandler);
            tooltipTriggerEl.addEventListener('click', clickHandler);
            tooltipTriggerEl.dataset.tooltipListenersAdded = 'true';
        }
        return tooltip;
    }
    
    function initTooltipsFromTitle() {
        $('[title]').filter(function() {
            // 只处理没有任何 data-bs-toggle 的元素
            return typeof $(this).attr('data-bs-toggle') === 'undefined' || $(this).attr('data-bs-toggle') === 'tooltip';
        }).not('.csg-switch-input').each(function() {
            var $this = $(this);
            var titleText = $this.attr('title');
            
            // 如果 title 为空、null 或 undefined，跳过
            if (!titleText || titleText.trim() === '') {
                return;
            }
            
            // 检查元素是否被禁用（disabled 属性或 disabled class）
            var isDisabled = $this.is(':disabled') || $this.hasClass('disabled') || $this.attr('disabled') !== undefined;
            
            // 如果元素被禁用，需要特殊处理
            if (isDisabled && ($this.is('button') || $this.is('input') || $this.is('a'))) {
                // 对于禁用的按钮/输入/链接，Bootstrap 5 的 tooltip 不会显示
                // 如果元素已经有父容器（且父容器不是 body），尝试将 tooltip 绑定到父容器
                var $parent = $this.parent();
                if ($parent.length > 0 && $parent[0].tagName !== 'BODY' && !$parent.hasClass('tooltip-wrapper')) {
                    // 检查父容器是否已经有 tooltip
                    var parentTitle = $parent.attr('title') || $parent.attr('data-bs-title');
                    if (!parentTitle) {
                        // 将 title 移到父容器
                        $this.removeAttr('title');
                        $parent.attr('title', titleText);
                        $parent.attr('data-bs-toggle', 'tooltip');
                        $parent.attr('data-bs-placement', 'top');
                        $parent.attr('data-bs-title', titleText);
                        $parent.attr('csg-target-tooltip', 'true');
                        // 标记父容器为 tooltip 包装器
                        $parent.addClass('tooltip-wrapper');
                        return; // 跳过当前元素的处理
                    }
                }
            }
            
            // 移除 title 属性，避免浏览器原生 tooltip 显示
            $this.removeAttr('title');
            
            // 添加 Bootstrap 5 tooltip 属性
            $this.attr('data-bs-toggle', 'tooltip');
            $this.attr('data-bs-placement', 'top');
            $this.attr('data-bs-title', titleText);
            $this.attr('csg-target-tooltip', 'true');
        });
        
        // 初始化所有 tooltip
        var tooltipTriggerList = [].slice.call(document.querySelectorAll('[csg-target-tooltip="true"]'));
        var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
            var existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
            if (existingTooltip) {
                if (tooltipTriggerEl.dataset.tooltipListenersAdded === 'true') return existingTooltip;
                tooltipTriggerEl.dataset.tooltipListenersAdded = 'true';
                return existingTooltip;
            }
            var titleText = tooltipTriggerEl.getAttribute('data-bs-title') || tooltipTriggerEl.getAttribute('title');
            if (!titleText || titleText.trim() === '') return null;
            return createSingleTooltip(tooltipTriggerEl, titleText);
        });
    }

    // 更新单个元素的 tooltip 文案（变更 title 后调用，使 Bootstrap tooltip 同步）
    function updateTooltipForElement(element, titleText) {
        var el = element && element.jquery ? element[0] : (element && element.nodeType ? element : null);
        if (!el) return;
        CsgStripBootstrapTooltipTrigger(el);
        var $el = $(el);
        var t = titleText != null ? String(titleText).trim() : '';
        $el.removeAttr('title');
        if (t !== '') {
            $el.attr('data-bs-title', t)
                .attr('data-bs-toggle', 'tooltip')
                .attr('data-bs-placement', 'top')
                .attr('csg-target-tooltip', 'true');
            createSingleTooltip(el, t);
        } else {
            $el.removeAttr('data-bs-title');
        }
    }
    
    // 监听动态添加的元素
    function startObserver() {
        observer = new MutationObserver(function(mutations) {
            var shouldInit = false;
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1) { // Element node
                            var $node = $(node);
                            if ($node.find('[title]:not([data-bs-toggle="tooltip"])').length > 0 || 
                                $node.is('[title]:not([data-bs-toggle="tooltip"])')) {
                                shouldInit = true;
                            }
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
                    var tgt = mutation.target;
                    if (tgt.nodeType === 1) {
                        var toggle = tgt.getAttribute('data-bs-toggle');
                        if (toggle === 'modal' || toggle === 'popover' || toggle === 'collapse' || toggle === 'dropdown') {
                            return;
                        }
                        if (tgt.getAttribute('csg-target-tooltip') === 'true') {
                            var nt = tgt.getAttribute('title');
                            // 初始化流程会先删 title 再写 data-bs-title；忽略「title 被清空」的突变，避免误拆实例
                            if (nt != null && String(nt).trim() !== '') {
                                updateTooltipForElement(tgt, nt);
                            }
                            return;
                        }
                        var nt2 = tgt.getAttribute('title');
                        if (nt2 && String(nt2).trim() !== '') {
                            shouldInit = true;
                        }
                    }
                }
            });
            if (shouldInit) {
                scheduleInitTooltipsFromTitleDebounced();
            }
        });
        
        // 开始观察
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['title']
        });
    }
    
    // 停止观察
    function stopObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }
    
    // 清理所有 tooltip
    function cleanupTooltips() {
        var tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        tooltips.forEach(function(element) {
            // 移除事件监听器
            if (element._tooltipMouseleaveHandler) {
                element.removeEventListener('mouseleave', element._tooltipMouseleaveHandler);
                delete element._tooltipMouseleaveHandler;
            }
            if (element._tooltipClickHandler) {
                element.removeEventListener('click', element._tooltipClickHandler);
                delete element._tooltipClickHandler;
            }
            
            // 移除标记
            if (element.dataset.tooltipListenersAdded) {
                delete element.dataset.tooltipListenersAdded;
            }
            
            // 清理 tooltip 实例
            var tooltip = bootstrap.Tooltip.getInstance(element);
            if (tooltip) {
                // 注意：hide() 内部会异步触发回调；如果紧接着 dispose() 会把实例字段置空，
                // 在回调里访问 _activeTrigger 可能导致 Object.values(null/undefined) 报错。
                // dispose() 本身会销毁 popper 并移除 tip，无需先 hide()。
                tooltip.dispose();
            }
        });
    }
    
    // 强制隐藏所有 tooltip
    function forceHideAllTooltips() {
        var tooltips = document.querySelectorAll('.tooltip');
        tooltips.forEach(function(tooltip) {
            tooltip.remove();
        });
    }
    
    // 公共接口
    return {
        init: function() {
            // 防止重复初始化
            if (isInitialized) {
                return;
            }
            isInitialized = true;
            
            // 页面加载时初始化
            initTooltipsFromTitle();
            // 开始监听动态元素
            startObserver();
        },
        stop: function() {
            stopObserver();
        },
        refresh: function() {
            scheduleInitTooltipsFromTitleDebounced();
        },
        cleanup: function() {
            cleanupTooltips();
        },
        forceHide: function() {
            forceHideAllTooltips();
        },
        // 更新单个元素的 tooltip 文案（变更 title 后调用，使 Bootstrap tooltip 同步显示新内容）
        updateElement: updateTooltipForElement
    };
}

/**
 * 动态设置元素的 title（提示文案），并同步更新已由 global.js 转为 Bootstrap tooltip 的显示。
 * 页面加载时 [title] 会被转为 Bootstrap tooltip，后续用 JS 改 title 不会更新 tooltip，需用本函数。
 *
 * 禁用的 button/input/a 初次初始化时，提示可能绑在带 .tooltip-wrapper 的父节点上；本函数会先拆掉父节点上的实例再绑回目标元素。
 *
 * @param {HTMLElement|jQuery} element - 目标元素
 * @param {string} titleText - 新的 title/tooltip 文案；空字符串表示移除提示
 */
function CsgSetTitleAndTooltip(element, titleText) {
    var el = element && element.jquery ? element[0] : (element && element.nodeType ? element : null);
    if (!el) return;
    var text = titleText != null ? String(titleText) : '';
    var p = el.parentElement;
    if (p && p.classList && p.classList.contains('tooltip-wrapper')) {
        var onParent =
            p.getAttribute('csg-target-tooltip') === 'true' ||
            p.getAttribute('data-bs-toggle') === 'tooltip';
        if (onParent) {
            CsgStripBootstrapTooltipTrigger(p);
            p.removeAttribute('title');
            p.removeAttribute('data-bs-title');
            p.classList.remove('tooltip-wrapper');
        }
    }
    if (window.autoTooltips && typeof window.autoTooltips.updateElement === 'function') {
        window.autoTooltips.updateElement(el, text);
    } else {
        el.setAttribute('title', text);
    }
}

function DoInitTooltip() {
    // Bootstrap 5.3：dispose() 会把实例字段全部置 null，但 hide()/show() 里 _queueCallback(complete)
    // 仍可能在过渡结束后执行：_isWithActiveTrigger 会对 null 做 Object.values；complete 会 this._element.removeAttribute。
    // 比赛列表等 updateElement/dispose 与过渡回调竞态易触发（/admin/contest/index 切换状态等）。
    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip && bootstrap.Tooltip.prototype &&
        !bootstrap.Tooltip.prototype.__csgDisposeRacePatched) {
        bootstrap.Tooltip.prototype.__csgDisposeRacePatched = true;
        var _csgTipProto = bootstrap.Tooltip.prototype;
        var _csgBaseProto = Object.getPrototypeOf(_csgTipProto);
        if (_csgBaseProto && typeof _csgBaseProto._queueCallback === 'function' &&
            !_csgBaseProto.__csgTooltipQueueWrapped) {
            _csgBaseProto.__csgTooltipQueueWrapped = true;
            var _csgOrigQueueCallback = _csgBaseProto._queueCallback;
            _csgBaseProto._queueCallback = function (callback, element, isAnimated) {
                var comp = this;
                if (comp instanceof bootstrap.Tooltip) {
                    return _csgOrigQueueCallback.call(this, function () {
                        if (!comp._element) {
                            return;
                        }
                        try {
                            return callback();
                        } catch (eQC) {
                            /* 与 _isWithActiveTrigger 补丁互补：dispose 后仍进入队列回调 */
                        }
                    }, element, isAnimated);
                }
                return _csgOrigQueueCallback.call(this, callback, element, isAnimated);
            };
        }
        var _csgOrigIsWithActiveTrigger = bootstrap.Tooltip.prototype._isWithActiveTrigger;
        if (typeof _csgOrigIsWithActiveTrigger === 'function') {
            bootstrap.Tooltip.prototype._isWithActiveTrigger = function () {
                var t = this._activeTrigger;
                if (t == null || typeof t !== 'object') {
                    return false;
                }
                return _csgOrigIsWithActiveTrigger.call(this);
            };
        }
    }

    // 防止重复执行整个初始化过程
    if (window.flg_bootstrap_tooltip_init) {
        return;
    }
    window.flg_bootstrap_tooltip_init = true;
    
    // 启用自动tooltip转换功能
    // 如需禁用，请注释下面这行
    if (!window.autoTooltips) {
        window.autoTooltips = AutoInitBootstrapTooltips();
        window.autoTooltips.init();
    }
    
    // 添加全局事件监听，防止 tooltip 卡住
    $(document).on('mouseleave', '[data-bs-toggle="tooltip"]', function() {
        // 不要闭包持有 tooltip 实例：实例可能在 timeout 期间被 dispose()，导致内部状态为空而报错
        var el = this;
        setTimeout(function() {
            try {
                var tooltip = bootstrap.Tooltip.getInstance(el);
                if (tooltip && tooltip._element) {
                    tooltip.hide();
                }
            } catch (eHide) {
                /* BS 5.3：hide → _leave → _isWithActiveTrigger 可能对 undefined 调用 Object.values（表格刷新 dispose 竞态） */
            }
        }, 100);
    });
    
    // 页面失去焦点时隐藏所有 tooltip
    $(window).on('blur', function() {
        if (window.autoTooltips) {
            window.autoTooltips.forceHide();
        }
    });
    
    // 滚动时隐藏所有 tooltip
    $(window).on('scroll', function() {
        if (window.autoTooltips) {
            window.autoTooltips.forceHide();
        }
    });
    
    // 窗口大小改变时清理 tooltip
    $(window).on('resize', function() {
        if (window.autoTooltips) {
            window.autoTooltips.cleanup();
        }
    });
}
$(function(){
    DoInitTooltip();
    
    // 自动检测编辑页面模式并应用背景色
    (function() {
        var pageInfo = $('#page_info');
        if (pageInfo.length > 0) {
            var editMode = pageInfo.attr('edit_mode');
            var copyMode = pageInfo.attr('copy_mode');
            
            // 转换为数字进行比较（兼容字符串 "0"/"1"）
            editMode = editMode ? parseInt(editMode, 10) : 0;
            copyMode = copyMode ? parseInt(copyMode, 10) : 0;
            
            // 优先级：复制模式 > 编辑模式 > 添加模式
            if (copyMode === 1) {
                $('.admin-form').addClass('admin-page-mode-copy');
            } else if (editMode === 1) {
                $('.admin-form').addClass('admin-page-mode-edit');
            } else {
                $('.admin-form').addClass('admin-page-mode-add');
            }
        }
    })();
    
    // 含 admin 比赛列表等仅带 bootstraptable_refresh_local、无 bootstrap_table_table 的表格，也需 post-body 后补扫 title→tooltip
    $('.bootstrap_table_table, table.bootstraptable_refresh_local').on('post-body.bs.table', function(){
        //处理table宽度，不出现横向scrollbar
        var bootstrap_table_div = $('.bootstrap_table_div');
        if(this.scrollWidth > bootstrap_table_div.width())
            bootstrap_table_div.width(this.scrollWidth + 20);
            
        // 表格刷新后重新初始化 tooltip
        if (window.autoTooltips) {
            window.autoTooltips.refresh();
        }
    });
});
$(document).on('dblclick', '.dblclick_fullscreen', (e) => {
    // 自定义双击全屏的对象
    let target = $(e.target).closest('.dblclick_fullscreen')[0];
    $(target).css('overflow', "scroll");
    ToggleFullScreen(null, $(e.target).closest('.dblclick_fullscreen')[0]);
});

/**
 * 后台任务入队成功：`alerty.confirm` 双按钮——「知道了」仅关闭；「后台任务」新标签打开后台任务页并定位本次任务。
 * 依赖：`alerty.js`、`util.js`（`csg.openBacktaskWithTaskFilter`）。
 *
 * @param {{ backtaskUrl?: string, taskId?: string|number, title?: string, messageCn?: string, messageEn?: string, onDone?: function }} opts
 */
window.CsgConfirmBacktaskFollowup = function (opts) {
    opts = opts || {};
    var taskId = opts.taskId;
    var btUrl = String(opts.backtaskUrl || '').trim();
    var msgCn = opts.messageCn != null ? String(opts.messageCn) : '';
    var msgEn = opts.messageEn != null ? String(opts.messageEn) : '';
    var title = opts.title || '任务已提交<span class="en-text">Task submitted</span>';
    var onDone = typeof opts.onDone === 'function' ? opts.onDone : function () {};

    function afterBoth() {
        try {
            onDone();
        } catch (e) {
            /* ignore */
        }
    }
    function openTab() {
        if (btUrl && taskId != null && String(taskId).trim() !== '') {
            csg.openBacktaskWithTaskFilter(btUrl, taskId, { newTab: true });
        }
    }

    if (!btUrl || taskId == null || String(taskId).trim() === '') {
        alerty.alert({
            title: title,
            message: msgCn,
            message_en: msgEn,
            width: 'lg',
            callback: afterBoth,
        });
        return;
    }

    var hintCn = '\n\n点击下方「后台任务」可在新标签页查看本次任务进度。';
    var hintEn = '\n\nClick "Backtask" to open a new tab and check this task\'s progress.';

    alerty.confirm({
        title: title,
        message: msgCn + hintCn,
        message_en: msgEn + hintEn,
        width: 'lg',
        cancelText: '知道了<span class="en-text">OK</span>',
        okText: '后台任务<span class="en-text">Backtask</span>',
        callback: function () {
            openTab();
            afterBoth();
        },
        callbackCancel: function () {
            afterBoth();
        },
    });
};
