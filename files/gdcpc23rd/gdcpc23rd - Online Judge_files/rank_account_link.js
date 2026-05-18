/**
 * 榜单「登录账号」跳转：与 oj_status.js FormatterStatusUser 同一套分支（比赛类型 / #cpc 账号 / 系统用户）。
 * 由页面在 RANK_CONFIG.rank_account_link_ctx 注入 module、contest_id、contest_type（contest.private%10），与 rank.js 解耦。
 */
(function (global) {
    function RankAccountLinkParseCpcContestAccount(rawUserId) {
        const userId = String(rawUserId || '');
        const match = userId.match(/^#cpc(\d+)_(.+)$/i);
        if (!match) {
            return null;
        }
        return {
            contestId: match[1],
            teamId: match[2],
            fullUserId: userId
        };
    }

    /**
     * @param {{ module?: string, contestId?: string|number, contestType?: number, userId?: string }} ctx
     * @returns {string} 站点根相对路径，如 /csgoj/contest/teaminfo?...；无法解析时返回空串
     */
    function RankAccountLinkResolveHref(ctx) {
        const module = String(ctx && ctx.module != null ? ctx.module : '')
            .trim()
            .replace(/^\/+|\/+$/g, '');
        const userId = String(ctx && ctx.userId != null ? ctx.userId : '').trim();
        if (!module || !userId) {
            return '';
        }
        const contestId = String(ctx.contestId != null ? ctx.contestId : '')
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean)[0] || '';
        const ctRaw = ctx.contestType;
        const contestType = Number.isFinite(Number(ctRaw)) ? parseInt(ctRaw, 10) : NaN;

        if (contestType === 5 || contestType === 2) {
            if (!contestId) {
                return '';
            }
            return (
                '/' +
                module +
                '/contest/teaminfo?cid=' +
                encodeURIComponent(contestId) +
                '&team_id=' +
                encodeURIComponent(userId)
            );
        }

        const parsed = RankAccountLinkParseCpcContestAccount(userId);
        if (parsed) {
            return (
                '/' +
                module +
                '/contest/teaminfo?cid=' +
                encodeURIComponent(parsed.contestId) +
                '&team_id=' +
                encodeURIComponent(parsed.teamId)
            );
        }

        return '/' + module + '/user/userinfo?user_id=' + encodeURIComponent(userId);
    }

    global.RankAccountLinkParseCpcContestAccount = RankAccountLinkParseCpcContestAccount;
    global.RankAccountLinkResolveHref = RankAccountLinkResolveHref;
})(typeof window !== 'undefined' ? window : this);
