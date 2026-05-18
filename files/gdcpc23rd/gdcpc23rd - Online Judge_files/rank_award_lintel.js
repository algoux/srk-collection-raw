/**
 * 多赛事归属：行顶奖区指示楣条（与 rank.js / rank_roll.js 协同；依赖 rank_tool.js）
 */
(function (global) {
    function isEnabled(rs) {
        return !!(rs && rs.flgAwardLintelEnabled !== false);
    }

    function setEnabled(rs, on) {
        if (!rs) return;
        rs.flgAwardLintelEnabled = !!on;
        syncAll(rs);
    }

    function effective(rs) {
        if (!rs || rs.currentMode === 'school') return false;
        if (rs.flgAwardLintelEnabled === false) return false;
        if (typeof rs.IsMultiGroupEnabled !== 'function' || !rs.IsMultiGroupEnabled()) return false;
        const sel = rs.selectedGroupIds || [];
        return sel.length > 1;
    }

    function groupNames(g) {
        const cn = String(g.group_name || g.name || '').trim();
        const en = String(g.group_name_en || g.name_en || '').trim();
        return { cn: cn || '—', en: en || cn || '—' };
    }

    function orderedGroups(rs) {
        const all = rs.GetContestGroups ? rs.GetContestGroups() : [];
        const map = new Map(all.map((g) => [String(g.group_id), g]));
        const sel = rs.selectedGroupIds || [];
        const out = [];
        sel.forEach((id) => {
            const hit = map.get(String(id));
            if (hit) out.push(hit);
        });
        return out;
    }

    function segmentState(team, gid, flgVal) {
        const gids = Array.isArray(team && team.group_ids) ? team.group_ids : [];
        if (!gids.includes(gid)) return 'na';
        const v = parseInt(flgVal, 10) || 0;
        if (v === 1) return 'gold';
        if (v === 2) return 'silver';
        if (v === 3) return 'bronze';
        return 'none';
    }

    function readOneTwoThree() {
        if (typeof global.RankToolRankMedalGetOneTwoThreeFromUi === 'function') {
            return !!global.RankToolRankMedalGetOneTwoThreeFromUi();
        }
        const el = typeof document !== 'undefined' ? document.getElementById('switch_one_two_three') : null;
        return el ? !!el.checked : false;
    }

    function bandLabels() {
        if (readOneTwoThree()) {
            return {
                gold: { cn: '一等奖', en: 'First prize' },
                silver: { cn: '二等奖', en: 'Second prize' },
                bronze: { cn: '三等奖', en: 'Third prize' }
            };
        }
        return {
            gold: { cn: '金奖', en: 'Gold' },
            silver: { cn: '银奖', en: 'Silver' },
            bronze: { cn: '铜奖', en: 'Bronze' }
        };
    }

    function rankLine(rankStr) {
        return rankStr === '—' ? '名次：—' : `名次：第 ${rankStr} 名`;
    }

    /** 规范多行标签（\n 换行；与 rank.css 中 tooltip 的 pre-line 配合） */
    function tooltipForSegment(group, state, displayRank) {
        const { cn, en } = groupNames(group);
        const labels = bandLabels();
        const rankStr =
            displayRank === '' || displayRank === null || displayRank === undefined || displayRank === '*'
                ? '—'
                : String(displayRank);
        const headCn = `归属：${cn}`;
        const headEn = `Category: ${en}`;

        if (state === 'na') {
            return {
                cn: `${headCn}\n状态：不适用\n说明：未编入该归属。`,
                en: `${headEn}\nStatus: N/A\nNote: Not in this category.`
            };
        }
        if (state === 'gold') {
            return {
                cn: `${headCn}\n${rankLine(rankStr)}\n奖档：${labels.gold.cn}`,
                en: `${headEn}\nRank: ${rankStr}\nBand: ${labels.gold.en}`
            };
        }
        if (state === 'silver') {
            return {
                cn: `${headCn}\n${rankLine(rankStr)}\n奖档：${labels.silver.cn}`,
                en: `${headEn}\nRank: ${rankStr}\nBand: ${labels.silver.en}`
            };
        }
        if (state === 'bronze') {
            return {
                cn: `${headCn}\n${rankLine(rankStr)}\n奖档：${labels.bronze.cn}`,
                en: `${headEn}\nRank: ${rankStr}\nBand: ${labels.bronze.en}`
            };
        }
        return {
            cn: `${headCn}\n${rankLine(rankStr)}\n奖档：无\n说明：不在该归属金银铜奖档内。`,
            en: `${headEn}\nRank: ${rankStr}\nBand: None\nNote: Outside the gold, silver, and bronze bands for this category.`
        };
    }

    function ensureBar(row) {
        let bar = row.querySelector('.rank-award-lintel');
        if (bar) return bar;
        bar = document.createElement('div');
        bar.className = 'rank-award-lintel';
        bar.setAttribute('role', 'presentation');
        bar.setAttribute('aria-hidden', 'true');
        const track = document.createElement('div');
        track.className = 'rank-award-lintel-track';
        bar.appendChild(track);
        row.insertBefore(bar, row.firstChild);
        return bar;
    }

    function syncRow(row, rs, item) {
        if (!row || !rs || !item) return;
        const team = item.team;
        if (!team || rs.currentMode === 'school') {
            const b0 = row.querySelector('.rank-award-lintel');
            if (b0) b0.hidden = true;
            return;
        }
        if (!effective(rs)) {
            const b1 = row.querySelector('.rank-award-lintel');
            if (b1) b1.hidden = true;
            return;
        }
        const groups = orderedGroups(rs);
        if (groups.length <= 1) {
            const b2 = row.querySelector('.rank-award-lintel');
            if (b2) b2.hidden = true;
            return;
        }
        const bar = ensureBar(row);
        bar.hidden = false;
        let track = bar.querySelector('.rank-award-lintel-track');
        if (!track) {
            track = document.createElement('div');
            track.className = 'rank-award-lintel-track';
            bar.appendChild(track);
        }
        let segs = track.querySelectorAll('.rank-award-lintel-seg');
        if (segs.length !== groups.length) {
            track.innerHTML = '';
            groups.forEach(() => {
                const seg = document.createElement('div');
                seg.className = 'rank-award-lintel-seg';
                track.appendChild(seg);
            });
            segs = track.querySelectorAll('.rank-award-lintel-seg');
        }
        const flgMap = item.flg_award_by_group || {};
        const drMap = item.displayRankByGroup || {};
        segs.forEach((seg, idx) => {
            const g = groups[idx];
            const gid = g.group_id;
            const state = segmentState(team, gid, flgMap[gid]);
            seg.setAttribute('data-award-state', state);
            const tt = tooltipForSegment(g, state, drMap[gid]);
            seg.setAttribute('title-cn', tt.cn);
            seg.setAttribute('title-en', tt.en);
        });
    }

    function resolveItemForRow(rs, rowId) {
        if (rs.currentMode === 'roll' && rs.rollDataMap && rs.rollDataMap.has(rowId)) {
            return rs.rollDataMap.get(rowId);
        }
        if (Array.isArray(rs.rankList)) {
            const hit = rs.rankList.find(
                (x) => String(x.item_key) === String(rowId) || String(x.team_id) === String(rowId)
            );
            if (hit) return hit;
        }
        if (rs.rollData && Array.isArray(rs.rollData)) {
            return rs.rollData.find((x) => String(x.item_key) === String(rowId) || String(x.team_id) === String(rowId));
        }
        return null;
    }

    function syncAll(rs) {
        const grid = rs.elements && rs.elements.rankGrid;
        if (!grid) return;
        grid.querySelectorAll('.rank-row').forEach((row) => {
            const rowId = row.getAttribute('data-row-id');
            if (!rowId) return;
            const item = resolveItemForRow(rs, rowId);
            if (item) syncRow(row, rs, item);
            else {
                const bar = row.querySelector('.rank-award-lintel');
                if (bar) bar.hidden = true;
            }
        });
    }

    global.RankAwardLintel = {
        effective,
        isEnabled,
        setEnabled,
        syncRow,
        syncAll
    };
})(typeof window !== 'undefined' ? window : this);
