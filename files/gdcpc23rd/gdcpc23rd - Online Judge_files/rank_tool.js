/**
 * 榜单系统工具函数库
 * 提供独立于业务逻辑的纯功能函数
 */

// 全局变量（以 ranktool_ 开头）

var ranktool_iconMap = {
    // 教练选手
    'coach': 'bi-person',
    'player': 'bi-people',
    // 登录账号（公开/私有/加密赛无 coach/tmember 时占位 coach-player 区）
    'account': 'bi-at',
    // 队伍类型
    'team-regular': 'bi-flag-fill',
    'team-girl': 'bi-heart-fill',
    'team-star': 'bi-star-fill',
    // 打星模式图标
    'star-half': 'bi-star-half',
    'moon-stars-fill': 'bi-moon-stars-fill',
    'star-fill': 'bi-star-fill',
    // 控制按钮
    'refresh': 'bi-arrow-clockwise',
    'fullscreen': 'bi-fullscreen',
    'exit-fullscreen': 'bi-fullscreen-exit',
    'roll': 'bi-play-circle',
    'pause': 'bi-pause-circle',
    'stop': 'bi-stop-circle',
    'settings': 'bi-gear',
    'palette': 'bi-palette',
    'school': 'bi-building-fill-gear',
    'filter': 'bi-funnel',
    'export': 'bi-download',
    'print': 'bi-printer',
    'help': 'bi-question-circle',
    'close': 'bi-x-circle',
    'check': 'bi-check-circle',
    'warning': 'bi-exclamation-triangle',
    'info': 'bi-info-circle'
};

var ranktool_labelToIconMap = {
    '打星不排名': 'star-half',
    '不含打星': 'moon-stars-fill',
    '打星参与排名': 'star-fill',
    '队伍排名': 'player',
    '学校/组织 排名': 'school',
    '默认主题': 'palette',
    '深色主题': 'palette',
    '浅色主题': 'palette'
};

/** 校徽预处理结果缓存（内存）：同一 fileKey 解码/抠边/测半径只做一次；不写 IndexedDB（见 RankToolLoadSchoolBadgeProcessedPack 注释） */
var ranktool_schoolBadgeProcessCache = new Map();
/** @type {Map<string, Promise<{ measured: {W:number,H:number,R:number|null}, displayUrl: string }>>} */
var ranktool_schoolBadgeProcessInflight = new Map();

// #########################################
//  校徽素材预处理（与 rank_roll 获奖 overlay 同源算法，供榜单行 / overlay 共用）
// #########################################

/**
 * 以图像几何中心为圆心，求到「非透明且非近白背景」像素的最远距离（原图像素）。
 * 用于 background-size 收紧：使内容圆落在展示区内，减轻异形徽被裁切。
 *
 * @param {HTMLImageElement} img 已 decode 的图
 * @returns {{ W: number, H: number, R: number|null }}
 */
function RankToolMeasureSchoolBadgeContentRadiusPx(img) {
    const W0 = img.naturalWidth || 0;
    const H0 = img.naturalHeight || 0;
    if (W0 < 2 || H0 < 2) {
        return { W: W0, H: H0, R: null };
    }
    const maxCanvasEdge = 256;
    const scaleDown = Math.min(1, maxCanvasEdge / Math.max(W0, H0));
    const w = Math.max(2, Math.round(W0 * scaleDown));
    const h = Math.max(2, Math.round(H0 * scaleDown));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        return { W: W0, H: H0, R: null };
    }
    ctx.drawImage(img, 0, 0, w, h);
    let data;
    try {
        data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
        return { W: W0, H: H0, R: null };
    }
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const alphaFloor = 20;
    const whiteFloor = 248;
    let maxR2 = 0;
    for (let yi = 0; yi < h; yi++) {
        for (let xi = 0; xi < w; xi++) {
            const i = (yi * w + xi) * 4;
            const a = data[i + 3];
            if (a < alphaFloor) continue;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r >= whiteFloor && g >= whiteFloor && b >= whiteFloor) continue;
            const dx = xi + 0.5 - cx;
            const dy = yi + 0.5 - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 > maxR2) maxR2 = d2;
        }
    }
    if (maxR2 < 1e-6) {
        return { W: W0, H: H0, R: null };
    }
    const RScaled = Math.sqrt(maxR2);
    const inv = W0 / w;
    const R0 = RScaled * inv;
    return { W: W0, H: H0, R: R0 };
}

/**
 * 校徽常见「圆徽 + 白方底」：只把与边缘连通的透明/近白/浅灰底转透明，保留环内浅色。
 *
 * @param {HTMLImageElement} img 已 decode
 * @returns {string|null} PNG data URL 或失败时 null
 */
function RankToolStripSchoolBadgeEdgeBackgroundFromImage(img) {
    const W = img.naturalWidth || 0;
    const H = img.naturalHeight || 0;
    if (W < 2 || H < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, W, H);

    let imageData;
    try {
        imageData = ctx.getImageData(0, 0, W, H);
    } catch (e) {
        return null;
    }
    const data = imageData.data;
    const total = W * H;
    const seen = new Uint8Array(total);
    const stack = [];
    const idxOf = (x, y) => y * W + x;
    const push = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const idx = idxOf(x, y);
        if (seen[idx]) return;
        const p = idx * 4;
        const a = data[p + 3];
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const maxc = Math.max(r, g, b);
        const minc = Math.min(r, g, b);
        const isTransparent = a <= 16;
        const isLightNeutral = a > 16 && minc >= 218 && (maxc - minc) <= 34;
        const isNearWhite = a > 16 && r >= 238 && g >= 238 && b >= 238;
        if (!isTransparent && !isLightNeutral && !isNearWhite) return;
        seen[idx] = 1;
        stack.push(idx);
    };

    for (let x = 0; x < W; x++) {
        push(x, 0);
        push(x, H - 1);
    }
    for (let y = 1; y < H - 1; y++) {
        push(0, y);
        push(W - 1, y);
    }

    while (stack.length > 0) {
        const idx = stack.pop();
        const p = idx * 4;
        if (data[p + 3] > 0) data[p + 3] = 0;
        const x = idx % W;
        const y = Math.floor(idx / W);
        push(x + 1, y);
        push(x - 1, y);
        push(x, y + 1);
        push(x, y - 1);
    }

    try {
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    } catch (e) {
        return null;
    }
}

/**
 * 解码 dataUrl、测内容半径、抠边，按 fileKey 在内存去重。
 * **不写 IndexedDB**：单页同校徽重复行多但不同校数量有限；预处理为 O(像素) 一次即可；
 * 若再缓存 PNG 到 IDB 会放大体积且与现有「原始 webp dataUrl」缓存键语义重叠，收益有限。
 *
 * @param {string} fileKey 与 FetchSchoolLogoDataUrl / rank_roll 一致，如 `${baseUrl}/${encodeURIComponent(school)}`
 * @param {string} dataUrl 原始校徽 data URL
 * @returns {Promise<{ measured: {W:number,H:number,R:number|null}, displayUrl: string }>}
 */
async function RankToolLoadSchoolBadgeProcessedPack(fileKey, dataUrl) {
    if (!dataUrl) {
        return { measured: { W: 0, H: 0, R: null }, displayUrl: dataUrl };
    }
    const key = fileKey || dataUrl;
    const cached = ranktool_schoolBadgeProcessCache.get(key);
    if (cached && cached.displayUrl != null && cached.measured) {
        return cached;
    }
    const existing = ranktool_schoolBadgeProcessInflight.get(key);
    if (existing) {
        return existing;
    }
    const task = (async () => {
        try {
            const img = new Image();
            img.decoding = 'async';
            img.src = dataUrl;
            await img.decode();
            const measured = RankToolMeasureSchoolBadgeContentRadiusPx(img);
            const displayUrl = RankToolStripSchoolBadgeEdgeBackgroundFromImage(img) || dataUrl;
            const pack = { measured, displayUrl };
            ranktool_schoolBadgeProcessCache.set(key, pack);
            return pack;
        } finally {
            ranktool_schoolBadgeProcessInflight.delete(key);
        }
    })();
    ranktool_schoolBadgeProcessInflight.set(key, task);
    return task;
}

/**
 * 按展示区宽度 D 与内容半径 R（图像坐标）收紧 background-size：s*R <= D/2 且矩形不溢出 D×D。
 *
 * @param {HTMLElement} element 带 background-image 的宿主（如 .school-logo / #award-school-logo）
 * @param {number} W 原图宽
 * @param {number} H 原图高
 * @param {number|null} R 内容半径（像素）
 * @param {string} [cssVarName='--rank-badge-bg-size'] 写入的 CSS 变量名；**获奖 overlay** 用 **`--roa-badge-bg-size`**。
 * 榜单行 `.school-logo` **勿调用本函数**：展示区域由 **`rank.css`** 固定 `background-size`，只应使用预处理后的 **`displayUrl`**。
 */
function RankToolApplySchoolBadgeBackgroundFit(element, W, H, R, cssVarName) {
    if (!element || !W || !H) return;
    const prop = cssVarName || '--rank-badge-bg-size';
    const run = () => {
        const D = element.getBoundingClientRect().width;
        if (!D || D < 2) return;
        let s = Math.min(D / W, D / H);
        if (R != null && R > 0 && Number.isFinite(R)) {
            const sCircle = D / (2 * R);
            if (Number.isFinite(sCircle)) {
                s = Math.min(s, sCircle);
            }
        }
        const bgW = s * W;
        if (!Number.isFinite(bgW) || bgW < 1) return;
        element.style.setProperty(prop, `${bgW}px auto`);
    };
    requestAnimationFrame(run);
    if (typeof ResizeObserver === 'undefined') {
        return;
    }
    RankToolDisconnectSchoolBadgeResizeObserver(element, prop);
    const ro = new ResizeObserver(() => run());
    ro.observe(element);
    element._rankToolSchoolBadgeRo = ro;
}

/**
 * 移除校徽 background-size 观察器及对应 CSS 变量。
 *
 * @param {HTMLElement} element
 * @param {string} [cssVarName='--rank-badge-bg-size']
 */
function RankToolDisconnectSchoolBadgeResizeObserver(element, cssVarName) {
    if (!element) return;
    const prop = cssVarName || '--rank-badge-bg-size';
    if (element._rankToolSchoolBadgeRo) {
        try {
            element._rankToolSchoolBadgeRo.disconnect();
        } catch (e) {
            /* ignore */
        }
        element._rankToolSchoolBadgeRo = null;
    }
    element.style.removeProperty(prop);
}

// #########################################
//  字符串和文本处理函数
// #########################################

/**
 * HTML转义
 */
function RankToolEscapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 字符串 → 32 位无符号哈希（FNV-1a），分布比旧版 DJB2 更均匀，减轻相近键扎堆同色
 */
