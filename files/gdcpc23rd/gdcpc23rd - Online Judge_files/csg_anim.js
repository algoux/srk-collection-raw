/**
 * CSG Animation Library
 * 高性能动画库，支持智能排序动画
 * 
 * 约定：
 * 1. 元素必须有 data-row-id 属性作为唯一标识
 * 2. 排序后的order数组包含teamId，按目标顺序排列
 * 3. 容器元素作为动画的父容器
 */
if(typeof CSGAnim == 'undefined') {

    class CSGAnim {
        constructor() {
            this.supportsWebAnimations = typeof Element.prototype.animate === 'function';
            // 动画状态管理
            this.activeAnimations = new WeakMap(); // element -> Animation对象
            this.animationQueues = new Map(); // container -> 队列
            this.isAnimating = new Map(); // container -> 是否正在动画
            this.risingElements = new WeakSet(); // 标记正在上升的元素
            // z-index 自增计数器（从100开始，表头使用100000）
            this.risingZIndexCounter = 100;
            
            // z-index 队列管理（避免累加超出表头的 500）
            this.risingZIndexQueue = []; // Array<{element, zIndex, teamId}>
            this.risingZIndexQueueMaxSize = 200; // 队列最大长度
            this.risingZIndexQueueKeepSize = 10; // 保留的最近队伍数
            this.risingZIndexQueueCleanSize = 190; // 清理的数量
            this.risingZIndexBase = 100; // z-index 基准值
            this.risingZIndexResetStart = 101; // 重置后的起始 z-index
        }
    
        /**
         * 基于速度计算动画时长
         */
        calculateDurationBySpeed(distance, speed = 300, minDuration = 200, maxDuration = 3000, speedMultiplier = 1.0) {
            const absDistance = Math.abs(distance);
            const baseDuration = (absDistance / speed) * 1000; // 转为毫秒
            const adjustedDuration = baseDuration / speedMultiplier;
            
            return Math.max(minDuration, Math.min(maxDuration, adjustedDuration));
        }

        /**
         * 管理上升队伍的 z-index 队列
         * 当队列达到最大长度时，清理旧的 z-index，保留最近的队伍
         * 使用 Set/Map 优化去重，避免 O(n) 暴力查找
         * @param {HTMLElement} element - 上升队伍的元素
         * @returns {number} - 分配的 z-index 值
         */
        manageRisingZIndex(element) {
            if (!element) {
                return this.risingZIndexCounter++;
            }
            
            // 获取 teamId
            const teamId = element.getAttribute('data-row-id');
            if (!teamId) {
                // 如果没有 teamId，使用默认自增方式
                return this.risingZIndexCounter++;
            }
            
            // 检查队列是否达到最大长度
            if (this.risingZIndexQueue.length >= this.risingZIndexQueueMaxSize) {
                // 使用 Set 存储最近保留的队伍 teamId（O(1) 查找）
                const recentTeamIds = new Set();
                const recentStartIndex = this.risingZIndexQueue.length - this.risingZIndexQueueKeepSize;
                
                // 构建最近保留队伍的 teamId Set（O(1) 查找）
                for (let i = recentStartIndex; i < this.risingZIndexQueue.length; i++) {
                    const item = this.risingZIndexQueue[i];
                    if (item && item.teamId) {
                        recentTeamIds.add(item.teamId);
                    }
                }
                
                // 清理前 N 个队伍的 z-index（排除最近保留的队伍）
                const cleanEndIndex = this.risingZIndexQueue.length - this.risingZIndexQueueKeepSize;
                for (let i = 0; i < cleanEndIndex; i++) {
                    const item = this.risingZIndexQueue[i];
                    if (item && item.element && item.teamId) {
                        // 使用 Set 的 has 方法，O(1) 时间复杂度
                        if (!recentTeamIds.has(item.teamId)) {
                            // 这个队伍不在最近保留的队伍中，清理它的 z-index
                            item.element.style.zIndex = '';
                        }
                        // 如果这个队伍在最近保留的队伍中，保留它的 z-index，后续会重置
                    }
                }
                
                // 将最近保留的队伍 z-index 重置为 101~110
                let resetZIndex = this.risingZIndexResetStart;
                for (let i = recentStartIndex; i < this.risingZIndexQueue.length; i++) {
                    const item = this.risingZIndexQueue[i];
                    if (item && item.element) {
                        // 更新 z-index（无论之前是否被清理，都重新设置）
                        item.element.style.zIndex = String(resetZIndex);
                        item.zIndex = resetZIndex;
                        resetZIndex++;
                    }
                }
                
                // 更新计数器，确保后续分配的 z-index 不会冲突
                this.risingZIndexCounter = resetZIndex;
                
                // 移除前 N 个元素（保留最近保留的队伍）
                this.risingZIndexQueue = this.risingZIndexQueue.slice(recentStartIndex);
            }
            
            // 分配新的 z-index
            const zIndex = this.risingZIndexCounter++;
            
            // 添加到队列
            this.risingZIndexQueue.push({
                element: element,
                zIndex: zIndex,
                teamId: teamId
            });
            
            return zIndex;
        }

        /**
         * 读取元素当前的transform状态（考虑正在进行的动画）
         */
        getCurrentTransform(element) {
            const computedStyle = window.getComputedStyle(element);
            const transform = computedStyle.transform;
            
            if (!transform || transform === 'none') {
                return { x: 0, y: 0 };
            }
            
            // 解析 matrix 或 matrix3d
            const matrix = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
            if (matrix) {
                const values = matrix[1].split(',').map(v => parseFloat(v.trim()));
                // matrix: m11, m12, m21, m22, tx, ty
                // matrix3d: 16个值，最后4个是 tx, ty, tz, w
                if (values.length === 6) {
                    return { x: values[4] || 0, y: values[5] || 0 };
                } else if (values.length === 16) {
                    return { x: values[12] || 0, y: values[13] || 0 };
                }
            }
            
            return { x: 0, y: 0 };
        }

        /**
         * 取消动画（视觉连续版）：对每个正在播放的动画都先 commit 当前 transform 再 cancel，
         * 让元素停在"真实视觉位置"。`risingTeamIds` 仅作 z-index 提示，不再用于"保护与否"。
         *
         * 主流程已不再调用本方法（flipSortAnimate 内部统一处理 commit）。
         * 这里保留以便外部/降级路径仍可安全调用，避免出现"清空 transform 瞬移到 DOM 槽位"。
         */
        cancelAnimations(container, risingTeamIds = []) {
            const elements = container.querySelectorAll('[data-row-id]');
            const hint = new Set(Array.isArray(risingTeamIds) ? risingTeamIds : []);
            elements.forEach(element => {
                const activeAnim = this.activeAnimations.get(element);
                if (activeAnim && activeAnim.playState !== 'finished') {
                    // commit 当前 transform，元素停在视觉位置
                    const t = this.getCurrentTransform(element);
                    element.style.transform = `translate3d(${t.x.toFixed(2)}px, ${t.y.toFixed(2)}px, 0)`;
                    try { activeAnim.cancel(); } catch (e) {}
                    this.activeAnimations.delete(element);
                }
                // 不主动清空 transform，让调用方/后续 FLIP 接管视觉位置。
                // 仅当元素既不在动画中也没有 inline transform 时，也无需做事。

                // hint 仅用于潜在的 z-index 标记，不强制
                const teamId = element.getAttribute('data-row-id');
                if (teamId && hint.has(teamId)) {
                    this.risingElements.add(element);
                }
            });
        }

        /**
         * 处理队列中的下一个动画
         */
        async processQueue(container) {
            const queue = this.animationQueues.get(container);
            if (!queue || queue.length === 0) {
                return;
            }

            const next = queue.shift();
            if (next) {
                try {
                    await this.sortAnimateInternal(next.container, next.order, next.options);
                    if (next.resolve) next.resolve();
                } catch (error) {
                    if (next.resolve) next.resolve();
                }
            }
        }

        /**
         * 智能排序动画 - 主要接口（带队列管理）
         *
         * 关键说明（FLIP 视觉连续性）：
         *   不在这里调用 cancelAnimations 主动清掉旧动画的 transform，
         *   而是把"接管旧动画当前视觉位置"全部交给 flipSortAnimate 内部完成
         *   （commit 当前 transform → cancel → 立刻读 oldRect）。
         *   这样多次 sort 叠加（A 上升中 → B 揭晓 → C 揭晓 ...）时，
         *   每个元素都从其真实视觉位置无缝接续到新位置，不会瞬移闪跳。
         */
        async sortAnimate(container, order, options = {}) {
            const {
                queue = true, // 是否使用队列
                cancelPrevious = true // 是否取消之前的动画并立即开始新动画
            } = options;

            if (queue && this.isAnimating.get(container)) {
                if (cancelPrevious) {
                    // 不再粗暴调用 cancelAnimations(container, risingTeamIds)。
                    // 由 flipSortAnimate 内部对每个元素 commit 当前视觉位置后再 cancel，
                    // 保证接续动画无视觉跳跃（"背景板"也不再瞬移到 DOM 槽位）。
                    this.animationQueues.set(container, []);
                    this.isAnimating.set(container, false);
                    return this.sortAnimateInternal(container, order, options);
                } else {
                    return new Promise((resolve) => {
                        const q = this.animationQueues.get(container) || [];
                        q.push({
                            container,
                            order,
                            options: { ...options, queue: false },
                            resolve
                        });
                        this.animationQueues.set(container, q);
                    });
                }
            }

            return this.sortAnimateInternal(container, order, options);
        }

        /**
         * 内部排序动画实现
         *
         * 与旧实现的关键区别：
         *   - 不再在此处调用 cancelAnimations 清旧 transform；
         *   - 不再按 mergeAnimations 二分"保护/不保护"；
         *   - 一律走 flipSortAnimate 的 "统一 commit 视觉位置 + 同帧 FLIP" 路径。
         */
        async sortAnimateInternal(container, order, options = {}) {
            const {
                duration = 600,
                speedMultiplier = 1.0,
                onComplete = null,
                useFlip = true,
                risingTeamIds = []
            } = options;

            this.isAnimating.set(container, true);

            try {
                const adjustedDuration = Math.max(100, Math.min(3000, duration / speedMultiplier));
                const currentElements = Array.from(container.querySelectorAll('[data-row-id]'));

                if (currentElements.length === 0) {
                    this.isAnimating.set(container, false);
                    this.processQueue(container);
                    if (onComplete) onComplete();
                    return Promise.resolve();
                }

                const sortedElements = this.reorderElements(currentElements, order);
                const needsAnimation = this.checkIfNeedsAnimation(currentElements, sortedElements);

                if (!needsAnimation) {
                    this.isAnimating.set(container, false);
                    this.processQueue(container);
                    if (onComplete) onComplete();
                    return Promise.resolve();
                }

                let animationPromise;
                if (useFlip) {
                    animationPromise = this.flipSortAnimate(sortedElements, {
                        ...options,
                        duration: adjustedDuration,
                        risingTeamIds: risingTeamIds
                    });
                } else {
                    animationPromise = this.simpleSortAnimate(currentElements, sortedElements, {
                        ...options,
                        duration: adjustedDuration
                    });
                }

                await animationPromise;

                this.isAnimating.set(container, false);
                this.processQueue(container);
            } catch (error) {
                this.isAnimating.set(container, false);
                this.processQueue(container);
                throw error;
            }
        }
    
        /**
         * FLIP 排序动画（视觉连续版）
         *
         * 设计目标：像 ICPC Resolver 那样，无论同时有多少队伍在移动、
         * 多次 sort 如何叠加，每个元素都从其"上一刻的真实视觉位置"
         * 无缝接续到新的目标位置——绝不出现"非上升队伍瞬移"。
         *
         * 流程（严格遵循 FLIP 视觉连续性）：
         *   First : 对每个元素，若有正在播放的动画 → 把当前 transform commit 到
         *           style.transform 上 → cancel() 旧动画 → 立刻读 oldRect。
         *           （不再两帧 rAF 等待，否则浏览器会渲染中间态导致瞬移。）
         *   Last  : DOM appendChild 到目标顺序。
         *   Invert: 暂时清空各元素 transform 读到"纯 DOM 槽位"newRect，
         *           计算 delta = oldRect - newRect，立刻把 transform 设为 delta
         *           （让元素视觉上仍停留在 oldRect）。
         *   Play  : 启动 WAAPI 动画 transform: delta → 0。
         *
         * 关键约束：Last/Invert/Play 必须在 **同一个 rAF** 内完成，
         * 否则浏览器会在 invert 之前渲染"清空 transform"的中间帧，造成闪烁。
         *
         * 上升/下降律：
         *   - 上升 (deltaY > 0)：duration = 距离 / speed，linear（线性最稳，叠加新动画不顿挫）
         *   - 下降 (deltaY < 0)：本批次下降统一节奏（按"批最大下降距离"算 duration），
         *     ease-in-out-cubic 带明显起步—加速—收尾的力度感；按距离从短到长 stagger
         *     0–staggerMaxMs 启动，形成"涟漪沉淀"。
         *   - 不变/水平移动：使用回退 duration
         */
        async flipSortAnimate(sortedElements, options = {}) {
            const {
                duration = 600,
                easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                onStart = null,
                onComplete = null,
                useSpeedBasedDuration = false,
                speed = 300,
                fallingSpeed = null, // 默认 = speed
                minDuration = 200,
                maxDuration = 3000,
                speedMultiplier = 1.0,
                risingTeamIds = [], // 仅用于 z-index 优先级辅助提示，可空
                risingEasing = 'linear', // 上升：线性最稳，避免减速时被新动画打断的"软停"感
                fallingDuration = 400,
                // 下降"力度感"参数（resolver 风格）
                fallingMinDuration = 500,    // 短距离也至少 500ms，避免"刷的一下"
                fallingMaxDuration = 1500,   // 长距离上限，避免拖沓
                fallingEasing = 'cubic-bezier(0.65, 0, 0.35, 1)', // ease-in-out-cubic：起步—加速—收尾
                fallingStaggerMaxMs = 60,    // 同批次内按距离从短到长 stagger，0~此值
                fallingUnifyDuration = true  // 同批次下降是否统一 duration（齐速沉淀感）
            } = options;

            if (sortedElements.length === 0) {
                return Promise.resolve();
            }

            if (!this.supportsWebAnimations) {
                console.warn('Web Animations API not supported, falling back to CSS animation');
                return this.flipSortAnimateCSS(sortedElements, options);
            }

            // 默认让下降与上升同速（resolver 风格"齐速沉淀"）。
            // 若调用方显式给了 fallingSpeed，听调用方的。
            const effectiveFallingSpeed = (typeof fallingSpeed === 'number' && fallingSpeed > 0)
                ? fallingSpeed
                : speed;

            // 用 risingTeamIds 构造 hint Set，作为 z-index 优先级提示。
            // 即便不传，flipSortAnimate 也会按 deltaY > 0 自动识别上升方向。
            const risingHintSet = new Set(Array.isArray(risingTeamIds) ? risingTeamIds : []);

            try {
                // ─────── First: 同步 commit 当前视觉位置 ───────
                // 对每个元素一视同仁：若动画正在播放就 commit 当前 transform 后 cancel。
                // 不要清空 transform，不要 await rAF——否则浏览器会先渲染"清空状态"。
                //
                // 同时用 WeakSet 标记"刚被 cancel 了进行中动画"的元素：
                // 这些元素在 Play 阶段需要 advance 一帧的 keyframes，
                // 抹平"旧动画在动 → 新动画第一帧静止"造成的速度断点。
                const wasAnimating = new WeakSet();
                sortedElements.forEach(element => {
                    const activeAnim = this.activeAnimations.get(element);
                    if (activeAnim && activeAnim.playState !== 'finished') {
                        // 读出动画当前的 transform（从 computed style）
                        const t = this.getCurrentTransform(element);
                        // 把它直接 commit 到 inline style，cancel 后即生效
                        element.style.transform = `translate3d(${t.x.toFixed(2)}px, ${t.y.toFixed(2)}px, 0)`;
                        try { activeAnim.cancel(); } catch (e) {}
                        this.activeAnimations.delete(element);
                        wasAnimating.add(element);
                    }
                    // 注意：保留已有 inline transform（可能是上一波 commit 留下的），
                    // 这样 oldRect 读到的就是"真实当前视觉位置"。
                });

                // 强制 layout 让 commit 生效
                sortedElements[0]?.offsetHeight;

                // 立刻读 oldRect（含已 commit 的 transform 影响 → 真实视觉位置）
                const oldRects = new Map();
                sortedElements.forEach((element, index) => {
                    oldRects.set(index, element.getBoundingClientRect());
                });

                // ─────── Last + Invert + Play 在同一同步段内完成 ───────
                // 关键：绝不 await rAF！rAF 会让浏览器有 ~16ms 的间隙——
                // 这段时间旧动画已 cancel、新动画未启动、元素被 inline transform 钉死，
                // 视觉上就是"卡一下再继续"。
                // 同步段内多次 offsetHeight 只触发 layout，不触发 paint，
                // 所以"清空 transform → 读 newRect → 设 invert"对用户不可见。

                // Last: DOM 重排到目标顺序
                this.updateDOMToFinalState(sortedElements);
                sortedElements[0]?.offsetHeight;

                // 暂时清空 transform，使 newRect 读到的是"纯 DOM 槽位"
                sortedElements.forEach(element => {
                    element.style.transform = '';
                });
                sortedElements[0]?.offsetHeight; // 仅强制 layout，不会触发 paint

                // ─────── 第一遍：收集每个元素的 delta / 方向 / 距离 ───────
                        const animationData = [];
                        sortedElements.forEach((element, index) => {
                            const oldRect = oldRects.get(index);
                            if (!oldRect) return;
                            const newRect = element.getBoundingClientRect();

                            // FLIP delta：让元素视觉上"仍停在 oldRect"
                            const deltaX = oldRect.left - newRect.left;
                            const deltaY = oldRect.top - newRect.top;

                            // 视觉位移过小：直接清理，不参与动画
                            if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
                                element.style.transform = '';
                                element.style.willChange = 'auto';
                                this.risingElements.delete(element);
                                return;
                            }

                            // 方向判定（FLIP 中 deltaY > 0 表示元素整体向上移动）
                            const isRising = deltaY > 0.5;
                            const isFalling = deltaY < -0.5;
                            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                            animationData.push({
                                element,
                                deltaX,
                                deltaY,
                                distance,
                                isRising,
                                isFalling
                                // duration / easing / delay 在第二遍统一计算
                            });
                        });

                        // ─────── 第二遍：本批次"统一节奏"分配 duration / easing / delay ───────
                        // resolver 风格的关键：本帧所有下降队伍共享同一 duration（按本批最大下降距离算），
                        // 然后按距离从短到长 stagger 启动 → 短距先到位、长距紧随其后，
                        // 形成"涟漪沉淀"，而不是"刷的一下齐到"。
                        let unifiedFallingDuration = null;
                        if (useSpeedBasedDuration && fallingUnifyDuration) {
                            const fallingDistances = animationData
                                .filter(d => d.isFalling)
                                .map(d => d.distance);
                            if (fallingDistances.length > 0) {
                                const maxFallingDist = Math.max(...fallingDistances);
                                unifiedFallingDuration = this.calculateDurationBySpeed(
                                    maxFallingDist, effectiveFallingSpeed,
                                    fallingMinDuration, fallingMaxDuration, 1.0
                                );
                            }
                        }
                        // 下降 stagger：按距离升序（最近的最先到位）
                        const fallingSortedByDist = animationData
                            .filter(d => d.isFalling)
                            .slice()
                            .sort((a, b) => a.distance - b.distance);
                        // 队伍数多时步进缩小，避免最后一队等太久
                        const fallingStaggerStep = fallingSortedByDist.length > 1
                            ? Math.min(fallingStaggerMaxMs, fallingStaggerMaxMs * 8 / fallingSortedByDist.length)
                            : 0;
                        const fallingDelayMap = new Map();
                        fallingSortedByDist.forEach((d, i) => {
                            fallingDelayMap.set(d.element, Math.round(i * fallingStaggerStep));
                        });

                        animationData.forEach(data => {
                            let elementDuration;
                            let elementEasing;
                            let elementDelay = 0;

                            if (useSpeedBasedDuration) {
                                if (data.isRising) {
                                    elementDuration = this.calculateDurationBySpeed(
                                        data.distance, speed, minDuration, maxDuration, 1.0
                                    );
                                    elementEasing = risingEasing;
                                } else if (data.isFalling) {
                                    elementDuration = unifiedFallingDuration != null
                                        ? unifiedFallingDuration
                                        : this.calculateDurationBySpeed(
                                            data.distance, effectiveFallingSpeed,
                                            fallingMinDuration, fallingMaxDuration, 1.0
                                        );
                                    elementEasing = fallingEasing;
                                    elementDelay = fallingDelayMap.get(data.element) || 0;
                                } else {
                                    // 仅水平/极小位移
                                    elementDuration = Math.max(fallingMinDuration, minDuration);
                                    elementEasing = fallingEasing;
                                }
                            } else {
                                if (data.isRising) {
                                    elementDuration = duration / speedMultiplier;
                                    elementEasing = easing;
                                } else if (data.isFalling) {
                                    elementDuration = fallingDuration / speedMultiplier;
                                    elementEasing = fallingEasing;
                                } else {
                                    elementDuration = duration / speedMultiplier;
                                    elementEasing = easing;
                                }
                            }

                            data.duration = elementDuration;
                            data.easing = elementEasing;
                            data.delay = elementDelay;
                        });

                        // Invert：把 transform 设为 delta，元素视觉上仍在 oldRect
                        animationData.forEach(data => {
                            data.element.style.transform =
                                `translate3d(${data.deltaX.toFixed(2)}px, ${data.deltaY.toFixed(2)}px, 0)`;
                            data.element.style.willChange = 'transform';

                            if (data.isRising) {
                                // z-index 队列管理：上升队伍叠在下降队伍之上
                                const zIndex = this.manageRisingZIndex(data.element);
                                data.element.style.zIndex = String(zIndex);
                                this.risingElements.add(data.element);
                            } else {
                                // 下降队伍：从 rising 标记中移除（避免长期占据高 z-index）
                                this.risingElements.delete(data.element);
                            }

                            // 来自外部 risingTeamIds 的 hint：保证显式标记的 rising 也有 z-index
                            const teamId = data.element.getAttribute('data-row-id');
                            if (teamId && risingHintSet.has(teamId) && !data.isRising) {
                                if (!data.element.style.zIndex) {
                                    const zIndex = this.manageRisingZIndex(data.element);
                                    data.element.style.zIndex = String(zIndex);
                                }
                            }
                        });

                        // 强制 layout 让 invert 生效
                        sortedElements[0]?.offsetHeight;

                        // Play: 启动 WAAPI 动画 delta → 0（带 delay 形成 stagger）
                        // 关键"零卡顿"补丁：对刚被 cancel 了进行中动画的元素，
                        // keyframes[0] 不再用 delta（= oldRect 视觉位置），而是 delta 向 0
                        // 提前 1 帧的位置，duration 也对应缩短 1 帧。这样浏览器渲染下一帧时，
                        // 元素已经"走过一帧的位移"——每相邻两帧之间位移连续，速度不断点。
                        const FRAME_MS = 16; // 一帧的近似时长
                        const animations = [];
                        animationData.forEach(data => {
                            // 短距离按比例缩短 duration，避免 1px 的位移也跑很长
                            let dur = data.duration;
                            if (data.distance < 3 && dur > 100) {
                                dur = Math.max(50, dur * (data.distance / 3));
                            }
                            const delay = data.delay || 0;

                            // advance 一帧：仅对(1) 被 cancel 了进行中动画的元素 (2) 没有 stagger delay 的元素
                            const shouldAdvance = wasAnimating.has(data.element) && delay === 0;
                            let kf0X = data.deltaX;
                            let kf0Y = data.deltaY;
                            let effectiveDur = dur;
                            if (shouldAdvance && dur > FRAME_MS * 2) {
                                const ratio = FRAME_MS / dur;
                                kf0X = data.deltaX * (1 - ratio);
                                kf0Y = data.deltaY * (1 - ratio);
                                effectiveDur = dur - FRAME_MS;
                            }

                            try {
                                // delay 期间 element.style.transform 已是 invert delta，元素停在 oldRect
                                const anim = data.element.animate([
                                    { transform: `translate3d(${kf0X.toFixed(2)}px, ${kf0Y.toFixed(2)}px, 0)` },
                                    { transform: 'translate3d(0, 0, 0)' }
                                ], {
                                    duration: effectiveDur,
                                    delay: delay,
                                    easing: data.easing,
                                    fill: 'both' // 关键：delay 期间也保持起点 delta，避免回弹到 (0,0)
                                });
                        anim.play();
                        this.activeAnimations.set(data.element, anim);
                        anim._csgElement = data.element;
                        animations.push(anim);
                    } catch (e) {
                        data.element.style.transform = '';
                        data.element.style.willChange = 'auto';
                    }
                });

                if (onStart) onStart();

                await Promise.allSettled(animations.map(anim => anim.finished));

                // 清理：动画结束后把 transform 置空，避免持续占用合成层。
                // 但只清"当前 activeAnimations 仍然指向自己"的，避免误清下一波接续动画。
                animations.forEach(anim => {
                    const element = anim._csgElement || (anim.effect && anim.effect.target);
                    if (!element) return;
                    if (this.activeAnimations.get(element) === anim) {
                        try { anim.cancel(); } catch (e) {}
                        element.style.transform = '';
                        element.style.willChange = 'auto';
                        this.activeAnimations.delete(element);
                        this.risingElements.delete(element);
                    }
                    delete anim._csgElement;
                });

                if (onComplete) onComplete();

            } catch (error) {
                sortedElements.forEach(element => {
                    element.style.transform = '';
                    element.style.willChange = 'auto';
                    this.activeAnimations.delete(element);
                    this.risingElements.delete(element);
                });
                console.warn('Web Animations API failed, falling back to CSS animation:', error);
                return this.flipSortAnimateCSS(sortedElements, options);
            }
        }
    
        /**
         * 简单排序动画（非FLIP）
         * @param {Array} currentElements - 当前元素数组
         * @param {Array} sortedElements - 排序后元素数组
         * @param {Object} options - 动画选项
         * @returns {Promise} 动画完成的Promise
         */
        async simpleSortAnimate(currentElements, sortedElements, options = {}) {
            const {
                duration = 600,
                easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                onStart = null,
                onComplete = null
            } = options;
    
            // 计算需要移动的元素
            const animationData = this.calculateMovements(currentElements, sortedElements);
            
            if (animationData.length === 0) {
                return Promise.resolve();
            }
    
            // 检查Web Animations API支持
            if (!this.supportsWebAnimations) {
                return this.simpleSortAnimateCSS(animationData, options);
            }
    
            try {
                // 回调：动画开始
                if (onStart) onStart();
    
                // 创建所有动画
                const animations = animationData.map(data => {
                    return data.element.animate([
                        { transform: 'translate3d(0, 0, 0)' },
                        { transform: `translate3d(0, ${data.deltaY}px, 0)` }
                    ], {
                        duration: duration,
                        easing: easing,
                        fill: 'forwards'
                    });
                });
    
                // 一次性启动所有动画
                animations.forEach(anim => anim.play());
    
                // 等待所有动画完成（使用Promise.allSettled避免一个失败全部失败）
                await Promise.allSettled(animations.map(anim => anim.finished));
    
                // 更新DOM到最终状态
                this.updateDOMToFinalState(sortedElements);
    
                // 清理动画和transform
                animations.forEach(anim => {
                    try {
                        anim.cancel();
                    } catch (e) {
                        // 忽略错误
                    }
                    const element = anim.effect && anim.effect.target;
                    if (element) {
                        element.style.transform = '';
                        element.style.willChange = 'auto';
                    }
                });
    
                // 回调：动画完成
                if (onComplete) onComplete();
    
            } catch (error) {
                // 发生错误时也要清理transform
                animationData.forEach(data => {
                    data.element.style.transform = '';
                    data.element.style.willChange = 'auto';
                });
                console.warn('Web Animations API failed, falling back to CSS animation:', error);
                return this.simpleSortAnimateCSS(animationData, options);
            }
        }
    
        /**
         * 重新排序元素
         * @param {Array} currentElements - 当前元素数组
         * @param {Array} order - 目标顺序的itemKey数组
         * @returns {Array} 按目标顺序排列的元素数组
         */
        reorderElements(currentElements, order) {
            const elementMap = new Map();
            currentElements.forEach(element => {
                const itemKey = element.getAttribute('data-row-id');
                if (itemKey) {
                    elementMap.set(itemKey, element);
                }
            });
    
            return order.map(itemKey => elementMap.get(itemKey)).filter(Boolean);
        }
    
        /**
         * 检查是否需要动画
         * @param {Array} currentElements - 当前元素数组
         * @param {Array} sortedElements - 排序后元素数组
         * @returns {boolean} 是否需要动画
         */
        checkIfNeedsAnimation(currentElements, sortedElements) {
            
            // 过滤掉undefined值
            const validSortedElements = sortedElements.filter(Boolean);
            
            
            if (currentElements.length !== validSortedElements.length) {
                
                return true;
            }
    
            // 比较每个位置的元素是否相同
            for (let i = 0; i < currentElements.length; i++) {
                if (currentElements[i] !== validSortedElements[i]) {
                    
                    
                    
                    
                    
                    return true;
                }
            }
            
            // 如果所有元素都相同，显示前几个元素的ID用于验证
            
            
            
            // 检查是否有任何元素位置发生变化
            let hasChanges = false;
            for (let i = 0; i < currentElements.length; i++) {
                const currentId = currentElements[i]?.getAttribute('data-row-id');
                const sortedId = validSortedElements[i]?.getAttribute('data-row-id');
                if (currentId !== sortedId) {
                    
                    hasChanges = true;
                }
            }
            
            if (!hasChanges) {
                
                return false;
            } else {
                
                return true;
            }
        }
    
        /**
         * 计算移动数据
         * @param {Array} currentElements - 当前元素数组
         * @param {Array} sortedElements - 排序后元素数组
         * @returns {Array} 动画数据数组
         */
        calculateMovements(currentElements, sortedElements) {
            const movements = [];
            const currentPositions = new Map();
            const sortedPositions = new Map();
    
            // 记录当前位置
            currentElements.forEach((element, index) => {
                const itemKey = element.getAttribute('data-row-id');
                if (itemKey) {
                    currentPositions.set(itemKey, { element, index });
                }
            });
    
            // 记录目标位置
            sortedElements.forEach((element, index) => {
                const itemKey = element.getAttribute('data-row-id');
                if (itemKey) {
                    sortedPositions.set(itemKey, { element, index });
                }
            });
    
            // 计算需要移动的元素
            for (const [itemKey, current] of currentPositions) {
                const sorted = sortedPositions.get(itemKey);
                if (sorted && current.index !== sorted.index) {
                    const currentRect = current.element.getBoundingClientRect();
                    const targetTop = sorted.index * currentRect.height;
                    const deltaY = targetTop - currentRect.top;
    
                    movements.push({
                        element: current.element,
                        deltaY: deltaY,
                        isUp: deltaY < 0,
                        itemKey: itemKey
                    });
                }
            }
    
            return movements;
        }
    
        /**
         * FLIP技术CSS降级方案
         * @param {Array} sortedElements - 排序后元素数组
         * @param {Object} options - 动画选项
         * @returns {Promise} 动画完成的Promise
         */
        async flipSortAnimateCSS(sortedElements, options = {}) {
            const {
                duration = 600,
                easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                onStart = null,
                onComplete = null,
                risingTeamIds = []
            } = options;
    
            return new Promise(async resolve => {
                // 强制清除所有正在进行的动画和transform，确保DOM稳定
                sortedElements.forEach(element => {
                    element.style.transform = '';
                    element.style.transition = '';
                    element.style.willChange = 'auto';
                });
                
                // 强制同步布局，确保所有样式计算完成
                sortedElements[0]?.offsetHeight;
                // 使用 requestAnimationFrame 确保浏览器完成渲染
                await new Promise(r => requestAnimationFrame(() => {
                    requestAnimationFrame(r);
                }));
                
                // 记录初始位置
                const initialPositions = sortedElements.map(element => {
                    const rect = element.getBoundingClientRect();
                    return {
                        top: rect.top,
                        left: rect.left,
                        element: element
                    };
                });
    
                // FLIP技术：Last + Invert - 在同一帧内完成DOM更新和反向transform应用
                await new Promise(r => {
                    requestAnimationFrame(() => {
                        // 在同一帧内：更新DOM + 立即应用反向transform
                        // 这样浏览器不会渲染中间状态
                        
                        // 更新DOM到最终状态
                        this.updateDOMToFinalState(sortedElements);
                        
                        // 强制同步布局，确保DOM更新完成
                        sortedElements[0]?.offsetHeight;
                        
                        // 立即计算并应用反向transform（同步执行）
                        sortedElements.forEach((element, index) => {
                            const rect = element.getBoundingClientRect();
                            const initial = initialPositions[index];
                            const deltaX = initial.left - rect.left;
                            const deltaY = initial.top - rect.top;
                            
                            // 检查是否是上升队伍
                            const teamId = element.getAttribute('data-row-id');
                            const isRising = risingTeamIds.includes(teamId);
    
                            // 立即应用反向transform和transition，避免用户看到最终位置
                            element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
                            element.style.transition = `transform ${duration}ms ${easing}`;
                            // 上升队伍设置 z-index，使用队列管理避免累加超出表头
                            if (isRising) {
                                const zIndex = this.manageRisingZIndex(element);
                                element.style.zIndex = String(zIndex);
                            }
                        });
                        
                        // 强制重排确保transform生效
                        sortedElements[0]?.offsetHeight;
                        
                        r();
                    });
                });
    
                // 回调：动画开始
                if (onStart) onStart();
    
                // 动画到最终位置
                sortedElements.forEach(element => {
                    element.style.transform = 'translate3d(0, 0, 0)';
                });
    
                // 等待动画完成
                setTimeout(() => {
                    sortedElements.forEach(element => {
                        element.style.transform = '';
                        element.style.transition = '';
                        element.style.willChange = 'auto';
                        // 不移除z-index，让上升队伍的z-index自然保留
                    });
                    if (onComplete) onComplete();
                    resolve();
                }, duration + 50);
            });
        }
    
        /**
         * 简单排序动画CSS降级方案
         * @param {Array} animationData - 动画数据数组
         * @param {Object} options - 动画选项
         * @returns {Promise} 动画完成的Promise
         */
        async simpleSortAnimateCSS(animationData, options = {}) {
            const {
                duration = 600,
                easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                onStart = null,
                onComplete = null
            } = options;
    
            return new Promise(resolve => {
                // 回调：动画开始
                if (onStart) onStart();
    
                // 设置初始状态
                animationData.forEach(data => {
                    data.element.style.transform = 'translate3d(0, 0, 0)';
                    data.element.style.transition = `transform ${duration}ms ${easing}`;
                });
    
                // 强制重排
                animationData[0]?.element.offsetHeight;
    
                // 动画到目标位置
                animationData.forEach(data => {
                    data.element.style.transform = `translate3d(0, ${data.deltaY}px, 0)`;
                });
    
                // 等待动画完成
                setTimeout(() => {
                    animationData.forEach(data => {
                        data.element.style.transform = '';
                        data.element.style.transition = '';
                    });
                    if (onComplete) onComplete();
                    resolve();
                }, duration + 50);
            });
        }
    
        /**
         * 更新DOM到最终状态
         * @param {Array} elements - 按最终顺序排列的元素数组
         */
        updateDOMToFinalState(elements) {
            // 找到第一个元素的父容器
            const parent = elements[0]?.parentNode;
            if (!parent) return;
    
            // 使用DocumentFragment批量操作
            const fragment = document.createDocumentFragment();
            elements.forEach(element => {
                if (element && element.parentNode) {
                    fragment.appendChild(element);
                }
            });
            parent.appendChild(fragment);
    
            // 强制重排，确保DOM更新完成
            parent.offsetHeight;
        }
    
        /**
         * 简单的批量动画（非FLIP）
         * @param {Array} animationData - 动画数据数组
         * @param {Object} options - 动画选项
         * @returns {Promise} 动画完成的Promise
         */
        async batchAnimate(animationData, options = {}) {
            const {
                duration = 600,
                easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                onStart = null,
                onComplete = null
            } = options;
    
            if (animationData.length === 0) {
                return Promise.resolve();
            }
    
            // 检查Web Animations API支持
            if (!this.supportsWebAnimations) {
                return this.batchAnimateCSS(animationData, options);
            }
    
            try {
                // 回调：动画开始
                if (onStart) onStart();
    
                // 创建所有动画
                const animations = animationData.map(data => {
                    return data.element.animate([
                        { transform: 'translate3d(0, 0, 0)' },
                        { transform: `translate3d(0, ${data.deltaY}px, 0)` }
                    ], {
                        duration: duration,
                        easing: easing,
                        fill: 'forwards'
                    });
                });
    
                // 一次性启动所有动画
                animations.forEach(anim => anim.play());
    
                // 等待所有动画完成
                await Promise.all(animations.map(anim => anim.finished));
    
                // 清理动画
                animations.forEach(anim => anim.cancel());
    
                // 回调：动画完成
                if (onComplete) onComplete();
    
            } catch (error) {
                console.warn('Web Animations API failed, falling back to CSS animation:', error);
                return this.batchAnimateCSS(animationData, options);
            }
        }
    
        /**
         * CSS降级方案（简单批量动画）
         * @param {Array} animationData - 动画数据数组
         * @param {Object} options - 动画选项
         * @returns {Promise} 动画完成的Promise
         */
        async batchAnimateCSS(animationData, options = {}) {
            const {
                duration = 600,
                easing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                onStart = null,
                onComplete = null
            } = options;
    
            return new Promise(resolve => {
                // 回调：动画开始
                if (onStart) onStart();
    
                // 设置初始状态
                animationData.forEach(data => {
                    data.element.style.transform = 'translate3d(0, 0, 0)';
                    data.element.style.transition = `transform ${duration}ms ${easing}`;
                });
    
                // 强制重排
                animationData[0]?.element.offsetHeight;
    
                // 动画到目标位置
                animationData.forEach(data => {
                    data.element.style.transform = `translate3d(0, ${data.deltaY}px, 0)`;
                });
    
                // 等待动画完成
                setTimeout(() => {
                    animationData.forEach(data => {
                        data.element.style.transform = '';
                        data.element.style.transition = '';
                    });
                    if (onComplete) onComplete();
                    resolve();
                }, duration + 50);
            });
        }
    
        /**
         * 检查Web Animations API支持
         * @returns {boolean} 是否支持Web Animations API
         */
        isWebAnimationsSupported() {
            return this.supportsWebAnimations;
        }
    
        /**
         * 获取推荐的缓动函数
         * @param {string} type - 缓动类型
         * @returns {string} 缓动函数字符串
         */
        getEasing(type = 'smooth') {
            const easings = {
                smooth: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                elastic: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
                easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
                easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
                easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
            };
            return easings[type] || easings.smooth;
        }
    
        /**
         * 获取推荐的动画时长
         * @param {number} elementCount - 元素数量
         * @returns {number} 推荐的动画时长（毫秒）
         */
        getRecommendedDuration(elementCount) {
            if (elementCount <= 5) return 300;
            if (elementCount <= 20) return 500;
            if (elementCount <= 50) return 700;
            return 1000;
        }
        
        /**
         * 优雅的队伍落下动画（增强版：先上升再落下）
         * 用于f键跳过非奖区场景：所有队伍先升到窗口外，再从顶部缓缓落下，视口同时上升
         * @param {HTMLElement[]|string[]} allElementsOrIds - 所有队伍元素或ID数组
         * @param {HTMLElement[]|string[]} elementsOrIdsToFall - 要落下的元素数组或元素ID数组
         * @param {Object} options - 动画选项
         * @param {number} options.duration - 落下动画持续时间（ms），如果不提供则使用speed计算
         * @param {number} options.speed - 落下移动速度（像素/秒），默认200（优雅缓慢），用于计算duration
         * @param {number} options.riseDuration - 上升动画持续时间（ms），默认800
         * @param {boolean} options.shouldScrollFollow - 是否让窗口跟随上升，默认false
         * @param {HTMLElement|string|null} options.targetElement - 滚动目标元素或ID（用于窗口跟随）
         * @param {Function} options.onScrollTo - 滚动回调函数，接收目标元素作为参数
         * @param {number} options.fallDistance - 落下距离（像素），默认视口高度的1.5倍
         * @param {string} options.easing - 缓动函数，默认 'cubic-bezier(0.4, 0, 0.2, 1)'
         * @param {number} options.staggerDelay - 每个元素之间的延迟（ms），如果为null则基于速度计算
         * @param {string} options.fallingClass - 添加的CSS类名，默认 'rank-falling-down'
         * @param {number} options.splitIndex - 分界点索引，此索引之后的队伍可以快一点到位，默认null
         * @param {number} options.fastSpeed - 快速动画移动速度（像素/秒），默认400，用于计算fastDuration
         * @param {number} options.minDuration - 最小动画时长（ms），默认800
         * @param {number} options.maxDuration - 最大动画时长（ms），默认8000
         * @returns {Promise<void>}
         */
        async animateTeamsRiseAndFall(allElementsOrIds, elementsOrIdsToFall, options = {}) {
            const {
                duration = null, // 如果为null，则基于speed计算
                speed = 200, // 优雅缓慢的移动速度（像素/秒）
                riseDuration = null, // 如果为null，则基于riseSpeed计算
                riseSpeed = 150, // 上升移动速度（像素/秒），默认150，优雅缓慢
                shouldScrollFollow = false,
                targetElement = null,
                onScrollTo = null,
                fallDistance = null,
                easing = 'cubic-bezier(0.4, 0, 0.2, 1)',
                staggerDelay = null,
                fallingClass = 'rank-falling-down',
                splitIndex = null,
                fastSpeed = 100, // 快速动画移动速度（像素/秒）
                minDuration = 800,
                maxDuration = 80000,
                scrollSpeed = 50 // 视口滚动速度（像素/秒），与下落速度匹配
            } = options;
            
            // 解析所有元素
            const allElements = [];
            allElementsOrIds.forEach(item => {
                let element;
                if (typeof item === 'string') {
                    element = document.getElementById(item);
                } else if (item && item.nodeType === 1) {
                    element = item;
                }
                if (element) {
                    allElements.push(element);
                }
            });
            
            // 解析要落下的元素
            const elementsToFall = [];
            elementsOrIdsToFall.forEach(item => {
                let element;
                if (typeof item === 'string') {
                    element = document.getElementById(item);
                } else if (item && item.nodeType === 1) {
                    element = item;
                }
                if (element) {
                    elementsToFall.push(element);
                }
            });
            
            if (allElements.length === 0) {
                return;
            }
            
            // 计算视口高度和上升/落下距离
            const viewportHeight = window.innerHeight;
            const riseDistance = viewportHeight * 1.2; // 上升距离：视口高度的1.2倍
            const finalFallDistance = fallDistance || (viewportHeight * 1.5); // 落下距离
            
            // 计算上升动画时长（基于速度）
            const calculatedRiseDuration = riseDuration !== null
                ? riseDuration
                : this.calculateDurationBySpeed(riseDistance, riseSpeed, 600, 2000, 1.0);
            
            // 计算duration（基于速度）
            const calculatedDuration = duration !== null 
                ? duration 
                : this.calculateDurationBySpeed(finalFallDistance, speed, minDuration, maxDuration, 1.0);
            
            // 计算快速动画的duration（基于快速速度）
            // 注意：快速动画的min/max应该与主动画的min/max一致，但可以稍微快一点
            const fastMinDuration = minDuration * 0.6; // 快速动画最小时长为主动画的60%
            const fastMaxDuration = maxDuration * 0.8; // 快速动画最大时长为主动画的80%
            const calculatedFastDuration = this.calculateDurationBySpeed(finalFallDistance, fastSpeed, fastMinDuration, fastMaxDuration, 1.0);
            
            // 计算每个元素的延迟时间（基于计算出的duration）
            const finalStaggerDelay = staggerDelay !== null 
                ? staggerDelay 
                : (calculatedDuration / elementsToFall.length * 0.1);
            
            // 解析目标元素
            let targetEl = null;
            if (targetElement) {
                if (typeof targetElement === 'string') {
                    targetEl = document.getElementById(targetElement);
                } else if (targetElement && targetElement.nodeType === 1) {
                    targetEl = targetElement;
                }
            }
            
            // 第一步：所有队伍升到窗口外
            // 注意：元素可能在调用前已经被移出视口（例如在rank_roll.js中），所以需要检查当前状态
            // 如果元素已经在窗口外，可以跳过或缩短上升动画
            const risePromises = allElements.map((element, index) => {
                return new Promise(resolve => {
                    requestAnimationFrame(() => {
                        // 检查元素当前位置（通过getBoundingClientRect）
                        const rect = element.getBoundingClientRect();
                        const currentTransform = window.getComputedStyle(element).transform;
                        const isAlreadyOutside = rect.top < -window.innerHeight || 
                                                 (currentTransform !== 'none' && currentTransform.includes('translateY'));
                        
                        if (isAlreadyOutside) {
                            // 元素已经在窗口外，确保位置正确，但可以使用较短的过渡
                            element.style.transition = `transform ${Math.min(calculatedRiseDuration, 300)}ms ${easing}`;
                            element.style.transform = `translateY(-${riseDistance}px)`;
                            element.style.willChange = 'transform';
                            
                            setTimeout(() => {
                                element.style.transition = '';
                                resolve();
                            }, Math.min(calculatedRiseDuration, 300));
                        } else {
                            // 元素在视口中，执行正常上升动画（使用计算出的优雅缓慢速度）
                            element.style.transition = `transform ${calculatedRiseDuration}ms ${easing}`;
                            element.style.transform = `translateY(-${riseDistance}px)`;
                            element.style.willChange = 'transform';
                            
                            setTimeout(() => {
                                element.style.transition = '';
                                resolve();
                            }, calculatedRiseDuration);
                        }
                    });
                });
            });
            
            await Promise.all(risePromises);
            
            // 等待上升动画完成（缩短等待时间，只需要一帧即可）
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            // 第二步：重新定位视口到目标位置（奖区最后一个队）
            // 注意：视口可能在第一步上升动画时被改变，需要重新定位到目标位置
            // 但此时元素已经通过 transform 移出视口，需要使用 offsetTop 计算位置
            if (shouldScrollFollow && targetEl) {
                // 使用 offsetTop 计算位置（不受 transform 影响，确保准确性）
                const viewportHeight = window.innerHeight;
                
                // 获取元素的绝对位置（相对于文档顶部）
                let elementOffsetTop = targetEl.offsetTop;
                let offsetParent = targetEl.offsetParent;
                
                // 遍历所有 offsetParent，累加它们的 offsetTop
                while (offsetParent && offsetParent !== document.body && offsetParent !== document.documentElement) {
                    elementOffsetTop += offsetParent.offsetTop;
                    offsetParent = offsetParent.offsetParent;
                }
                
                // 目标：元素顶部距离视口顶部 = 视口高度的 1/3
                const targetScrollY = elementOffsetTop - (viewportHeight / 3);
                
                // 立即定位到目标位置（不使用动画，直接定位）
                window.scrollTo({
                    top: Math.max(0, targetScrollY),
                    behavior: 'auto'
                });
                
                // 等待滚动完成并确保布局稳定
                await new Promise(resolve => requestAnimationFrame(() => {
                    requestAnimationFrame(resolve);
                }));
            }
            
            // 第三步：处理不需要落下的队伍
            // 视口已经定位到底部，不需要落下的队伍保持在窗口外（等待视口上升时自然出现）
            const elementsToFallSet = new Set(elementsToFall);
            allElements.forEach(element => {
                if (!elementsToFallSet.has(element)) {
                    // 不需要落下的队伍：保持在上升后的位置（窗口外）
                    // 它们会在视口上升时自然出现在正确位置
                    element.style.transform = `translateY(-${riseDistance}px)`;
                    element.style.opacity = '1';
                }
            });
            
            // 等待一帧，确保样式已应用
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            // 第四步：不再需要提前定位视口，因为视口已经定位到底部
            // 后续会在第一个队伍落到位时启动视口上升
            
            // 第五步：开始落下动画（视口已定位到底部，第一个队伍落到位时启动视口上升）
            // 关键：使用FLIP技术确保动画结束后所有元素都在正确位置
            
            // FLIP第一步：记录最终位置（First）
            // 此时所有元素都应该在正确的DOM位置，但被移到了窗口外
            // 我们需要记录它们在正常状态下的位置
            const finalPositions = new Map();
            allElements.forEach(element => {
                // 临时移除transform，记录最终位置
                const savedTransform = element.style.transform;
                element.style.transform = '';
                const savedTransition = element.style.transition;
                element.style.transition = 'none';
                
                // 强制重排，获取元素在正常位置时的位置
                element.offsetHeight;
                const rect = element.getBoundingClientRect();
                finalPositions.set(element, {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height
                });
                
                // 恢复transform
                element.style.transform = savedTransform;
                element.style.transition = savedTransition;
            });
            
            // 等待一帧，确保位置记录完成
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            // 4.1 队伍落下动画（从下到上：最后一个先落，然后是倒数第二个...）
            // 注意：elementsToFall 的顺序是从上到下，我们需要反转为从下到上
            const elementsToFallReversedForAnimation = [...elementsToFall].reverse();
            const animationPromises = [];
            
            elementsToFallReversedForAnimation.forEach((element, reversedIndex) => {
                // 计算原始索引（用于判断是否快速动画）
                const originalIndex = elementsToFall.length - 1 - reversedIndex;
                const isFast = splitIndex !== null && originalIndex >= splitIndex;
                const elementDuration = isFast ? calculatedFastDuration : calculatedDuration;
                const elementEasing = isFast ? 'cubic-bezier(0.4, 0, 1, 1)' : easing; // 快速使用ease-in
                
                                // 初始位置在窗口上方
                                element.style.transform = `translateY(-${finalFallDistance}px)`;
                                element.style.opacity = '0';
                                element.style.transition = ''; // 先清除transition，避免冲突
                                element.style.willChange = 'transform, opacity';
                                element.style.zIndex = '50';
                                element.classList.add(fallingClass);
                                
                                // 强制重排，确保初始状态已应用
                                element.offsetHeight;
                                
                                // 延迟开始：从最后一个开始，所以第一个（reversedIndex=0）立即开始
                                // 后续每个队伍延迟一点，形成从下到上的流水效果
                                const delay = reversedIndex * finalStaggerDelay;
                                
                                animationPromises.push(
                                    new Promise(resolve => {
                                        setTimeout(() => {
                                            requestAnimationFrame(() => {
                                                // 开始落下动画（使用will-change优化，避免抖动）
                                                element.style.willChange = 'transform, opacity';
                                                element.style.transition = `transform ${elementDuration}ms ${elementEasing}, opacity ${elementDuration}ms ease-out`;
                                                element.style.transform = 'translateY(0)';
                                                element.style.opacity = '1';
                                                
                                                // 关键：当第一个队伍（reversedIndex=0）落到位时，启动视口上升
                                                // 在动画进行到一定进度时（例如80%）触发视口滚动
                                                if (shouldScrollFollow && targetEl && onScrollTo && reversedIndex === 0) {
                                                    // 第一个队伍落到位时（在80%进度时），启动视口滚动到目标位置
                                                    const scrollTriggerTime = elementDuration * 0.8;
                                                    setTimeout(() => {
                                                        // 调用 onScrollTo 回调，启动视口滚动到目标元素
                                                        if (onScrollTo && targetEl) {
                                                            onScrollTo(targetEl, scrollSpeed);
                                                        }
                                                    }, scrollTriggerTime);
                                                }
                                
                                // 动画完成后清理（使用FLIP技术确保最终位置正确）
                                setTimeout(() => {
                                    // FLIP最后一步：确保元素回到正确的最终位置
                                    // 先清除transition，避免清理时触发动画
                                    element.style.transition = '';
                                    
                                    // 获取记录的最终位置
                                    const finalPos = finalPositions.get(element);
                                    if (finalPos) {
                                        // 获取元素当前实际位置（考虑transform）
                                        const currentRect = element.getBoundingClientRect();
                                        const deltaY = finalPos.top - currentRect.top;
                                        const deltaX = finalPos.left - currentRect.left;
                                        
                                        // 如果有位置差异，应用反向transform然后动画到最终位置
                                        if (Math.abs(deltaY) > 0.5 || Math.abs(deltaX) > 0.5) {
                                            // 立即应用反向transform，使元素看起来还在当前位置
                                            element.style.transition = `transform 200ms ease-out`;
                                            element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
                                            
                                            // 强制重排
                                            element.offsetHeight;
                                            
                                            // 动画到最终位置（translate3d(0, 0, 0)）
                                            requestAnimationFrame(() => {
                                                element.style.transform = 'translate3d(0, 0, 0)';
                                                
                                                // 等待动画完成后清理
                                                setTimeout(() => {
                                                    element.style.transform = '';
                                                    element.style.transition = '';
                                                    element.style.opacity = '';
                                                    element.style.willChange = '';
                                                    element.style.zIndex = '';
                                                    element.classList.remove(fallingClass);
                                                    resolve();
                                                }, 200);
                                            });
                                        } else {
                                            // 位置已经正确，直接清理
                                            element.style.transform = '';
                                            element.style.opacity = '';
                                            element.style.willChange = '';
                                            element.style.zIndex = '';
                                            element.classList.remove(fallingClass);
                                            resolve();
                                        }
                                    } else {
                                        // 没有记录的位置，直接清理
                                        element.style.transform = '';
                                        element.style.opacity = '';
                                        element.style.willChange = '';
                                        element.style.zIndex = '';
                                        element.classList.remove(fallingClass);
                                        resolve();
                                    }
                                }, elementDuration);
                            });
                        }, delay);
                    })
                );
            });
            
            // 等待所有下落动画完成
            await Promise.all(animationPromises);
            
            // 4.2 处理不需要落下的队伍（使用FLIP技术确保它们在正确位置）
            // 当视口上升时，这些队伍会自然出现在正确位置
            // 但需要在所有下落动画完成后，使用FLIP技术确保它们在正确位置
            const nonFallingElements = allElements.filter(element => !elementsToFallSet.has(element));
            if (nonFallingElements.length > 0) {
                await new Promise(resolve => {
                    requestAnimationFrame(() => {
                        nonFallingElements.forEach(element => {
                            // 获取记录的最终位置
                            const finalPos = finalPositions.get(element);
                            if (finalPos) {
                                // 临时移除transform，检查位置
                                const savedTransform = element.style.transform;
                                element.style.transform = '';
                                const currentRect = element.getBoundingClientRect();
                                const deltaY = finalPos.top - currentRect.top;
                                const deltaX = finalPos.left - currentRect.left;
                                
                                // 恢复transform
                                element.style.transform = savedTransform;
                                
                                // 如果有位置差异，应用FLIP修正
                                if (Math.abs(deltaY) > 0.5 || Math.abs(deltaX) > 0.5) {
                                    element.style.transition = `transform 200ms ease-out`;
                                    element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
                                    
                                    element.offsetHeight;
                                    
                                    requestAnimationFrame(() => {
                                        element.style.transform = 'translate3d(0, 0, 0)';
                                        setTimeout(() => {
                                            element.style.transform = '';
                                            element.style.transition = '';
                                        }, 200);
                                    });
                                } else {
                                    // 位置正确，直接恢复
                                    element.style.transform = '';
                                    element.style.transition = '';
                                }
                            } else {
                                // 直接恢复
                                element.style.transform = '';
                                element.style.transition = '';
                            }
                        });
                        
                        // 等待一帧后resolve
                        requestAnimationFrame(resolve);
                    });
                });
            }
            
            // FLIP最后一步：强制清理所有transform，确保所有元素都在正确位置
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    allElements.forEach(element => {
                        // 最终检查：确保元素没有残留的transform
                        const computedStyle = window.getComputedStyle(element);
                        const transform = computedStyle.transform;
                        if (transform && transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)') {
                            // 有残留transform，清除它
                            element.style.transform = '';
                            element.style.transition = '';
                        }
                    });
                    resolve();
                });
            });
        }
        
        /**
         * 优雅的队伍落下动画
         * @param {HTMLElement[]|string[]} elementsOrIds - 要落下的元素数组或元素ID数组
         * @param {Object} options - 动画选项
         * @param {number} options.duration - 动画持续时间（ms），默认1500
         * @param {boolean} options.shouldScrollFollow - 是否让窗口跟随上升，默认false
         * @param {HTMLElement|string|null} options.targetElement - 滚动目标元素或ID（用于窗口跟随）
         * @param {Function} options.onScrollTo - 滚动回调函数，接收目标元素作为参数
         * @param {number} options.fallDistance - 落下距离（像素），默认视口高度的1.5倍
         * @param {string} options.easing - 缓动函数，默认 'cubic-bezier(0.4, 0, 0.2, 1)'
         * @param {number} options.staggerDelay - 每个元素之间的延迟（ms），默认duration的10%
         * @param {string} options.fallingClass - 添加的CSS类名，默认 'rank-falling-down'
         * @returns {Promise<void>}
         */
        async animateTeamsFallingDown(elementsOrIds, options = {}) {
            const {
                duration = 1500,
                shouldScrollFollow = false,
                targetElement = null,
                onScrollTo = null,
                fallDistance = null,
                easing = 'cubic-bezier(0.4, 0, 0.2, 1)',
                staggerDelay = null,
                fallingClass = 'rank-falling-down'
            } = options;
            
            // 解析元素或ID数组
            const elements = [];
            elementsOrIds.forEach(item => {
                let element;
                if (typeof item === 'string') {
                    element = document.getElementById(item);
                } else if (item && item.nodeType === 1) {
                    element = item;
                }
                if (element) {
                    elements.push(element);
                }
            });
            
            if (elements.length === 0) {
                return;
            }
            
            // 计算落下距离
            const viewportHeight = window.innerHeight;
            const finalFallDistance = fallDistance || (viewportHeight * 1.5);
            
            // 计算每个元素的延迟时间
            const finalStaggerDelay = staggerDelay || (duration / elements.length * 0.1);
            
            // 解析目标元素
            let targetEl = null;
            if (targetElement) {
                if (typeof targetElement === 'string') {
                    targetEl = document.getElementById(targetElement);
                } else if (targetElement && targetElement.nodeType === 1) {
                    targetEl = targetElement;
                }
            }
            
            // 记录所有要落下的元素及其初始位置
            const rowsToAnimate = [];
            elements.forEach(element => {
                const rect = element.getBoundingClientRect();
                rowsToAnimate.push({
                    element: element,
                    initialTop: rect.top,
                    initialHeight: rect.height
                });
            });
            
            // 并行执行落下动画和窗口滚动
            const animationPromises = [];
            
            // 1. 队伍落下动画
            rowsToAnimate.forEach((item, index) => {
                const row = item.element;
                
                // 添加动画类
                row.classList.add(fallingClass);
                row.style.willChange = 'transform, opacity';
                row.style.zIndex = '50';
                
                // 延迟开始，形成流水效果
                const delay = index * finalStaggerDelay;
                
                animationPromises.push(
                    new Promise(resolve => {
                        setTimeout(() => {
                            // 使用 requestAnimationFrame 确保流畅
                            requestAnimationFrame(() => {
                                row.style.transition = `transform ${duration}ms ${easing}, opacity ${duration}ms ease-out`;
                                row.style.transform = `translateY(${finalFallDistance}px)`;
                                row.style.opacity = '0';
                                
                                // 动画完成后清理
                                setTimeout(() => {
                                    row.style.transition = '';
                                    row.style.transform = '';
                                    row.style.opacity = '';
                                    row.style.willChange = '';
                                    row.style.zIndex = '';
                                    row.classList.remove(fallingClass);
                                    resolve();
                                }, duration);
                            });
                        }, delay);
                    })
                );
            });
            
            // 2. 窗口跟随上升（如果启用）
            if (shouldScrollFollow && targetEl && onScrollTo) {
                // 延迟一点开始滚动，让落下动画先开始
                const scrollDelay = duration * 0.2; // 在20%的时间点开始滚动
                animationPromises.push(
                    new Promise(resolve => {
                        setTimeout(() => {
                            onScrollTo(targetEl);
                            // 等待滚动动画完成
                            setTimeout(() => {
                                resolve();
                            }, duration - scrollDelay);
                        }, scrollDelay);
                    })
                );
            }
            
            // 等待所有动画完成
            await Promise.all(animationPromises);
        }
    }
    
    // 创建全局实例
    window.CSGAnim = new CSGAnim();    
}