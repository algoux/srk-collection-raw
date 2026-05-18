/**
 * 表单时间与「应用时区（与 PHP default_timezone 一致）」互转：供比赛/考试编辑等复用。
 * 依赖 global.js：CsgGetAppTimezone、CsgNaiveAppTzToUtcMs、CsgWallClockStringInTimeZone、CsgLocalUtcOffsetLabel
 */
(function (global) {
    'use strict';

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function readIntInput(id) {
        var el = document.getElementById(id);
        if (!el) {
            return null;
        }
        var v = String(el.value != null ? el.value : '').trim();
        if (v === '') {
            return null;
        }
        var n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
    }

    function buildAppNaiveFromPrefix(prefix) {
        var y = readIntInput(prefix + '_year');
        var m = readIntInput(prefix + '_month');
        var d = readIntInput(prefix + '_day');
        var H = readIntInput(prefix + '_hour');
        var M = readIntInput(prefix + '_minute');
        if ([y, m, d, H, M].some(function (x) { return x === null; })) {
            return '';
        }
        return y + '-' + pad2(m) + '-' + pad2(d) + ' ' + pad2(H) + ':' + pad2(M) + ':00';
    }

    function writePartsToPrefix(prefix, y, m, d, H, M) {
        var map = [
            [prefix + '_year', String(y)],
            [prefix + '_month', pad2(m)],
            [prefix + '_day', pad2(d)],
            [prefix + '_hour', pad2(H)],
            [prefix + '_minute', pad2(M)]
        ];
        for (var i = 0; i < map.length; i++) {
            var el = document.getElementById(map[i][0]);
            if (el) {
                el.value = map[i][1];
            }
        }
    }

    /**
     * 数据库/接口用的「应用时区墙钟」YYYY-MM-DD HH:mm:ss → datetime-local 控件值（按浏览器本地时区展示同一瞬间）。
     */
    global.CsgAppNaiveSqlToDatetimeLocalValue = function (sql) {
        if (!sql || typeof CsgNaiveAppTzToUtcMs !== 'function') {
            return '';
        }
        var ms = CsgNaiveAppTzToUtcMs(String(sql).trim());
        if (!Number.isFinite(ms)) {
            return '';
        }
        var dt = new Date(ms);
        return (
            dt.getFullYear() +
            '-' +
            pad2(dt.getMonth() + 1) +
            '-' +
            pad2(dt.getDate()) +
            'T' +
            pad2(dt.getHours()) +
            ':' +
            pad2(dt.getMinutes())
        );
    };

    /**
     * datetime-local 值（按本地解析）→ 应用时区墙钟 YYYY-MM-DD HH:mm:ss
     */
    global.CsgDatetimeLocalValueToAppNaiveSql = function (val) {
        if (!val || typeof CsgWallClockStringInTimeZone !== 'function' || typeof CsgGetAppTimezone !== 'function') {
            return '';
        }
        var d = new Date(val);
        if (Number.isNaN(d.getTime())) {
            return '';
        }
        return CsgWallClockStringInTimeZone(d.getTime(), CsgGetAppTimezone());
    };

    /**
     * 将 #contest_edit_form 内 start_/end_ 数字框从「应用时区墙钟」改写为「浏览器本地墙钟」同一瞬间的分量（仅非 hidden 的 start_year）。
     */
    global.CsgContestEditTimeTzInit = function () {
        var sy = document.getElementById('start_year');
        if (!sy || String(sy.type || '').toLowerCase() === 'hidden') {
            return false;
        }
        if (!document.getElementById('contest_edit_form')) {
            return false;
        }
        if (typeof CsgNaiveAppTzToUtcMs !== 'function' || typeof CsgGetAppTimezone !== 'function') {
            return false;
        }
        ['start', 'end'].forEach(function (pfx) {
            var naive = buildAppNaiveFromPrefix(pfx);
            if (!naive) {
                return;
            }
            var ms = CsgNaiveAppTzToUtcMs(naive);
            if (!Number.isFinite(ms)) {
                return;
            }
            var dt = new Date(ms);
            writePartsToPrefix(
                pfx,
                dt.getFullYear(),
                dt.getMonth() + 1,
                dt.getDate(),
                dt.getHours(),
                dt.getMinutes()
            );
        });

        if (typeof CsgLocalUtcOffsetLabel === 'function') {
            ['csg-contest-edit-label-start', 'csg-contest-edit-label-end'].forEach(function (lid) {
                var lab = document.getElementById(lid);
                if (!lab) {
                    return;
                }
                var mark = lab.querySelector('.csg-local-tz-mark');
                if (!mark) {
                    mark = document.createElement('span');
                    mark.className = 'csg-local-tz-mark';
                    lab.appendChild(mark);
                }
                mark.textContent = CsgLocalUtcOffsetLabel(Date.now());
            });
        }
        return true;
    };

    /**
     * 提交前：将当前数字框按「本地墙钟」读入，写回「应用时区墙钟」分量（供 PHP strtotime 语义一致）。
     */
    global.CsgContestEditFlushLocalTimesToAppBeforeSubmit = function () {
        var sy = document.getElementById('start_year');
        if (!sy || String(sy.type || '').toLowerCase() === 'hidden') {
            return false;
        }
        if (typeof CsgWallClockStringInTimeZone !== 'function' || typeof CsgGetAppTimezone !== 'function') {
            return false;
        }
        var tz = CsgGetAppTimezone();
        ['start', 'end'].forEach(function (pfx) {
            var y = readIntInput(pfx + '_year');
            var m = readIntInput(pfx + '_month');
            var d = readIntInput(pfx + '_day');
            var H = readIntInput(pfx + '_hour');
            var M = readIntInput(pfx + '_minute');
            if ([y, m, d, H, M].some(function (x) { return x === null; })) {
                return;
            }
            var loc = new Date(y, m - 1, d, H, M, 0, 0);
            if (
                loc.getFullYear() !== y ||
                loc.getMonth() !== m - 1 ||
                loc.getDate() !== d ||
                loc.getHours() !== H ||
                loc.getMinutes() !== M
            ) {
                return;
            }
            var wall = CsgWallClockStringInTimeZone(loc.getTime(), tz);
            var parts = String(wall).trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
            if (!parts) {
                return;
            }
            writePartsToPrefix(
                pfx,
                parseInt(parts[1], 10),
                parseInt(parts[2], 10),
                parseInt(parts[3], 10),
                parseInt(parts[4], 10),
                parseInt(parts[5], 10)
            );
        });
        return true;
    };
})(window);