function RankToolHashString(str) {
    const s = str == null ? '' : String(str);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/**
 * 赛事归属 `group_id` 的稳定强调色（`#RRGGBB`），供滚榜获奖 overlay 多归属边框等使用。
 *
 * - **哈希**：`RankToolHashString(groupId) % PALETTE.length`（与 `RankToolSchoolFilterColors` 同源 FNV-1a，键空间独立）。
 * - **调色板**：固定顺序的中高饱和冷色、紫、青绿、玫红等；**刻意不含**易与现场金银铜奖牌混淆的黄、琥珀、中性银灰、铜褐等色。
 * - **契约**：凡 Web 端需「按 contest_group 的 `group_id` 设色」且语义**不是**奖牌等级时，**必须**调用本函数，禁止复制调色板或另写哈希映射（Harness 见 **`docs/guide/03.前端与全局工具.md#contest-group-accent-color`**）。
 *
 * @param {string} groupId 归属 id；空串时返回调色板首色（兜底，正常应仅在已校验非空后调用）
 * @returns {string}
 */
function RankToolContestGroupAccentHex(groupId) {
    const PALETTE = [
        '#2563eb',
        '#7c3aed',
        '#059669',
        '#db2777',
        '#0d9488',
        '#4f46e5',
        '#16a34a',
        '#9333ea',
        '#0284c7',
        '#be123c',
        '#4338ca',
        '#0f766e',
        '#a21caf',
        '#1d4ed8',
        '#15803d',
        '#c026d3',
        '#0891b2',
        '#6366f1',
        '#8b5cf6',
        '#14b8a6',
        '#0e7490',
        '#7e22ce',
        '#1e40af',
        '#047857',
        '#a855f7'
    ];
    const key = groupId == null ? '' : String(groupId);
    if (!key) {
        return PALETTE[0];
    }
    return PALETTE[RankToolHashString(key) % PALETTE.length];
}

/**
 * 滚榜获奖 overlay：多归属时在**组名左侧**展示的 Bootstrap Icons **第二段类名**（与外层 `bi` 拼成 `bi bi-diagram-3-fill`）。
 *
 * - **哈希**：`RankToolHashString(groupId) % ICONS.length`（与 **`RankToolContestGroupAccentHex`** 同源 FNV-1a）。
 * - **图标集**：固定 10 个，刻意避开奖杯、奖牌、星标等易与「奖项等级」混淆的图形；语义偏「分组 / 场次 / 集合」。
 * - **配色**：图标 `color` 仍用 **`RankToolContestGroupAccentHex`**（与本函数独立），勿用本函数返回值当等级语义。
 *
 * @param {string} groupId 归属 id；空串时返回首项（兜底）
 * @returns {string} 如 `bi-diagram-3-fill`（HTML：`class="bi " + 返回值`）
 */
function RankToolContestGroupOverlayIconClass(groupId) {
    const ICONS = [
        'bi-diagram-3-fill',
        'bi-grid-3x3-gap-fill',
        'bi-layers-fill',
        'bi-collection-fill',
        'bi-globe2',
        'bi-building',
        'bi-folder-fill',
        'bi-bookmarks-fill',
        'bi-box-seam',
        'bi-signpost-2-fill'
    ];
    const key = groupId == null ? '' : String(groupId);
    if (!key) {
        return ICONS[0];
    }
    return ICONS[RankToolHashString(key) % ICONS.length];
}

function RankToolClampHueSl(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

/**
 * 学校筛选：标签与榜单行高亮共用同一套颜色（按学校名字符串哈希）
 * 色相仅 360 档，校多必有 hue 碰撞；同一 32 位哈希再拆出饱和度/亮度，碰撞时仍易区分。
 * @param {string} schoolName 学校名；空串则返回与原先一致的默认青色
 * @returns {{rowBg:string,rowBgHover:string,accent:string,outline:string,tagBg:string,border:string,text:string,tagAccent:string}}
 */
function RankToolSchoolFilterColors(schoolName) {
    const raw = (schoolName != null && String(schoolName).trim() !== '')
        ? String(schoolName).trim()
        : '';
    if (!raw) {
        return {
            rowBg: 'rgba(13, 202, 240, 0.12)',
            rowBgHover: 'rgba(13, 202, 240, 0.18)',
            accent: '#0dcaf0',
            outline: 'rgba(13, 202, 240, 0.25)',
            tagBg: 'var(--bs-info-bg-subtle, #cff4fc)',
            border: 'rgba(23, 162, 184, 0.4)',
            text: 'var(--bs-info-text-emphasis, #055160)',
            tagAccent: '#0aa2c0'
        };
    }
    const h = RankToolHashString(raw);
    const hue = h % 360;
    const satStrong = RankToolClampHueSl(50 + ((h >>> 7) % 19), 46, 72);
    const satMid = RankToolClampHueSl(42 + ((h >>> 14) % 21), 38, 65);
    const satSoft = RankToolClampHueSl(36 + ((h >>> 21) % 20), 32, 58);
    const lumAccent = RankToolClampHueSl(32 + ((h >>> 3) % 15), 30, 48);
    const lumText = RankToolClampHueSl(19 + ((h >>> 11) % 12), 17, 31);
    const lumTagBg = RankToolClampHueSl(85 + ((h >>> 19) % 6), 83, 92);
    const lumBorder = RankToolClampHueSl(66 + ((h >>> 5) % 9), 60, 74);
    return {
        rowBg: `hsla(${hue}, ${satMid}%, 52%, 0.14)`,
        rowBgHover: `hsla(${hue}, ${RankToolClampHueSl(satMid - 2, 36, 65)}%, 48%, 0.2)`,
        accent: `hsl(${hue}, ${RankToolClampHueSl(satStrong + 6, 52, 78)}%, ${lumAccent}%)`,
        outline: `hsla(${hue}, ${satSoft}%, 45%, 0.35)`,
        tagBg: `hsla(${hue}, ${satStrong}%, ${lumTagBg}%, 1)`,
        border: `hsla(${hue}, ${RankToolClampHueSl(satSoft + 4, 36, 62)}%, ${lumBorder}%, 0.9)`,
        text: `hsl(${hue}, ${RankToolClampHueSl(satStrong - 10, 28, 48)}%, ${lumText}%)`,
        tagAccent: `hsl(${hue}, ${satStrong}%, ${RankToolClampHueSl(lumAccent - 3, 26, 44)}%)`
    };
}

/**
 * 检查字符串是否为空（包括null、undefined、空字符串、纯空格）
 */
function RankToolIsEmptyString(str) {
    return !str || str === null || str === undefined || (typeof(str) === 'string' && str.trim() === '');
}

/**
 * 生成双语文本HTML
 */
function RankToolGenerateBilingualText(label, label_en) {
    return `${label}<en-text>${label_en}</en-text>`;
}

/** 滚榜等按钮：中文一行、英文一行（上下结构），内容已转义 */
function RankToolGenerateBilingualTextStacked(label, label_en) {
    const cn = RankToolEscapeHtml(String(label ?? ""));
    const en = RankToolEscapeHtml(String(label_en ?? ""));
    return (
        '<span class="roll-button-bilingual-stacked">' +
        '<span class="roll-button-text-cn">' +
        cn +
        "</span>" +
        '<span class="roll-button-text-en">' +
        en +
        "</span>" +
        "</span>"
    );
}

/**
 * 生成双语HTML属性
 */
function RankToolGenerateBilingualAttributes(titlecn, titleen) {
    if (!titlecn && !titleen) return '';
    return `title-cn="${titlecn || ''}" title-en="${titleen || ''}"`;
}

/**
 * 生成双语title属性
 */
function RankToolGenerateBilingualTitle(titlecn, titleen) {
    if (!titlecn && !titleen) return '';
    let title = '';
    if (titlecn && titleen) {
        title = `${titlecn}\n${titleen}`;
    } else if (titlecn) {
        title = titlecn;
    } else if (titleen) {
        title = titleen;
    }
    return title;
}

// #########################################
//  图标相关函数
// #########################################

/**
 * 获取图标类名
 */
function RankToolGetIconClass(key) {
    return ranktool_iconMap[key] || 'bi-question-circle';
}

/**
 * 生成图标HTML（带双语tooltip）
 */
function RankToolGenerateIcon(key, cn = '', en = '') {
    const iconClass = RankToolGetIconClass(key);
    const iconHtml = `<i class="bi ${iconClass}"></i>`;
    // 如果有中英双语标签，添加tooltip属性
    if (cn && en) {
        return `<span ${RankToolGenerateBilingualAttributes(cn, en)}>${iconHtml}</span>`;
    }
    return iconHtml;
}

/**
 * 生成纯图标HTML（用于按钮）
 */
function RankToolGenerateIconOnly(key) {
    const iconClass = RankToolGetIconClass(key);
    return `<i class="bi ${iconClass}"></i>`;
}

/**
 * 从option中提取icon key（用于custom select）
 */
function RankToolGetIconKeyFromOption(option) {
    if (typeof option === 'string') {
        return ranktool_labelToIconMap[option] || 'star-half';
    }
    if (option && typeof option === 'object' && option.icon_key) {
        return option.icon_key;
    }
    // 如果option是对象，检查label属性
    const label = option.label || option.label_cn || '';
    return ranktool_labelToIconMap[label] || 'star-half';
}

// #########################################
//  格式化和解析函数
// #########################################

/**
 * 将秒数转换为 HH:MM:SS 格式
 */
function RankToolFormatSecondsToHMS(seconds) {
    if (seconds == null || isNaN(seconds)) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * 将秒数转换为分钟数（字符串）
 */
function RankToolFormatSecondsToMinutes(seconds) {
    if (seconds == null || isNaN(seconds)) return '0';
    return Math.floor(seconds / 60).toString();
}

/**
 * 格式化持续时间（毫秒转 HH:MM:SS）
 */
function RankToolFormatDuration(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 倒计时显示用 HHH:MM:SS（小时三位数，如 999:59:59）
 */
function RankToolFormatCountdownHMS(totalSeconds) {
    if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds < 0) return '000:00:00';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(3, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 全屏计时遮罩：根据起止时间与模式计算当前应显示的时间文案和模式标签（纯函数，面向观众用语）
 * @param {number} startTimeMs - 比赛开始时间戳（毫秒）
 * @param {number} endTimeMs - 比赛结束时间戳（毫秒）
 * @param {number} nowMs - 当前时间戳（毫秒）
 * @param {number} mode - 1～4
 * @returns {{ timeText: string, labelCn: string, labelEn: string }}
 */
function RankToolGetTimeOverlayDisplay(startTimeMs, endTimeMs, nowMs, mode) {
    const beforeStart = nowMs < startTimeMs;
    const during = nowMs >= startTimeMs && nowMs < endTimeMs;
    const afterEnd = nowMs >= endTimeMs;
    let timeText = '000:00:00';
    let labelCn = '';
    let labelEn = '';
    if (beforeStart) {
        const diffSec = Math.floor((startTimeMs - nowMs) / 1000);
        timeText = RankToolFormatCountdownHMS(diffSec);
        labelCn = '距开始';
        labelEn = 'Time to start';
    } else if (during) {
        if (mode === 1 || mode === 3) {
            const diffSec = Math.floor((endTimeMs - nowMs) / 1000);
            timeText = RankToolFormatCountdownHMS(diffSec);
            labelCn = '距结束';
            labelEn = 'Time to end';
        } else {
            const diffSec = Math.floor((nowMs - startTimeMs) / 1000);
            timeText = RankToolFormatCountdownHMS(diffSec);
            labelCn = '已进行时间';
            labelEn = 'Elapsed time';
        }
    } else {
        if (mode === 1) {
            timeText = '000:00:00';
            labelCn = '比赛已结束';
            labelEn = 'Contest ended';
        } else if (mode === 2) {
            const elapsed = Math.floor((endTimeMs - startTimeMs) / 1000);
            timeText = RankToolFormatCountdownHMS(elapsed);
            labelCn = '距开始时长（比赛已结束）';
            labelEn = 'Time from start (contest ended)';
        } else if (mode === 3) {
            const overSec = Math.floor((nowMs - endTimeMs) / 1000);
            timeText = '-' + RankToolFormatCountdownHMS(overSec);
            labelCn = '超出时长（比赛已结束）';
            labelEn = 'Overtime (contest ended)';
        } else {
            const diffSec = Math.floor((nowMs - startTimeMs) / 1000);
            timeText = RankToolFormatCountdownHMS(diffSec);
            labelCn = '距开始时长（比赛已结束）';
            labelEn = 'Time from start (contest ended)';
        }
    }
    return { timeText, labelCn, labelEn };
}

/**
 * 创建全屏计时遮罩 DOM 与更新接口，挂到 container 下；样式依赖 rank.css 的 .time-overlay 等
 * @param {HTMLElement} container
 * @returns {{ element: HTMLElement, update: function, show: function, hide: function }}
 */
function RankToolCreateTimeOverlay(container) {
    const root = document.createElement('div');
    root.id = 'time-overlay';
    root.className = 'time-overlay rank-timer-overlay-host';
    root.style.display = 'none';
    root.innerHTML = `
        <div id="rank-timer-overlay-root" class="rank-timer-overlay-root contestlive-timer-page contestlive-timer-page--rank-overlay" tabindex="-1">
            <div class="contestlive-timer-page__stage">
                <h1 id="time-overlay-title" class="contestlive-timer-page__title"></h1>
                <div id="time-overlay-text" class="contestlive-timer-page__remain" aria-live="polite">--:--:--</div>
                <div id="time-overlay-label" class="contestlive-timer-page__state"></div>
            </div>
        </div>
    `;
    container.appendChild(root);
    const timerRoot = root.querySelector('#rank-timer-overlay-root');
    /** @deprecated 由 ContestliveContestTimer 驱动计时，占位避免旧调用时报错 */
    function update(_params) {
        /* noop */
    }
    function show() {
        root.style.display = 'flex';
    }
    function hide() {
        root.style.display = 'none';
    }
    return { element: root, timerRoot: timerRoot, update: update, show: show, hide: hide };
}

/**
 * 在指定父节点内显示浮动提示（固定视口顶、堆叠不重叠），duration 毫秒后移除
 */
function RankToolShowToast(message, parent, options) {
    options = options || {};
    const toastClass = options.toastClass || 'rank-message-toast';
    const gap = options.gap != null ? options.gap : 8;
    const duration = options.duration != null ? options.duration : 3000;
    const topStart = options.topStart != null ? options.topStart : 20;
    const existing = parent.querySelectorAll('.' + toastClass);
    let topPx = topStart;
    for (let i = 0; i < existing.length; i++) {
        topPx += existing[i].offsetHeight + gap;
    }
    const toast = document.createElement('div');
    toast.className = toastClass;
    toast.style.cssText = `
        position: fixed;
        top: ${topPx}px;
        right: 20px;
        background: #333;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 10000;
        font-size: 14px;
    `;
    toast.textContent = message;
    parent.appendChild(toast);
    setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration);
}

/**
 * 将题目编号转换为字母标识（A, B, C, ...）
 */
function RankToolGetProblemAlphabetIdx(problemNum) {
    if (problemNum == null || isNaN(problemNum)) return '?';
    return String.fromCharCode('A'.charCodeAt(0) + problemNum);
}

/**
 * 解析颜色字符串
 */
function RankToolParseColor(colorString) {
    if (!colorString) return '#6b7280'; // 默认灰色
    // 如果是十六进制颜色（如 840004）
    if (/^[0-9A-F]{6}$/i.test(colorString)) {
        return '#' + colorString;
    }
    // 如果是十六进制颜色（如 #840004）
    if (/^#[0-9A-F]{6}$/i.test(colorString)) {
        return colorString;
    }
    // 如果是CSS颜色名，直接返回
    return colorString.toLowerCase();
}

// #########################################
//  配置处理函数
// #########################################

/**
 * 深度合并配置对象
 */
function RankToolMergeConfig(baseConfig, overrideConfig) {
    const result = { ...baseConfig };
    for (const key in overrideConfig) {
        if (overrideConfig.hasOwnProperty(key)) {
            if (typeof overrideConfig[key] === 'object' && 
                overrideConfig[key] !== null && 
                !Array.isArray(overrideConfig[key]) &&
                typeof result[key] === 'object' && 
                result[key] !== null && 
                !Array.isArray(result[key])) {
                // 递归合并对象
                result[key] = RankToolMergeConfig(result[key], overrideConfig[key]);
            } else {
                // 直接覆盖
                result[key] = overrideConfig[key];
            }
        }
    }
    return result;
}

// #########################################
//  获奖相关计算函数
// #########################################

/**
 * 解析 contest.award_ratio 打包值：bronze×1e6 + silver×1e3 + gold（与 PHP 存库一致）。
 */
function RankToolParseAwardRatio(awardRatio) {
    if (!awardRatio) return { gold: 10, silver: 20, bronze: 30 };
    let ratio = awardRatio;
    const gold = ratio % 1000;
    ratio = Math.floor(ratio / 1000);
    const silver = ratio % 1000;
    ratio = Math.floor(ratio / 1000);
    const bronze = ratio % 1000;
    return { gold, silver, bronze };
}

/**
 * 金/银/铜名次上界（含）：displayRank <= rankGold 为金奖，以此类推。
 * 口径由 qtyMode 决定，与 PHP ContestAwardMath::computeRankCutoffs 一致。
 *
 * @param {number} cntBase 有效队伍数（已按打星/过题口径筛好的基数）
 * @param {number} ratioGold 金奖分量（百分比模式：整数 0–100；个数模式：非负整数名额）
 * @param {number} ratioSilver 银奖分量
 * @param {number} ratioBronze 铜奖分量
 * @param {number} [qtyMode=0] 0=百分比（累计带宽 ceil） 1=个数（先金后银再铜，每档 min(请求,剩余)）
 * @returns {{ rankGold: number, rankSilver: number, rankBronze: number, total: number }}
 */
function RankToolGetAwardRank(cntBase, ratioGold, ratioSilver, ratioBronze, qtyMode) {
    const mode = qtyMode === 1 ? 1 : 0;
    const B = Math.floor(Number(cntBase)) || 0;
    if (B <= 0) {
        return { rankGold: 0, rankSilver: 0, rankBronze: 0, total: 0 };
    }
    const g = Math.max(0, Math.floor(Number(ratioGold)));
    const s = Math.max(0, Math.floor(Number(ratioSilver)));
    const br = Math.max(0, Math.floor(Number(ratioBronze)));
    if (mode === 1) {
        const nG = Math.min(g, B);
        const nS = Math.min(s, Math.max(0, B - nG));
        const nB = Math.min(br, Math.max(0, B - nG - nS));
        const rankGold = nG;
        const rankSilver = nG + nS;
        const rankBronze = nG + nS + nB;
        return { rankGold, rankSilver, rankBronze, total: B };
    }
    const pg = Math.min(100, g) / 100.0;
    const ps = Math.min(100, s) / 100.0;
    const pb = Math.min(100, br) / 100.0;
    let rankGold = Math.ceil(B * pg);
    let rankSilver = Math.ceil(B * (pg + ps));
    let rankBronze = Math.ceil(B * (pg + ps + pb));
    if (s === 0) {
        rankSilver = rankGold;
    }
    if (br === 0) {
        rankBronze = rankSilver;
    }
    return { rankGold, rankSilver, rankBronze, total: B };
}

/**
 * 与获奖页 AwardSystem.getSwitchAcTeamBased 一致：勾选「按全队数计奖」时返回 false。
 * 榜单页无对应开关时视为未勾选（与获奖页无 DOM 时一致）。
 */
function RankToolRankMedalGetAcTeamBaseFromUi() {
    const switchEl = typeof document !== 'undefined' ? document.getElementById('switch_all_team_based') : null;
    return switchEl ? !switchEl.checked : false;
}

/**
 * 与获奖页 AwardSystem.getSwitchOneTwoThree 一致。
 */
function RankToolRankMedalGetOneTwoThreeFromUi() {
    const switchEl = typeof document !== 'undefined' ? document.getElementById('switch_one_two_three') : null;
    return switchEl ? !!switchEl.checked : false;
}

/**
 * 单赛事归属内：从 sourceList 构建该归属下的排序名次列表（与 award.js buildGroupRankListForAward 一致）。
 * @param {RankSystem} rankSystem
 * @param {string} groupId
 * @param {number} starMode 0|1|2
 * @param {Array<Object>} sourceList rankList 或 rollData
 */
function RankToolBuildGroupRankListForMedals(rankSystem, groupId, starMode, sourceList) {
    const out = [];
    for (const item of sourceList) {
        const team = item.team;
        if (!team) continue;
        const gids = Array.isArray(team.group_ids) ? team.group_ids : [];
        if (!gids.includes(groupId)) continue;
        if (team.tkind === 2 && starMode === 1) continue;
        const copy = { ...item };
        if (team.tkind === 2) {
            copy.isStar = starMode === 0;
        } else {
            copy.isStar = false;
        }
        out.push(copy);
    }
    out.sort((a, b) => rankSystem.CompareTeamsForRanking(a, b));
    return rankSystem.CalculateRankInfo(out);
}

/**
 * 多赛事归属：按各归属独立金银铜线写入每行的 flg_award_by_group / displayRankByGroup（仅奖牌档，不含专项奖）。
 * 普通榜用 rankList；滚榜当前视图用 rollData。
 */
function RankToolApplyMedalFlagsByGroupFromList(rankSystem, sourceList) {
    if (!rankSystem || !Array.isArray(sourceList) || sourceList.length === 0) return;
    if (typeof rankSystem.IsMultiGroupEnabled !== 'function' || !rankSystem.IsMultiGroupEnabled()) return;
    const groups = typeof rankSystem.GetContestGroups === 'function' ? rankSystem.GetContestGroups() : [];
    if (!groups.length) return;

    const starMode = typeof rankSystem.starMode === 'number' ? rankSystem.starMode : 0;
    const flg_ac_team_base = RankToolRankMedalGetAcTeamBaseFromUi();

    const byTeam = new Map();
    for (const item of sourceList) {
        if (!item || !item.team || !item.team.team_id) continue;
        byTeam.set(item.team.team_id, item);
        if (!item.flg_award_by_group || typeof item.flg_award_by_group !== 'object') {
            item.flg_award_by_group = {};
        }
        if (!item.displayRankByGroup || typeof item.displayRankByGroup !== 'object') {
            item.displayRankByGroup = {};
        }
        groups.forEach((g) => {
            const gid = g.group_id;
            item.flg_award_by_group[gid] = 0;
            item.displayRankByGroup[gid] = '';
        });
    }

    groups.forEach((group) => {
        const gid = group.group_id;
        const ranked = RankToolBuildGroupRankListForMedals(rankSystem, gid, starMode, sourceList);
        const qtyMode = parseInt(group.flg_award_qty_mode, 10) === 1 ? 1 : 0;
        const gGold = parseInt(group.award_ratio_gold ?? 10, 10) || 0;
        const gSilv = parseInt(group.award_ratio_silver ?? 15, 10) || 0;
        const gBron = parseInt(group.award_ratio_bronze ?? 20, 10) || 0;
        const tmpList = ranked.filter((it) => {
            if (it.solved <= 0) return false;
            if (flg_ac_team_base) return !it.isStar;
            return true;
        });
        const validTeamNum = flg_ac_team_base
            ? tmpList.filter((x) => x.solved > 0 && !x.isStar).length
            : tmpList.filter((x) => !x.isStar).length;
        const awardRanks = RankToolGetAwardRank(validTeamNum, gGold, gSilv, gBron, qtyMode);
        const rankGold = awardRanks.rankGold;
        const rankSilver = awardRanks.rankSilver;
        const rankBronze = awardRanks.rankBronze;

        for (let i = 0; i < ranked.length; i++) {
            const gItem = ranked[i];
            const team = gItem.team;
            const tid = team && team.team_id;
            const item = tid ? byTeam.get(tid) : null;
            if (item) {
                item.displayRankByGroup[gid] = gItem.displayRank;
            }
            if (!item || gItem.solved <= 0) continue;

            if (gItem.displayRank <= rankGold) {
                item.flg_award_by_group[gid] = 1;
            } else if (gItem.displayRank <= rankSilver) {
                item.flg_award_by_group[gid] = 2;
            } else if (gItem.displayRank <= rankBronze) {
                item.flg_award_by_group[gid] = 3;
            } else {
                item.flg_award_by_group[gid] = 0;
            }
        }
    });
}

// #########################################
//  动画相关函数
// #########################################

/**
 * 计算动画持续时间（考虑速度倍率）
 * @param {number} baseDuration - 基础持续时间（毫秒）
 * @param {number} speedMultiplier - 速度倍率（默认为1.0）
 * @param {number} minDuration - 最小持续时间（毫秒，默认300）
 * @param {number} maxDuration - 最大持续时间（毫秒，默认2000）
 * @returns {number} 计算后的动画持续时间（毫秒）
 */
function RankToolCalculateAnimationDuration(baseDuration = 2000, speedMultiplier = 1.0, minDuration = 300, maxDuration = 2000) {
    const calculated = baseDuration / speedMultiplier;
    return Math.max(minDuration, Math.min(maxDuration, calculated));
}

// #########################################
//  数据结构模块
// #########################################

/**
 * 将 list 格式转换为 dict 格式
 * @param {Object} data - 包含 solution 和 team 数组的数据对象
 * @returns {Object} 转换后的数据对象（直接修改原对象）
 */
function RankToolConvertListToDict(data) {
    if (!data) return data;
    
    // 判断 solution 数据是否需要转换：list -> dict
    // 字段顺序：[0]solution_id, [1]contest_id, [2]problem_id, [3]user_id（CPC 场常为 #cpc{cid}_{team_id}，与队伍表 team_id 对应）, [4]result, [5]in_date
    if (data.solution && Array.isArray(data.solution) && data.solution.length > 0) {
        // 检查第一个元素是否为数组（list格式）还是对象（dict格式）
        const firstItem = data.solution[0];
        if (Array.isArray(firstItem)) {
            // 是 list 格式，需要转换
            data.solution = data.solution.map(item => ({
                solution_id: item[0],
                contest_id: item[1],
                problem_id: item[2],
                team_id: item[3],
                result: item[4],
                in_date: item[5]
            }));
        }
        // 如果已经是 dict 格式，则不需要转换
    }
    
    // 判断 team 数据是否需要转换：list -> dict
    // 字段顺序：[0]contest_id, [1]team_id, [2]name, [3]name_en, [4]coach, [5]tmember, [6]school, [7]region, [8]tkind, [9]room, [10]privilege, [11]team_global_code, [12]group_ids, [13]group_ids_explicit 0|1
    if (data.team && Array.isArray(data.team) && data.team.length > 0) {
        // 检查第一个元素是否为数组（list格式）还是对象（dict格式）
        const firstItem = data.team[0];
        if (Array.isArray(firstItem)) {
            // 是 list 格式，需要转换
            data.team = data.team.map(item => ({
                contest_id: item[0],
                team_id: item[1],
                name: item[2],
                name_en: item[3],
                coach: item[4],
                tmember: item[5],
                school: item[6],
                region: item[7],        // 国家/地区
                tkind: item[8],
                room: item[9],
                privilege: item[10],
                team_global_code: item[11],
                group_ids: Array.isArray(item[12]) ? item[12] : [],
                group_ids_explicit: item[13] === 1 || item[13] === true
            }));
        }
        // 如果已经是 dict 格式，则不需要转换
    }
    
    // 判断 problem 数据是否需要转换：list -> dict
    // 字段顺序：[0]problem_id, [1]title, [2]num, [3]color, [4]pscore
    if (data.problem && Array.isArray(data.problem) && data.problem.length > 0) {
        // 检查第一个元素是否为数组（list格式）还是对象（dict格式）
        const firstItem = data.problem[0];
        if (Array.isArray(firstItem)) {
            // 是 list 格式，需要转换
            data.problem = data.problem.map(item => ({
                problem_id: item[0],
                title: item[1],
                num: item[2],
                color: item[3] || '',
                pscore: item[4] || 0
            }));
        }
        // 如果已经是 dict 格式，则不需要转换
    }
    
    return data;
}

/**
 * 外榜 rank.json：尚无提交（solution 空）但已有队伍列表时，生成与 CPC `team_cards_grid` 一致的数据包。
 * 过滤规则与 `ContestBaseTrait::fetchCpcTeamCardViewData` 对齐：`privilege` 须空、队名非空白。
 *
 * @param {*} rawData `RankToolLoadStaticRankData` 返回值（未经 OriInit）
 * @returns {null | { rows: Array<Object>, is_multi_group: number }}
 */
function RankToolOutrankExtractTeamWaitCardPack(rawData) {
    if (!rawData || typeof rawData !== 'object') {
        return null;
    }
    let d;
    try {
        d = JSON.parse(JSON.stringify(rawData));
    } catch (e) {
        return null;
    }
    RankToolConvertListToDict(d);
    const sol = d.solution;
    const solEmpty = !Array.isArray(sol) || sol.length === 0;
    if (!solEmpty) {
        return null;
    }
    const teams = Array.isArray(d.team) ? d.team : [];
    if (!teams.length) {
        return null;
    }
    const cg = Array.isArray(d.contest_group) ? d.contest_group : [];
    const gidToLabel = {};
    for (let i = 0; i < cg.length; i++) {
        const g = cg[i];
        if (!g || typeof g !== 'object') {
            continue;
        }
        const gid = String(g.group_id != null ? g.group_id : '');
        if (!gid) {
            continue;
        }
        gidToLabel[gid] = {
            group_name: String(g.group_name != null ? g.group_name : ''),
            group_name_en: String(g.group_name_en != null ? g.group_name_en : ''),
        };
    }
    const defaultGroupId =
        cg.length > 0 && cg[0] && cg[0].group_id != null ? String(cg[0].group_id) : '';
    const isMulti = cg.length > 1 ? 1 : 0;

    const rows = [];
    for (let i = 0; i < teams.length; i++) {
        const t = teams[i];
        if (!t || typeof t !== 'object') {
            continue;
        }
        const priv = t.privilege != null ? String(t.privilege).trim() : '';
        if (priv !== '') {
            continue;
        }
        const name = t.name != null ? String(t.name).trim() : '';
        if (!name) {
            continue;
        }
        const tid = String(t.team_id != null ? t.team_id : '');
        let gids = [];
        if (Array.isArray(t.group_ids) && t.group_ids.length) {
            gids = t.group_ids.map((x) => String(x));
        } else if (defaultGroupId) {
            gids = [defaultGroupId];
        }
        const group_labels = [];
        for (let j = 0; j < gids.length; j++) {
            const gid = gids[j];
            if (gidToLabel[gid]) {
                group_labels.push(gidToLabel[gid]);
            }
        }
        rows.push({
            team_id: tid,
            name: t.name,
            name_en: t.name_en != null ? String(t.name_en) : '',
            school: t.school != null ? String(t.school) : '',
            room: t.room != null ? String(t.room) : '',
            region: t.region != null ? String(t.region) : '',
            tkind: t.tkind != null ? t.tkind : 0,
            coach: t.coach != null ? String(t.coach) : '',
            tmember: t.tmember != null ? String(t.tmember) : '',
            group_labels,
        });
    }
    rows.sort((a, b) => a.team_id.localeCompare(b.team_id));
    if (!rows.length) {
        return null;
    }
    return { rows, is_multi_group: isMulti };
}

/**
 * 判断静态 rank 载荷是否已有至少一条提交（与 `CpcRankWaitBoot` / contest_data_ajax 语义一致）。
 * @param {*} rawData
 * @returns {boolean}
 */
function RankToolStaticRankPayloadHasSolution(rawData) {
    if (!rawData || typeof rawData !== 'object') {
        return false;
    }
    let d;
    try {
        d = JSON.parse(JSON.stringify(rawData));
    } catch (e) {
        return false;
    }
    RankToolConvertListToDict(d);
    const sol = d.solution;
    return Array.isArray(sol) && sol.length > 0;
}

/**
 * 判断是否为外榜盘上 `.../outrank_attach/<uuid>/rank.json` 的静态地址（尚未推送时常 404）。
 * @param {string} urlStr
 * @returns {boolean}
 */
function RankToolIsOutrankAttachRankJsonUrl(urlStr) {
    if (typeof urlStr !== 'string') {
        return false;
    }
    const path = urlStr.split('#')[0].split('?')[0];
    return path.indexOf('/outrank_attach/') !== -1 && /\/rank\.json$/i.test(path);
}

/**
 * rank.json 缺失或无法解析时使用的空壳，结构与 contest_data_ajax 一致，供 OriInit / ProcessData 使用。
 * @param {string} [reason] not_found | invalid_json | empty
 * @returns {Object}
 */
function RankToolEmptyStaticRankData(reason) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const localStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
    const hint = reason === 'not_found'
        ? { zh: '暂无榜单文件（尚未推送或已清理）', en: 'No rank file yet (not pushed or removed)' }
        : { zh: '暂无有效榜单数据', en: 'No valid rank data yet' };
    return {
        contest: {
            contest_id: 0,
            title: hint.zh,
            title_en: hint.en,
            start_time: localStr,
            end_time: localStr,
            frozen_minute: 0,
            frozen_after: 0,
            group_count: 0,
            is_multi_group: 0,
        },
        contest_group: [],
        problem: [],
        team: [],
        solution: [],
    };
}

/**
 * 加载静态榜单数据（外榜 / 离线包共用）：支持裸 rank.json 与 ThinkPHP {code,data} 包装。
 * @param {RankSystem} rankSystem
 * @returns {Promise<Object>}
 */
async function RankToolLoadStaticRankData(rankSystem) {
    if (!rankSystem || !rankSystem.config) {
        throw new Error('Rank system is not available');
    }
    const apiUrl = rankSystem.config.api_url;
    const cacheKey = `${rankSystem.key}_data_v2`;
    const cacheDuration = rankSystem.config.cache_duration || 60 * 1000;

    if (rankSystem.config.flg_rank_cache && rankSystem.cache) {
        const cachedData = await rankSystem.cache.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }
    }

    let data = null;
    let skipRankDataCache = false;
    if (typeof apiUrl === 'object' && apiUrl !== null && !Array.isArray(apiUrl)) {
        if (apiUrl.contest || apiUrl.team || apiUrl.problem || apiUrl.solution) {
            data = apiUrl;
        }
    } else if (typeof apiUrl === 'string') {
        let fullUrl = apiUrl;
        if (rankSystem.config.request_t_param) {
            const now = Date.now();
            const t = Math.floor(now / (60 * 1000)) * (60 * 1000);
            const sep = apiUrl.includes('?') ? '&' : '?';
            fullUrl = `${apiUrl}${sep}t=${encodeURIComponent(t)}`;
        }
        const staticOutrankRankJson = RankToolIsOutrankAttachRankJsonUrl(apiUrl);
        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            },
            cache: 'no-cache'
        });
        if (!response.ok) {
            if (staticOutrankRankJson && response.status === 404) {
                data = RankToolEmptyStaticRankData('not_found');
                skipRankDataCache = true;
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        } else {
            const text = await response.text();
            let result = null;
            if (text != null && String(text).trim() !== '') {
                try {
                    result = JSON.parse(text);
                } catch (eJson) {
                    if (staticOutrankRankJson) {
                        data = RankToolEmptyStaticRankData('invalid_json');
                        skipRankDataCache = true;
                    } else {
                        throw new Error('Invalid JSON in static rank response');
                    }
                }
            } else if (staticOutrankRankJson) {
                data = RankToolEmptyStaticRankData('empty');
                skipRankDataCache = true;
            }
            if (result && data === null) {
                if (result.code === 1 && result.data) {
                    data = result.data;
                } else if (result.contest || result.team || result.problem || result.solution) {
                    data = result;
                }
            }
        }
    }

    if (!data) {
        throw new Error('Invalid data format');
    }
    if (rankSystem.config.flg_rank_cache && rankSystem.cache && !skipRankDataCache) {
        await rankSystem.cache.set(cacheKey, data, cacheDuration);
    }
    return data;
}

/**
 * 优先级队列（类似 C++ 的 std::priority_queue）
 * 默认是最大堆（队首是优先级最高的元素）
 * @template T
 */
if(typeof RankToolPriorityQueue == 'undefined') {   
    class RankToolPriorityQueue {
        /**
         * @param {function(T, T): number} compareFn - 比较函数，返回正数表示第一个参数优先级更高
         *                                          默认是最大堆（大的元素在前）
         */
        constructor(compareFn = null) {
            this.data = [];
            // 默认比较函数（最大堆）
            this.compareFn = compareFn || ((a, b) => {
                if (a < b) return 1;
                if (a > b) return -1;
                return 0;
            });
        }
        
        /**
         * 获取队列大小
         * @returns {number}
         */
        size() {
            return this.data.length;
        }
        
        /**
         * 判断队列是否为空
         * @returns {boolean}
         */
        empty() {
            return this.data.length === 0;
        }
        
        /**
         * 获取队首元素（不移除）
         * @returns {T|null}
         */
        top() {
            return this.empty() ? null : this.data[0];
        }
        
        /**
         * 入队
         * @param {T} item
         */
        push(item) {
            this.data.push(item);
            this._heapifyUp(this.data.length - 1);
        }
        
        /**
         * 出队
         * @returns {T|null}
         */
        pop() {
            if (this.empty()) {
                return null;
            }
            
            const top = this.data[0];
            const last = this.data.pop();
            
            if (this.data.length > 0) {
                this.data[0] = last;
                this._heapifyDown(0);
            }
            
            return top;
        }
        
        /**
         * 上浮（从底部向上调整）
         * @private
         */
        _heapifyUp(index) {
            while (index > 0) {
                const parentIndex = Math.floor((index - 1) / 2);
                if (this.compareFn(this.data[index], this.data[parentIndex]) <= 0) {
                    break;
                }
                this._swap(index, parentIndex);
                index = parentIndex;
            }
        }
        
        /**
         * 下沉（从顶部向下调整）
         * @private
         */
        _heapifyDown(index) {
            while (true) {
                let largest = index;
                const left = 2 * index + 1;
                const right = 2 * index + 2;
                
                if (left < this.data.length && 
                    this.compareFn(this.data[left], this.data[largest]) > 0) {
                    largest = left;
                }
                
                if (right < this.data.length && 
                    this.compareFn(this.data[right], this.data[largest]) > 0) {
                    largest = right;
                }
                
                if (largest === index) {
                    break;
                }
                
                this._swap(index, largest);
                index = largest;
            }
        }
        
        /**
         * 交换两个元素
         * @private
         */
        _swap(i, j) {
            [this.data[i], this.data[j]] = [this.data[j], this.data[i]];
        }
        
        /**
         * 清空队列
         */
        clear() {
            this.data = [];
        }
        
        /**
         * 获取所有元素（用于调试）
         * @returns {T[]}
         */
        toArray() {
            return [...this.data];
        }
    }

    // 导出到全局
    if (typeof window !== 'undefined') {
        window.RankToolPriorityQueue = RankToolPriorityQueue;
    }
}
// #########################################
//  缓存管理模块
// #########################################
// IndexedDB缓存管理器

if(typeof IndexedDBCache == 'undefined') {
    class IndexedDBCache {
        constructor(dbName = 'csgoj_rank', storeName = 'cache') {
            this.dbName = dbName;
            this.storeName = storeName;
            this.db = null;
            this.isReady = false;
            this.fallback = false;
        }
        // 初始化IndexedDB
        async init() {
            return new Promise((resolve) => {
                const openReq = indexedDB.open(this.dbName, 1);
                openReq.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName);
                    }
                };
                openReq.onsuccess = () => {
                    this.db = openReq.result;
                    this.isReady = true;
                    this.fallback = false;
                    resolve();
                };
                openReq.onerror = () => {
                    this.isReady = true;
                    this.fallback = true;
                    resolve();
                };
            });
        }
        // 获取数据（自动JSON解析）
        async get(key) {
            if (!this.isReady) {
                await this.init();
            }
            if (this.fallback) {
                const value = localStorage.getItem(key);
                if (value === null) return null;
                // localStorage fallback 需要手动解析，因为localStorage只存储字符串
                try {
                    return JSON.parse(value);
                } catch {
                    return value; // 返回原始字符串
                }
            }
            return new Promise((resolve) => {
                const tx = this.db.transaction([this.storeName], 'readonly');
                const os = tx.objectStore(this.storeName);
                const req = os.get(key);
                req.onsuccess = () => {
                    const result = req.result;
                    if (!result) {
                        resolve(null);
                        return;
                    }
                    // 检查是否过期
                    if (result.expireTime && Date.now() > result.expireTime) {
                        // 数据已过期，删除并返回 null
                        this.delete(key).then(() => resolve(null));
                        return;
                    }
                    // IndexedDB中存储的value已经是序列化后的字符串，需要解析
                    try {
                        resolve(JSON.parse(result.value));
                    } catch {
                        resolve(result.value); // 返回原始字符串
                    }
                };
                req.onerror = () => resolve(null);
            });
        }
        // 设置数据（自动JSON序列化）
        async set(key, value, expire = null) {
            if (!this.isReady) {
                await this.init();
            }
            // 自动JSON序列化
            const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
            if (this.fallback) {
                // localStorage fallback 不支持过期时间，直接存储
                localStorage.setItem(key, serializedValue);
                return;
            }
            return new Promise((resolve) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const os = tx.objectStore(this.storeName);
                const now = Date.now();
                const expireTime = expire && expire > 0 ? now + expire : null;
                const data = {
                    key: key,
                    value: serializedValue,
                    expireTime: expireTime,
                    createTime: now
                };
                const req = os.put(data, key);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
        }
        // 删除数据
        async delete(key) {
            if (!this.isReady) {
                await this.init();
            }
            if (this.fallback) {
                localStorage.removeItem(key);
                return;
            }
            return new Promise((resolve) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const os = tx.objectStore(this.storeName);
                const req = os.delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
        }
        // 清空所有数据
        async clear() {
            if (!this.isReady) {
                await this.init();
            }
            if (this.fallback) {
                localStorage.clear();
                return;
            }
            return new Promise((resolve) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const os = tx.objectStore(this.storeName);
                const req = os.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            });
        }
    }
    window.IndexedDBCache = IndexedDBCache;
}

/**
 * 与 rank.js `RankSystem.prototype.FetchSchoolLogoDataUrl` 行为一致：在线仅尝试 `.webp`；
 * 若存在 `window.OFFLINE_IMAGES.school_badge` 则优先按 key 命中（与榜单离线包一致）。
 *
 * @param {string} fileKey 无扩展名，形如 baseUrl + '/' + encodeURIComponent(校名)
 * @param {string} [schoolBadgeBaseUrl] 默认 `/static/image/school_badge`（仅 OFFLINE 分支截取 schoolKey 用）
 * @returns {Promise<string>} data URL
 */
async function RankToolFetchSchoolLogoDataUrl(fileKey, schoolBadgeBaseUrl) {
    const baseUrl = (schoolBadgeBaseUrl && String(schoolBadgeBaseUrl).replace(/\/+$/, '')) || '/static/image/school_badge';
    if (window.OFFLINE_IMAGES && window.OFFLINE_IMAGES.school_badge) {
        let schoolKey = fileKey.replace(baseUrl + '/', '').replace(/\.(jpg|webp)$/, '');
        let base64Data = window.OFFLINE_IMAGES.school_badge[schoolKey];
        if (!base64Data && schoolKey !== encodeURIComponent(schoolKey)) {
            schoolKey = encodeURIComponent(schoolKey);
            base64Data = window.OFFLINE_IMAGES.school_badge[schoolKey];
        }
        if (!base64Data) {
            try {
                const decodedKey = decodeURIComponent(schoolKey);
                base64Data = window.OFFLINE_IMAGES.school_badge[decodedKey];
            } catch (e) {
                // ignore
            }
        }
        if (base64Data) {
            return base64Data;
        }
    }
    const tryList = ['webp'];
    for (let ti = 0; ti < tryList.length; ti++) {
        const url = `${fileKey}.${tryList[ti]}`;
        try {
            const resp = await fetch(url, { cache: 'force-cache' });
            if (!resp.ok) {
                continue;
            }
            const blob = await resp.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            return dataUrl;
        } catch (e) {
            // try next ext
        }
    }
    throw new Error('No valid school logo');
}

/**
 * 校徽 IndexedDB 键：与 `rank.js` `CreateImageLazyLoader`（`type === 'logo'`）完全一致。
 * @param {string} baseUrl 与榜单 `school_badge_url` 同源字符串（含可能尾斜杠，调用方须与写库方一致）
 * @param {string} identifier `data-school` 原始值（与榜单 `GetImageIdentifier` 一致，通常不强行 trim）
 * @returns {string}
 */
function RankToolSchoolLogoIdbCacheKey(baseUrl, identifier) {
    return 'logo_' + baseUrl + '_' + encodeURIComponent(identifier);
}

/** 与榜单校徽懒加载成功缓存 TTL 一致（1h） */
var RANK_TOOL_SCHOOL_LOGO_IDB_TTL_OK_MS = 60 * 60 * 1000;
/** 与榜单校徽懒加载失败缓存 TTL 一致（10min） */
var RANK_TOOL_SCHOOL_LOGO_IDB_TTL_FAIL_MS = 10 * 60 * 1000;

/**
 * 共享 `IndexedDBCache('csgoj_rank','logotable')` 单例，供队伍卡片等复用（与 `RankSystem.logoCache` 同库同表）。
 * @returns {Promise<InstanceType<typeof IndexedDBCache>|null>}
 */
async function RankToolGetSharedSchoolLogoIndexedDb() {
    if (typeof window === 'undefined' || typeof window.IndexedDBCache !== 'function') {
        return null;
    }
    if (!window.__rankToolSharedSchoolLogoIdb) {
        window.__rankToolSharedSchoolLogoIdb = new window.IndexedDBCache('csgoj_rank', 'logotable');
    }
    try {
        await window.__rankToolSharedSchoolLogoIdb.init();
    } catch (e) {
        return null;
    }
    return window.__rankToolSharedSchoolLogoIdb;
}

/**
 * 读取 / 写入校徽 data URL 缓存并拉取（与榜单 `CreateImageLazyLoader` 校徽分支同一契约）。
 *
 * @param {{ get: (key: string) => Promise<unknown>, set: (key: string, val: object, ttl?: number) => Promise<void> }} adapter 通常为 `RankSystem` 的 `logoCache.get/set` 或同表 `IndexedDBCache`
 * @param {string} baseUrl 与榜单 `InitSchoolLogoLoader` 的 `baseUrl` 一致
 * @param {string} identifier 校名字符串（与 `data-school` / `GetImageIdentifier` 一致）
 * @param {(fileKey: string) => Promise<string>} fetchByFileKey 无扩展名 fileKey → data URL（如 `FetchSchoolLogoDataUrl` 或 `RankToolFetchSchoolLogoDataUrl`）
 * @returns {Promise<{ dataUrl: string, fileKey: string }>}
 */
async function RankToolSchoolLogoResolveDataUrlWithIdb(adapter, baseUrl, identifier, fetchByFileKey) {
    const cacheKey = RankToolSchoolLogoIdbCacheKey(baseUrl, identifier);
    const fileKey = `${baseUrl}/${encodeURIComponent(identifier)}`;
    const cached = await adapter.get(cacheKey);
    if (cached && cached.flg_success === false) {
        const err = new Error('RankToolSchoolLogoIdbCachedFail');
        err.rankToolSchoolLogoIdbCachedFail = true;
        throw err;
    }
    if (cached && cached.flg_success !== false && cached.dataUrl) {
        return { dataUrl: cached.dataUrl, fileKey: cached.fileKey || fileKey };
    }
    try {
        const dataUrl = await fetchByFileKey(fileKey);
        const payload = {
            dataUrl,
            fileKey,
            ts: Date.now(),
            flg_success: true,
        };
        await adapter.set(cacheKey, payload, RANK_TOOL_SCHOOL_LOGO_IDB_TTL_OK_MS);
        return { dataUrl, fileKey };
    } catch (error) {
        const failurePayload = {
            dataUrl: null,
            ts: Date.now(),
            flg_success: false,
            error: error && error.message ? error.message : 'Load failed',
        };
        await adapter.set(cacheKey, failurePayload, RANK_TOOL_SCHOOL_LOGO_IDB_TTL_FAIL_MS);
        throw error;
    }
}

/**
 * 通用视口懒加载观察器（与 `rank.js` `CreateImageLazyLoader` 默认 `rootMargin: '50px'` 一致）。
 *
 * @param {(el: Element) => void} onIntersect 进入视口（或 rootMargin 预区）且 `unobserve` 后调用
 * @param {{ root?: Element | null, rootMargin?: string }} [opts]
 * @returns {IntersectionObserver | null}
 */
function RankToolCreateLazyIntersectObserver(onIntersect, opts) {
    if (typeof window === 'undefined' || typeof IntersectionObserver !== 'function') {
        return null;
    }
    const rootMargin = (opts && opts.rootMargin) || '50px';
    const root = opts && Object.prototype.hasOwnProperty.call(opts, 'root') ? opts.root : null;
    const io = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }
                const el = entry.target;
                io.unobserve(el);
                onIntersect(el);
            });
        },
        { root, rootMargin, threshold: 0 }
    );
    return io;
}

if (typeof window !== 'undefined') {
    window.RankToolFetchSchoolLogoDataUrl = RankToolFetchSchoolLogoDataUrl;
    window.RankToolSchoolLogoIdbCacheKey = RankToolSchoolLogoIdbCacheKey;
    window.RankToolGetSharedSchoolLogoIndexedDb = RankToolGetSharedSchoolLogoIndexedDb;
    window.RankToolSchoolLogoResolveDataUrlWithIdb = RankToolSchoolLogoResolveDataUrlWithIdb;
    window.RankToolCreateLazyIntersectObserver = RankToolCreateLazyIntersectObserver;
}

// #########################################
//  离线滚榜导出功能
// #########################################

/**
 * 标准化路径分隔符（Windows兼容）
 * 将路径统一使用正斜杠（/），适用于HTML中的路径引用
 */
function RankToolNormalizePath(path) {
    if (!path) return '';
    return path.replace(/\\/g, '/');
}

/**
 * 文件名安全化处理
 * 去掉所有不合法文件名字符，将连续的空格（包括单个空格和连续空格）替换成下划线
 * @param {string} filename - 原始文件名
 * @returns {string} 安全化的文件名
 */
function RankToolSanitizeFilename(filename) {
    if (!filename) return '';
    // 去掉不合法文件名字符（保留中文字符、字母、数字、连字符、下划线、点号）
    let sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
    // 将所有连续的空格（包括单个空格）替换成下划线
    sanitized = sanitized.replace(/\s+/g, '_');
    // 去掉首尾的下划线
    sanitized = sanitized.replace(/^_+|_+$/g, '');
    return sanitized || 'contest';
}

/**
 * 生成14位时间戳（YYYYMMDDHHmmss）
 * @returns {string} 14位时间戳字符串
 */
function RankToolGenerateTimestamp14() {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * 标准化文件系统路径分隔符（Windows兼容）
 * 将路径统一使用正斜杠（/），适用于zip文件内的路径
 */
function RankToolNormalizeFileSystemPath(path) {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * 将 CSS 文件内的 url() 相对引用解析为站点根路径（供 fetch；正确处理 ../）。
 * @param {string} cssUrl 如 /static/csgoj/contest/rank_font_faces.css
 * @param {string} ref url(...) 内片段
 */
function RankToolResolveUrlRelativeToCss(cssUrl, ref) {
    const r = (ref || '').trim();
    if (!r) return '';
    if (/^https?:\/\//i.test(r)) {
        return RankToolNormalizePath(r.replace(/\?.*$/, ''));
    }
    if (r.startsWith('/')) {
        return RankToolNormalizePath(r.split('?')[0]);
    }
    try {
        const base = 'http://csg-asset-resolve.invalid' + (cssUrl.startsWith('/') ? cssUrl : '/' + cssUrl);
        const abs = new URL(r, base);
        return RankToolNormalizePath(abs.pathname);
    } catch (e) {
        const baseDir = cssUrl.substring(0, cssUrl.lastIndexOf('/'));
        return RankToolNormalizePath(baseDir + '/' + r.replace(/^\.\//, ''));
    }
}

/**
 * 从CSS文件中提取字体文件URL
 */
async function RankToolExtractFontUrlsFromCSS(cssUrl) {
    try {
        const response = await fetch(cssUrl);
        if (!response.ok) return [];
        const cssText = await response.text();
        const fontUrls = [];
        // 匹配 url(...) 中的字体文件，包括查询参数
        const urlRegex = /url\(['"]?([^'"]*\.(woff2?|ttf|otf|eot))[^'"]*['"]?\)/gi;
        let match;
        while ((match = urlRegex.exec(cssText)) !== null) {
            let fontUrl = match[1];
            // 移除查询参数（如果有）
            if (fontUrl.includes('?')) {
                fontUrl = fontUrl.substring(0, fontUrl.indexOf('?'));
            }
            if (/^https?:\/\//i.test(fontUrl)) {
                fontUrls.push(RankToolNormalizePath(fontUrl));
            } else if (fontUrl.startsWith('/')) {
                fontUrls.push(RankToolNormalizePath(fontUrl));
            } else {
                fontUrls.push(RankToolResolveUrlRelativeToCss(cssUrl, fontUrl));
            }
        }
        return [...new Set(fontUrls)]; // 去重
    } catch (error) {
        console.warn('Failed to extract font URLs from CSS:', error);
        return [];
    }
}

/**
 * 获取资源文件（fetch并返回blob）
 */
async function RankToolFetchResource(url) {
    try {
        const response = await fetch(url);
        if (response.ok) {
            return await response.blob();
        }
        return null;
    } catch (error) {
        console.warn(`Failed to fetch resource: ${url}`, error);
        return null;
    }
}

/**
 * 滚榜队伍照片 URL（优先 WebP，兼容历史目录里的 JPG）。
 * @param {string} baseUrl 如 /upload/contest_attach/xxx/team_photo（可有或无尾斜杠）
 * @param {string} teamId
 * @returns {{ webp: string, jpg: string }}
 */
function RankToolTeamPhotoUrls(baseUrl, teamId) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const id = String(teamId || '').trim();
    return {
        webp: RankToolNormalizePath(`${base}/${id}.webp`),
        jpg: RankToolNormalizePath(`${base}/${id}.jpg`),
    };
}

/**
 * 依次拉取 WebP / JPG，返回首个成功的 blob 与扩展名（用于离线包等）。
 * @returns {Promise<{ blob: Blob, ext: string }|null>}
 */
async function RankToolFetchTeamPhotoBlobPreferWebp(baseUrl, teamId) {
    const { webp, jpg } = RankToolTeamPhotoUrls(baseUrl, teamId);
    let b = await RankToolFetchResource(webp);
    if (b) {
        return { blob: b, ext: 'webp' };
    }
    b = await RankToolFetchResource(jpg);
    if (b) {
        return { blob: b, ext: 'jpg' };
    }
    return null;
}

/**
 * 计算旗帜文件路径（基于rank.js的逻辑）
 */
async function RankToolCalculateFlagFilePath(region, flagBaseUrl, flagMapping) {
    if (!region || typeof region !== 'string') return null;
    const trimmedRegion = region.trim();
    if (!trimmedRegion) return null;
    
    // 先尝试从映射表查找
    if (flagMapping && flagMapping.has(trimmedRegion)) {
        const fileName = flagMapping.get(trimmedRegion);
        return RankToolNormalizePath(`${flagBaseUrl}/${fileName}`);
    }
    // 映射表没找到，直接尝试 region.png
    return RankToolNormalizePath(`${flagBaseUrl}/${encodeURIComponent(trimmedRegion)}.png`);
}

/**
 * 加载旗帜映射数据
 */
async function RankToolLoadFlagMapping(flagBaseUrl) {
    const mappingUrl = RankToolNormalizePath(`${flagBaseUrl}/region_mapping.json`);
    try {
        const response = await fetch(mappingUrl);
        if (!response.ok) return new Map();
        const data = await response.json();
        const mapping = new Map();
        data.forEach(region => {
            if (region['中文名']) mapping.set(region['中文名'], region['文件名']);
            if (region['中文简称']) mapping.set(region['中文简称'], region['文件名']);
            if (region['英文名']) mapping.set(region['英文名'], region['文件名']);
            if (region['英文简称']) mapping.set(region['英文简称'], region['文件名']);
            if (region['英文缩写']) mapping.set(region['英文缩写'], region['文件名']);
        });
        return mapping;
    } catch (error) {
        console.warn('Failed to load flag mapping:', error);
        return new Map();
    }
}

/**
 * 榜单 UI 自托管 woff2 路径清单（与 `rank_font_faces.css` 中 csg_rank 条目一致；供其它逻辑参考）。
 * 离线 ZIP 已改由 **`RankToolExtractFontUrlsFromCSS('/static/csgoj/contest/rank_font_faces.css')`** 自动收集字体（含 `../` 指向的 **`live_display`** 等），勿再双写维护。
 */
function RankToolRankUiFontFiles() {
    return [
        '/static/fonts/csg_rank/noto-sans-sc-chinese-simplified-400-normal.woff2',
        '/static/fonts/csg_rank/noto-sans-sc-chinese-simplified-500-normal.woff2',
        '/static/fonts/csg_rank/noto-sans-sc-chinese-simplified-700-normal.woff2',
        '/static/fonts/csg_rank/plus-jakarta-sans-latin-400-normal.woff2',
        '/static/fonts/csg_rank/plus-jakarta-sans-latin-500-normal.woff2',
        '/static/fonts/csg_rank/plus-jakarta-sans-latin-600-normal.woff2',
        '/static/fonts/csg_rank/plus-jakarta-sans-latin-700-normal.woff2'
    ];
}

/**
 * 导出离线滚榜包
 * @param {RankRollSystem} rankRollSystem - RankRollSystem实例
 * @param {Function} progressCallback - 进度回调函数 (message, progress)
 * @returns {Promise<Blob>} zip文件的Blob
 */
async function RankToolExportOfflineRollPack(rankRollSystem, progressCallback = null) {
    if (!window.zip) {
        throw new Error('zip.js library is not loaded');
    }
    
    if (!rankRollSystem || !rankRollSystem.data) {
        throw new Error('RankRollSystem instance or data not available');
    }
    
    const config = rankRollSystem.config || window.RANK_CONFIG || {};
    const updateProgress = (message, progress) => {
        if (progressCallback) progressCallback(message, progress);
    };
    
    // 初始化zip
    const zipWriter = new zip.ZipWriter(new zip.BlobWriter('application/zip'));
    const appIana = CsgRequireAppTimezoneForWireExport();
    const tc = rankRollSystem.data && rankRollSystem.data.time_context;
    if (!tc || typeof tc !== 'object' || !String(tc.wall_clock_timezone || '').trim()) {
        throw new Error('榜单数据缺少 time_context，请从赛内 contest_data_ajax 拉取后再导出离线包');
    }
    if (String(tc.wall_clock_timezone).trim() !== String(appIana).trim()) {
        throw new Error('榜单 time_context.wall_clock_timezone 与当前页 data-app-timezone 不一致');
    }
    const tzSidecarJson = JSON.stringify({
        iana: appIana,
        schema: 1
    });
    await zipWriter.add(
        'csg_export_timezone.json',
        new zip.BlobReader(new Blob([tzSidecarJson], { type: 'application/json' }))
    );
    const addedFiles = new Set(); // 避免重复文件
    
    // 统计文件数
    let totalFiles = 0;
    let processedFiles = 0;
    
    // 必需的文件列表（与比赛后台滚榜页 `rank_roll.php` 静态依赖对齐；体积不裁切）
    const requiredFiles = [
        '/static/js/csg_anim.js',
        '/static/js/csg_marquee_plain.js',
        '/static/csg_multiselect/csg_multiselect.js',
        '/static/csgoj/contest/rank_tool.js',
        '/static/csgoj/contest/rank_account_link.js',
        '/static/csgoj/contest/rank_award_lintel.js',
        '/static/csgoj/contest/rank.js',
        '/static/csgoj/contest/roll_award_overlay.js',
        '/static/csgoj/contest/rank_roll.js',
        '/static/csg_multiselect/csg_multiselect.css',
        '/static/csgoj/contest/rank_font_faces.css',
        '/static/csgoj/contest/rank.css',
        '/static/csgoj/contest/rank_skin_dark_stage.css',
        '/static/csgoj/contest/rank_skin_light_macaron.css',
        '/static/csgoj/contest/rank_page.css',
        '/static/csgoj/contest/roll_award_overlay.css'
    ];
    totalFiles += requiredFiles.length;
    
    // Bootstrap Icons CSS
    const bootstrapIconsCSS = '/static/bootstrap-icons-1.13.1/font/bootstrap-icons.min.css';
    totalFiles += 1;
    
    // 数据文件
    totalFiles += 1;

    // 缺省校徽占位（rank.css 滚榜行 .school-logo 默认 background-image: /static/image/logos/ccpc.webp）
    totalFiles += 1;
    
    // 计算图片文件数
    const teams = rankRollSystem.data.team || [];
    const schools = new Set();
    const regions = new Set();
    teams.forEach(team => {
        if (team.team_id) totalFiles += 1; // 队伍照片
        if (team.school) schools.add(team.school);
        if (team.region) regions.add(team.region);
    });
    // 注意：校徽和旗帜不再打包文件（只生成base64到images.js），所以不计算到totalFiles

    const rankFontFacesCssUrl = '/static/csgoj/contest/rank_font_faces.css';
    const rankFontFaceUrls = await RankToolExtractFontUrlsFromCSS(rankFontFacesCssUrl);
    totalFiles += rankFontFaceUrls.length;
    
    // 辅助函数：添加文件到zip
    const addFileToZip = async (filePath, content, zipPath = null) => {
        const normalizedZipPath = RankToolNormalizeFileSystemPath(zipPath || filePath);
        if (addedFiles.has(normalizedZipPath)) {
            return; // 跳过重复文件
        }
        
        let blob;
        if (content instanceof Blob) {
            blob = content;
        } else if (typeof content === 'string') {
            blob = new Blob([content], { type: 'text/plain' });
        } else {
            return; // 无效内容
        }
        
        await zipWriter.add(normalizedZipPath, new zip.BlobReader(blob));
        addedFiles.add(normalizedZipPath);
        processedFiles++;
        updateProgress(`正在打包 ${normalizedZipPath}`, (processedFiles / totalFiles * 100).toFixed(2));
    };
    
    // 辅助函数：获取并添加远程文件
    const fetchAndAddFile = async (url, zipPath) => {
        const normalizedUrl = RankToolNormalizePath(url);
        const normalizedZipPath = RankToolNormalizeFileSystemPath(zipPath || normalizedUrl);
        
        if (addedFiles.has(normalizedZipPath)) {
            return; // 已添加
        }
        
        const blob = await RankToolFetchResource(normalizedUrl);
        if (blob) {
            await zipWriter.add(normalizedZipPath, new zip.BlobReader(blob));
            addedFiles.add(normalizedZipPath);
            processedFiles++;
            updateProgress(`正在打包 ${normalizedZipPath}`, (processedFiles / totalFiles * 100).toFixed(2));
        }
    };
    
    // 1. 打包必需的JS和CSS文件
    updateProgress('正在获取必需文件...', 0);
    for (const filePath of requiredFiles) {
        // 将绝对路径转换为相对路径（去掉前导斜杠）
        const zipPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
        await fetchAndAddFile(filePath, zipPath);
    }
    
    // 2. 打包Bootstrap Icons CSS并提取字体文件
    updateProgress('正在获取Bootstrap Icons...', 0);
    const bootstrapIconsZipPath = bootstrapIconsCSS.startsWith('/') ? bootstrapIconsCSS.substring(1) : bootstrapIconsCSS;
    await fetchAndAddFile(bootstrapIconsCSS, bootstrapIconsZipPath);
    
    // 提取字体文件URL
    const fontUrls = await RankToolExtractFontUrlsFromCSS(bootstrapIconsCSS);
    for (const fontUrl of fontUrls) {
        // Bootstrap Icons字体通常在同一目录的fonts子目录下
        const fontPath = RankToolNormalizePath(fontUrl);
        // 将绝对路径转换为相对路径（去掉前导斜杠）
        const fontZipPath = fontPath.startsWith('/') ? fontPath.substring(1) : fontPath;
        await fetchAndAddFile(fontPath, fontZipPath);
    }

    updateProgress('正在获取 rank_font_faces 引用的字体（含 csg_rank / live_display 等）...', 0);
    for (const fp of rankFontFaceUrls) {
        const fontPath = RankToolNormalizePath(fp);
        const fontZipPath = fontPath.startsWith('/') ? fontPath.substring(1) : fontPath;
        await fetchAndAddFile(fontPath, fontZipPath);
    }

    // 3. 打包图片资源
    updateProgress('正在获取图片资源...', 0);
    /** 已写入 zip 的缺省校徽相对 index.html 的 url（如 ./static/image/logos/ccpc.svg），供内联 CSS 覆盖绝对路径 */
    let offlineRollCcpcStyleUrl = '';
    
    // 初始化离线图片对象（用于生成images.js）
    const offlineImages = {
        school_badge: {},
        region_flag: {}
    };
    
    // 3.0 缺省校徽底图（与 rank.css 一致；离线场景 /static/... 常无法解析，故打入包内并用 index 内联样式覆盖）
    const ccpcLogoCandidates = [
        { path: '/static/image/logos/ccpc.webp', zip: 'static/image/logos/ccpc.webp' },
        { path: '/static/image/logos/ccpc.png', zip: 'static/image/logos/ccpc.png' },
        { path: '/static/image/logos/ccpc.svg', zip: 'static/image/logos/ccpc.svg' }
    ];
    for (const c of ccpcLogoCandidates) {
        const blob = await RankToolFetchResource(RankToolNormalizePath(c.path));
        if (blob) {
            const zp = RankToolNormalizeFileSystemPath(c.zip);
            if (!addedFiles.has(zp)) {
                await zipWriter.add(zp, new zip.BlobReader(blob));
                addedFiles.add(zp);
            }
            offlineRollCcpcStyleUrl = './' + c.zip;
            break;
        }
    }
    processedFiles++;
    updateProgress(
        offlineRollCcpcStyleUrl
            ? `已打包缺省校徽占位: ${offlineRollCcpcStyleUrl}`
            : '缺省校徽占位跳过（未找到 ccpc.webp / ccpc.png / ccpc.svg）',
        (processedFiles / totalFiles * 100).toFixed(2)
    );
    
    // 辅助函数：将Blob转换为base64 data URL
    const imageToBase64 = async (blob) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };
    
    // 3.1 队伍照片
    const teamPhotoBase = config.team_photo_url || '/upload/contest_attach/default/team_photo';
    const teamPhotoZipBase = 'static/team_photo';
    for (const team of teams) {
        if (team.team_id) {
            const got = await RankToolFetchTeamPhotoBlobPreferWebp(teamPhotoBase, team.team_id);
            if (got) {
                const photoZipPath = RankToolNormalizeFileSystemPath(`${teamPhotoZipBase}/${team.team_id}.${got.ext}`);
                if (!addedFiles.has(photoZipPath)) {
                    await zipWriter.add(photoZipPath, new zip.BlobReader(got.blob));
                    addedFiles.add(photoZipPath);
                }
            }
            processedFiles++;
            updateProgress(`队伍照片 ${team.team_id}`, (processedFiles / totalFiles * 100).toFixed(2));
        }
    }
    
    // 3.2 学校徽章（只生成base64，不打包文件）
    const schoolBadgeBase = config.school_badge_url || '/static/image/school_badge';
    for (const school of schools) {
        if (school) {
            const badgeUrl = RankToolNormalizePath(`${schoolBadgeBase}/${school}.webp`);
            try {
                const blob = await RankToolFetchResource(badgeUrl);
                if (blob) {
                    // 转换为base64并记录（使用URL编码的学校名作为key，与rank.js中的逻辑一致）
                    const encodedSchool = encodeURIComponent(school);
                    const base64DataUrl = await imageToBase64(blob);
                    offlineImages.school_badge[encodedSchool] = base64DataUrl;
                    updateProgress(`正在处理校徽: ${school}`, (processedFiles / totalFiles * 100).toFixed(2));
                }
            } catch (e) {
                // 图片加载失败，跳过（不记录到offlineImages）
                console.warn(`Failed to load school badge: ${school}`, e);
            }
        }
    }
    
    // 3.3 旗帜（需要先加载映射，只生成base64，不打包文件）
    updateProgress('正在加载旗帜映射...', 0);
    const flagBaseUrl = config.region_flag_url || '/static/image/region_flag';
    const flagMapping = await RankToolLoadFlagMapping(flagBaseUrl);
    
    for (const region of regions) {
        if (region) {
            const flagUrl = await RankToolCalculateFlagFilePath(region, flagBaseUrl, flagMapping);
            if (flagUrl) {
                // 提取文件名
                const fileName = flagUrl.substring(flagUrl.lastIndexOf('/') + 1);
                try {
                    const blob = await RankToolFetchResource(flagUrl);
                    if (blob) {
                        // 转换为base64并记录（使用文件名作为key）
                        const base64DataUrl = await imageToBase64(blob);
                        offlineImages.region_flag[fileName] = base64DataUrl;
                        updateProgress(`正在处理旗帜: ${fileName}`, (processedFiles / totalFiles * 100).toFixed(2));
                    }
                } catch (e) {
                    // 图片加载失败，跳过
                    console.warn(`Failed to load flag: ${fileName}`, e);
                }
            }
        }
    }
    
    // 4. 打包数据文件
    updateProgress('正在打包数据文件...', 0);
    // 打包为JSON格式（用于api_url加载）
    const dataJson = JSON.stringify({
        code: 1,
        msg: 'ok',
        data: rankRollSystem.data
    }, null, 2);
    await addFileToZip('static/data.json', dataJson, 'static/data.json');
    
    // 也打包为JS格式（用于直接加载，兼容性）
    const dataJs = `var cdata = ${JSON.stringify(rankRollSystem.data)};`;
    await addFileToZip('static/data.js', dataJs, 'static/data.js');
    
    // 4.5 生成离线图片数据文件（images.js）
    updateProgress('正在生成离线图片数据...', 0);
    const imagesJs = `window.OFFLINE_IMAGES = ${JSON.stringify(offlineImages, null, 2)};`;
    await addFileToZip('static/images.js', imagesJs, 'static/images.js');
    
    // 5. 生成index.html
    updateProgress('正在生成index.html...', 0);
    const offlineCcpcCssBlock = offlineRollCcpcStyleUrl
        ? `
        /* 离线包：缺省校徽（无 has-background 时与 rank.css 滚榜 .school-logo 底图一致；相对路径适配 file:// 与本地根目录服务） */
        .rank-system[data-rank-mode="roll"] .rank-row-roll .school-logo:not(.has-background) {
            background-image: url('${offlineRollCcpcStyleUrl}');
        }`
        : '';
    
    // 构建配置（使用相对路径）
    // api_url 设置为 cdata 对象，rank.js 会识别并直接使用
    const offlineConfig = {
        key: config.key || 'offline_roll',
        cid_list: config.cid_list || '',
        api_url: null, // 将在脚本中设置为 cdata
        team_photo_url: './static/team_photo',
        school_badge_url: './static/school_badge',
        region_flag_url: './static/region_flag',
        rank_mode: 'roll',
        flg_rank_cache: false, // 离线模式禁用缓存
        flg_show_page_contest_title: config.flg_show_page_contest_title !== undefined ? config.flg_show_page_contest_title : false,
        backend_time_diff: config.backend_time_diff || 0,
        flg_show_time_progress: config.flg_show_time_progress !== undefined ? config.flg_show_time_progress : false,
        flg_show_controls_toolbar: config.flg_show_controls_toolbar !== undefined ? config.flg_show_controls_toolbar : false,
        flg_show_export_offline_roll: false  // 离线滚榜包中不显示导出按钮
    };
    
    // 转义HTML中的特殊字符
    const contestTitle = (rankRollSystem.data?.contest?.title || '滚榜').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${contestTitle}</title>
    <link rel="stylesheet" type="text/css" href="./static/csgoj/contest/rank_font_faces.css">
    <link rel="stylesheet" type="text/css" href="./static/csgoj/contest/rank.css">
    <link rel="stylesheet" type="text/css" href="./static/csgoj/contest/rank_skin_dark_stage.css">
    <link rel="stylesheet" type="text/css" href="./static/csgoj/contest/rank_skin_light_macaron.css">
    <link rel="stylesheet" type="text/css" href="./static/csgoj/contest/rank_page.css">
    <link rel="stylesheet" type="text/css" href="./static/csgoj/contest/roll_award_overlay.css">
    <link rel="stylesheet" type="text/css" href="./static/csg_multiselect/csg_multiselect.css">
    <link rel="stylesheet" type="text/css" href="./static/bootstrap-icons-1.13.1/font/bootstrap-icons.min.css">
    <style>
        /* 页头样式 - Bootstrap 5 风格 */
        body {
            margin: 0;
            padding: 0;
            background-color: #f8f9fa;
        }
        .offline-header {
            background-color: #ffffff;
            border-bottom: 1px solid #dee2e6;
            padding: 1.5rem 1rem;
            margin-bottom: 0;
        }
        .offline-header-content {
            max-width: 1200px;
            margin: 0 auto;
        }
        .offline-header-title {
            font-size: 2rem;
            font-weight: 500;
            color: #212529;
            margin: 0 0 0.5rem 0;
            line-height: 1.3;
            word-wrap: break-word;
            word-break: break-word;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .offline-header-subtitle {
            font-size: 0.875rem;
            color: #6c757d;
            margin: 0;
            font-weight: 400;
        }
        @media (max-width: 768px) {
            .offline-header {
                padding: 1.25rem 0.75rem;
            }
            .offline-header-title {
                font-size: 1.5rem;
                -webkit-line-clamp: 2;
            }
            .offline-header-subtitle {
                font-size: 0.8125rem;
            }
        }
        .offline-rank-wrapper {
            max-width: 1200px;
            width: 100%;
            margin: 0 auto;
            padding: 1rem;
        }
        #rank-container {
            background-color: #ffffff;
        }
${offlineCcpcCssBlock}
    </style>
</head>
<body>
    <!-- 页头 -->
    <header class="offline-header">
        <div class="offline-header-content">
            <h1 class="offline-header-title">${contestTitle}</h1>
            <p class="offline-header-subtitle">离线滚榜 Offline Roll Ranking</p>
        </div>
    </header>
    
    <!-- 榜单包装容器（用于居中） -->
    <div class="offline-rank-wrapper">
        <div id="rank-container"></div>
    </div>

    <!-- 先加载数据文件 -->
    <script type="text/javascript" src="./static/data.js"></script>
    <!-- 加载离线图片数据 -->
    <script type="text/javascript" src="./static/images.js"></script>
    
    <!-- 再加载依赖的JS文件 -->
    <script type="text/javascript" src="./static/js/csg_anim.js"></script>
    <script type="text/javascript" src="./static/js/csg_marquee_plain.js"></script>
    <script type="text/javascript" src="./static/csg_multiselect/csg_multiselect.js"></script>
    <script type="text/javascript" src="./static/csgoj/contest/rank_tool.js"></script>
    <script type="text/javascript" src="./static/csgoj/contest/rank_account_link.js"></script>
    <script type="text/javascript" src="./static/csgoj/contest/rank_award_lintel.js"></script>
    <script type="text/javascript" src="./static/csgoj/contest/rank.js"></script>
    <script type="text/javascript" src="./static/csgoj/contest/roll_award_overlay.js"></script>
    <script type="text/javascript" src="./static/csgoj/contest/rank_roll.js"></script>
    
    <script>
        // 配置信息 - 离线滚榜页面配置
        // 将 api_url 设置为 cdata 对象（rank.js 会识别并直接使用）
        window.RANK_CONFIG = ${JSON.stringify(offlineConfig, null, 8)};
        if (typeof cdata !== 'undefined') {
            window.RANK_CONFIG.api_url = cdata;
        } else {
            console.error('cdata not found. Make sure data.js is loaded.');
        }
        
        // 等待DOM加载完成后初始化
        (function() {
            function initRollSystem() {
                if (typeof RankRollSystem === 'undefined') {
                    console.error('RankRollSystem not found. Make sure all JS files are loaded.');
                    return;
                }
                
                if (typeof cdata === 'undefined') {
                    console.error('cdata not found. Make sure data.js is loaded.');
                    return;
                }
                
                // 初始化滚榜系统（会自动识别 api_url 是数据对象）
                const rollSystem = new RankRollSystem('rank-container', window.RANK_CONFIG);
                
                // 将 rollSystem 保存到全局，方便调试
                window.rollSystem = rollSystem;
            }
            
            // 如果DOM已经加载完成，直接初始化；否则等待
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initRollSystem);
            } else {
                // 延迟一下确保所有脚本都加载完成
                setTimeout(initRollSystem, 100);
            }
        })();
    </script>
</body>
</html>`;
    
    await addFileToZip('index.html', indexHtml, 'index.html');
    
    // 6. 完成打包
    updateProgress('正在完成打包...', 100);
    const zipBlob = await zipWriter.close();
    
    return zipBlob;
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.RankToolExportOfflineRollPack = RankToolExportOfflineRollPack;
    window.RankToolTeamPhotoUrls = RankToolTeamPhotoUrls;
    window.RankToolFetchTeamPhotoBlobPreferWebp = RankToolFetchTeamPhotoBlobPreferWebp;
    window.RankToolNormalizePath = RankToolNormalizePath;
    window.RankToolResolveUrlRelativeToCss = RankToolResolveUrlRelativeToCss;
    window.RankToolExtractFontUrlsFromCSS = RankToolExtractFontUrlsFromCSS;
    window.RankToolNormalizeFileSystemPath = RankToolNormalizeFileSystemPath;
    window.RankToolSanitizeFilename = RankToolSanitizeFilename;
    window.RankToolGenerateTimestamp14 = RankToolGenerateTimestamp14;
    window.RankToolApplyMedalFlagsByGroupFromList = RankToolApplyMedalFlagsByGroupFromList;
    window.RankToolRankMedalGetAcTeamBaseFromUi = RankToolRankMedalGetAcTeamBaseFromUi;
    window.RankToolRankMedalGetOneTwoThreeFromUi = RankToolRankMedalGetOneTwoThreeFromUi;
    window.RankToolContestGroupAccentHex = RankToolContestGroupAccentHex;
    window.RankToolContestGroupOverlayIconClass = RankToolContestGroupOverlayIconClass;
    window.RankToolRankUiFontFiles = RankToolRankUiFontFiles;
    window.RankToolMeasureSchoolBadgeContentRadiusPx = RankToolMeasureSchoolBadgeContentRadiusPx;
    window.RankToolStripSchoolBadgeEdgeBackgroundFromImage = RankToolStripSchoolBadgeEdgeBackgroundFromImage;
    window.RankToolLoadSchoolBadgeProcessedPack = RankToolLoadSchoolBadgeProcessedPack;
    window.RankToolApplySchoolBadgeBackgroundFit = RankToolApplySchoolBadgeBackgroundFit;
    window.RankToolDisconnectSchoolBadgeResizeObserver = RankToolDisconnectSchoolBadgeResizeObserver;
}