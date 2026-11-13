(() => {
    'use strict';
    const GEO = 'https://geo.2pl.top/';
    const $ = id => document.getElementById(id);
    const gate = $('gate'), status = $('status'), adBox = $('ad'), video = $('ad-video');
    const skip = $('skip'), resume = $('resume'), pause = $('pause'), mute = $('mute'), click = $('ad-link');
    const id = (new URLSearchParams(location.search).get('id') || '').trim();
    const validId = /^[a-zA-Z0-9_-]{1,160}$/.test(id);
    let parentRef = '', parentHost = '', streamPromise = Promise.resolve(null), config = null;
    let started = false, finished = false, ad = null, watched = 0, previous = 0, previousWall = 0;
    let progressTimer = 0, stallTimer = 0, impressionSent = false, wasPlaying = false;
    const sentEvents = new Set(), trackers = new Set();
    const mainVideos = new Set();
    let mainObserver = null, previewReady = false;
    let streamChoice = null, pendingSource = null, sourceRevision = 0;
    const browserRussian = [...(navigator.languages || []), navigator.language || ''].some(lang => /^ru(?:[-_]|$)/i.test(lang));
    let uiLanguage = browserRussian ? 'ru' : 'en', statusKey = 'loading';
    const messages = {
        en: {
            loading: 'Loading…', loadingStream: 'Loading stream…', loadingAd: 'Loading advertisement…',
            unavailable: 'This stream is unavailable on this page.', invalidId: 'The stream ID is missing or invalid.',
            playerError: 'Unable to load the player.', settingsError: 'Unable to load settings. Please reload the page.',
            play: 'Play', live: 'LIVE', ad: 'Advertisement', resumeAd: 'Play advertisement', advertiser: 'Visit advertiser website',
            pause: 'Pause', continue: 'Resume', mute: 'Mute', unmute: 'Unmute', skip: 'Skip',
            skipAfter: n => `Skip in ${n}s`, source: 'Source:', sourceLabel: 'Stream source',
            auto: n => `Auto — stream ${n}`, stream: n => `Stream ${n}`
        },
        ru: {
            loading: 'Загрузка…', loadingStream: 'Загрузка трансляции…', loadingAd: 'Загрузка рекламы…',
            unavailable: 'Трансляция недоступна на этой странице.', invalidId: 'Идентификатор трансляции не указан или некорректен.',
            playerError: 'Не удалось загрузить плеер.', settingsError: 'Не удалось загрузить настройки. Обновите страницу.',
            play: 'Воспроизвести', live: 'ЭФИР', ad: 'Реклама', resumeAd: 'Продолжить рекламу', advertiser: 'Перейти на сайт рекламодателя',
            pause: 'Пауза', continue: 'Продолжить', mute: 'Выключить звук', unmute: 'Включить звук', skip: 'Пропустить',
            skipAfter: n => `Пропустить через ${n} с`, source: 'Источник:', sourceLabel: 'Источник трансляции',
            auto: n => `Авто — поток ${n}`, stream: n => `Поток ${n}`
        }
    };
    function t(key, value) {
        const message = messages[uiLanguage][key];
        return typeof message === 'function' ? message(value) : message;
    }
    const nativeRussian = {
        'play': 'Воспроизвести', 'pause': 'Пауза', 'play / pause': 'Воспроизвести / пауза',
        'replay': 'Повторить', 'stop': 'Остановить', 'live': 'ЭФИР', 'settings': 'Настройки',
        'quality': 'Качество', 'auto': 'Авто', 'audio': 'Аудио', 'audio track': 'Аудиодорожка',
        'audio tracks': 'Аудиодорожки', 'subtitles': 'Субтитры', 'speed': 'Скорость',
        'playback speed': 'Скорость воспроизведения', 'scale': 'Масштаб', 'volume': 'Громкость',
        'sound': 'Звук', 'mute': 'Выключить звук', 'unmute': 'Включить звук',
        'turn on the sound': 'Включить звук', 'turn off the sound': 'Выключить звук',
        'fullscreen': 'На весь экран', 'full screen': 'На весь экран',
        'exit fullscreen': 'Выйти из полноэкранного режима', 'exit full screen': 'Выйти из полноэкранного режима',
        'picture-in-picture': 'Картинка в картинке', 'close': 'Закрыть', 'off': 'Выкл.',
        'on': 'Вкл.', 'none': 'Нет', 'disabled': 'Отключено', 'download': 'Скачать',
        'share': 'Поделиться', 'copy link': 'Скопировать ссылку', 'copy video link': 'Скопировать ссылку на видео',
        'copy link to video': 'Скопировать ссылку на видео', 'copy embed code': 'Скопировать код плеера',
        'embed code': 'Код плеера', 'loading': 'Загрузка', 'loading...': 'Загрузка…',
        'loading…': 'Загрузка…', 'wait': 'Подождите', 'wait...': 'Подождите…',
        'error': 'Ошибка', 'network error': 'Ошибка сети', 'file not found': 'Файл не найден',
        'video unavailable': 'Видео недоступно', 'retry': 'Повторить', 'try again': 'Повторить',
        'please, turn off the adblock': 'Пожалуйста, отключите блокировщик рекламы',
        'please turn off adblock': 'Пожалуйста, отключите блокировщик рекламы'
    };
    const nativeTextState = new WeakMap(), nativeAttributeState = new WeakMap();
    function nativeText(value) {
        if (uiLanguage !== 'ru') return value;
        const clean = value.trim(), translated = nativeRussian[clean.replace(/\s+/g, ' ').toLowerCase()];
        return translated ? value.replace(clean, translated) : value;
    }
    function localizeNative() {
        const root = $('preroll');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.parentElement.closest('script,style,#source-controls')) continue;
            const saved = nativeTextState.get(node);
            const original = saved?.rendered === node.nodeValue ? saved.original : node.nodeValue;
            const rendered = nativeText(original);
            if (node.nodeValue !== rendered) node.nodeValue = rendered;
            nativeTextState.set(node, {original, rendered});
        }
        for (const node of root.querySelectorAll('[title],[aria-label]')) {
            if (node.closest('#source-controls')) continue;
            const saved = nativeAttributeState.get(node) || {};
            for (const attr of ['title', 'aria-label']) {
                const current = node.getAttribute(attr);
                if (current === null) continue;
                const original = saved[attr]?.rendered === current ? saved[attr].original : current;
                const rendered = nativeText(original);
                if (current !== rendered) node.setAttribute(attr, rendered);
                saved[attr] = {original, rendered};
            }
            nativeAttributeState.set(node, saved);
        }
    }
    function setStatus(key) { statusKey = key; status.textContent = t(key); status.hidden = false; }
    function setAdControl(button, key, value) {
        button.textContent = t(key, value);
        button.setAttribute('aria-label', t(key, value));
        button.dataset.icon = {pause: '⏸', continue: '▶', mute: '🔈', unmute: '🔊', skip: '⏩', skipAfter: '⏩'}[key];
    }
    function updateSkip() {
        const remaining = Math.max(0, Math.ceil(15 - watched));
        skip.disabled = remaining > 0;
        setAdControl(skip, remaining ? 'skipAfter' : 'skip', remaining);
    }
    function applyLanguage(language) {
        uiLanguage = browserRussian || language === 'ru' ? 'ru' : 'en';
        document.documentElement.lang = uiLanguage;
        document.title = t('live');
        gate.textContent = t('play'); gate.setAttribute('aria-label', t('play'));
        resume.setAttribute('aria-label', t('resumeAd')); resume.title = t('resumeAd');
        click.setAttribute('aria-label', t('advertiser'));
        $('ad-label').textContent = t('ad');
        if ($('live-label')) $('live-label').textContent = '00:00 / ' + t('live');
        setAdControl(pause, wasPlaying && video.paused ? 'continue' : 'pause');
        setAdControl(mute, video.muted ? 'unmute' : 'mute');
        status.textContent = t(statusKey);
        updateSkip(); streamChoice?.render(); localizeNative();
    }
    async function loadUiLanguage() {
        if (browserRussian) return;
        try { applyLanguage(JSON.parse(await request(GEO + 'language.php')).uiLanguage); } catch { /* Browser language remains usable. */ }
    }

    class StreamChoice {
        constructor(payload, onSelect) {
            this.sources = [];
            this.mode = 'auto';
            this.onSelect = onSelect;
            this.generation = 0;
            this.lastProbe = 0;
            this.lastIssue = new Map();
            if (payload.canChooseStream !== true || !Array.isArray(payload.streams)) return;
            for (const item of payload.streams) {
                if (!['primary', 'backup'].includes(item.id) || this.sources.some(s => s.id === item.id)) continue;
                const base = safeUrl(item.streamBase);
                if (base && !this.sources.some(s => s.base === base)) this.sources.push({id: item.id, base});
            }
            this.active = this.sources.find(s => s.base === safeUrl(payload.streamBase))?.id || this.sources[0]?.id;
        }
        get enabled() { return this.sources.length > 1; }
        mount() {
            if (!this.enabled) return;
            let box = $('source-controls');
            let created = false;
            if (!box) {
                created = true;
                box = document.createElement('label'); box.id = 'source-controls'; box.hidden = true;
                this.caption = document.createElement('span');
                this.select = document.createElement('select');
                box.append(this.caption, this.select);
                this.select.addEventListener('change', () => {
                    const value = this.select.value;
                    if (value !== 'auto' && !this.sources.some(s => s.id === value)) return;
                    this.mode = value;
                    this.generation++;
                    if (value === 'auto') void this.choose(true);
                    else this.use(value);
                    this.render();
                });
                // Source selection must not propagate into the player's play/pause click handler.
                for (const name of ['click', 'pointerdown', 'keydown']) box.addEventListener(name, e => e.stopPropagation());
            }
            if (box.parentElement !== $('preroll')) $('preroll').appendChild(box);
            box.hidden = !finished;
            if (created) this.render();
            this.bindActivity();
            if (finished && (created || !this.controlsUnlocked)) {
                this.controlsUnlocked = true;
                this.showControls();
            }
        }
        bindActivity() {
            const player = $('preroll');
            if (this.activityTarget === player) return;
            this.activityTarget = player;
            player.addEventListener('pointerenter', e => {
                this.hovering = e.pointerType === 'mouse' || e.pointerType === 'pen';
                this.showControls();
            });
            player.addEventListener('pointermove', e => {
                if (e.pointerType === 'mouse' || e.pointerType === 'pen') this.hovering = true;
                this.showControls();
            });
            player.addEventListener('pointerleave', () => { this.hovering = false; this.scheduleHide(); });
            player.addEventListener('pointerdown', e => {
                if (e.pointerType === 'touch') this.hovering = false;
                this.showControls();
            }, true);
            player.addEventListener('focusin', () => this.showControls());
            player.addEventListener('focusout', () => this.scheduleHide());
            player.addEventListener('keydown', () => this.showControls());
            if (!this.windowActivityBound) {
                this.windowActivityBound = true;
                window.addEventListener('blur', () => { this.hovering = false; this.scheduleHide(); });
            }
        }
        showControls() {
            const box = $('source-controls');
            if (!box || !finished) return;
            box.classList.remove('controls-idle'); box.inert = false;
            this.scheduleHide();
        }
        scheduleHide() {
            clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                const box = $('source-controls');
                if (!box || this.hovering || (document.hasFocus() && box.matches(':focus-within'))) return;
                box.classList.add('controls-idle'); box.inert = true;
            }, 2000);
        }
        render() {
            if (!this.select) return;
            this.caption.textContent = t('source');
            this.select.setAttribute('aria-label', t('sourceLabel'));
            const selected = this.mode;
            this.select.replaceChildren();
            const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; this.select.appendChild(node); };
            const index = this.sources.findIndex(s => s.id === this.active) + 1;
            option('auto', t('auto', index));
            this.sources.forEach((s, i) => option(s.id, t('stream', i + 1)));
            this.select.value = selected;
        }
        use(sourceId) {
            const source = this.sources.find(s => s.id === sourceId);
            if (!source || source.id === this.active) return;
            this.active = source.id;
            this.onSelect(source);
            this.render();
        }
        issue() {
            if (!this.enabled || this.mode !== 'auto' || !finished || document.hidden) return;
            this.lastIssue.set(this.active, performance.now());
            clearTimeout(this.recoveryTimer);
            this.recoveryTimer = setTimeout(() => {
                if (this.mode === 'auto' && finished && !document.hidden) void this.choose();
            }, Math.max(0, 30000 - (performance.now() - this.lastProbe)));
        }
        async read(url, signal, limit) {
            const response = await fetch(url, {credentials: 'omit', cache: 'no-store', signal});
            if (!response.ok || !response.body) throw new Error('Unavailable');
            const reader = response.body.getReader(), parts = [];
            let size = 0;
            try {
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    size += value.length;
                    if (size > limit) throw new Error('Probe size limit');
                    parts.push(value);
                }
            } finally { await reader.cancel().catch(() => {}); }
            const result = new Uint8Array(size);
            let offset = 0;
            for (const part of parts) { result.set(part, offset); offset += part.length; }
            return result;
        }
        async probe(source) {
            const controller = new AbortController(), startedAt = performance.now();
            const timer = setTimeout(() => controller.abort(), 6000);
            try {
                let url = source.base.replace(/\/+$/, '') + '/' + encodeURIComponent(id) + '.m3u8';
                const decoder = new TextDecoder();
                let lines;
                // Follow at most two master playlists; use the lowest declared bandwidth for the trial.
                for (let depth = 0; depth < 3; depth++) {
                    const body = decoder.decode(await this.read(url, controller.signal, 262144)).trim();
                    if (!body.startsWith('#EXTM3U')) throw new Error('Invalid playlist');
                    lines = body.split(/\r?\n/).map(s => s.trim());
                    const variants = [];
                    for (let i = 0; i < lines.length - 1; i++) if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
                        const next = lines.slice(i + 1).find(s => s && !s.startsWith('#'));
                        const target = safeUrl(next, url);
                        if (target) variants.push({url: target, bandwidth: Number(lines[i].match(/(?:^|[, :])BANDWIDTH=(\d+)/)?.[1] || Infinity)});
                    }
                    if (!variants.length) break;
                    if (depth === 2) throw new Error('Playlist depth');
                    variants.sort((a, b) => a.bandwidth - b.bandwidth);
                    url = variants[0].url;
                }
                if (!lines.some(s => s.startsWith('#EXTINF:'))) throw new Error('No complete segments');
                const segments = lines.filter(s => s && !s.startsWith('#')).map(s => safeUrl(s, url)).filter(Boolean).slice(-2);
                if (!segments.length || lines.some(s => s.startsWith('#EXT-X-BYTERANGE:'))) throw new Error('Unsupported trial');
                const manifestMs = performance.now() - startedAt;
                const times = [];
                for (const segment of segments) {
                    const before = performance.now();
                    const bytes = await this.read(segment, controller.signal, 4194304);
                    if (!bytes.length) throw new Error('Empty segment');
                    times.push(performance.now() - before);
                }
                const average = times.reduce((a, b) => a + b, 0) / times.length;
                const jitter = Math.max(...times) - Math.min(...times);
                return {id: source.id, score: manifestMs + average + jitter};
            } catch { return {id: source.id, score: Infinity}; }
            finally { clearTimeout(timer); }
        }
        async choose(force = false) {
            if (!this.enabled || this.mode !== 'auto') return;
            this.lastProbe = performance.now();
            const generation = ++this.generation;
            const results = await Promise.all(this.sources.map(source => this.probe(source)));
            if (generation !== this.generation || this.mode !== 'auto') return;
            const score = result => result.score + (performance.now() - (this.lastIssue.get(result.id) ?? -Infinity) < 60000 ? 3000 : 0);
            results.sort((a, b) => score(a) - score(b));
            const best = results[0], current = results.find(r => r.id === this.active);
            // Inconclusive (including missing CORS) keeps the GEO default. A small timing difference is ignored.
            if (Number.isFinite(best.score) && (force || score(best) < score(current) * .8)) this.use(best.id);
        }
    }

    function switchSource(source) {
        if (!streamChoice?.enabled) return;
        if (started && !finished) { pendingSource = source; return; }
        const wasPlaying = [...$('preroll').querySelectorAll('video')].some(media => !media.paused);
        sourceRevision++;
        if (!finished) {
            previewReady = false;
            $('shell').classList.remove('preview-ready');
            mainCommand('mute'); mainCommand('volume', 0);
        }
        const file = source.base.replace(/\/+$/, '') + '/' + encodeURIComponent(id) + '.m3u8';
        // Manual choice starts the selected live source. Automatic choice respects a user's pause.
        mainCommand(!finished || streamChoice.mode !== 'auto' || wasPlaying ? 'play' : 'preload', file);
    }

    function mainCommand(command, value) {
        try { window.player?.api(command, value); } catch { /* Native media remains guarded below. */ }
    }
    function holdMain() {
        mainCommand('pause');
        for (const media of mainVideos) {
            media.muted = true;
            media.volume = 0;
            media.pause();
        }
    }
    function watchMain(media) {
        if (mainVideos.has(media)) return;
        mainVideos.add(media);
        const lockSound = () => {
            if (finished) return;
            if (!media.muted) media.muted = true;
            if (media.volume !== 0) media.volume = 0;
        };
        lockSound();
        media.preload = 'auto';
        media.setAttribute('playsinline', '');
        media.addEventListener('volumechange', lockSound);
        let waitingTimer = 0;
        const clearWaiting = () => { clearTimeout(waitingTimer); };
        media.addEventListener('waiting', () => {
            clearWaiting();
            if (finished && !media.paused) waitingTimer = setTimeout(() => streamChoice?.issue(), 10000);
        });
        media.addEventListener('playing', clearWaiting);
        media.addEventListener('pause', clearWaiting);
        media.addEventListener('error', () => streamChoice?.issue());
        // loadeddata means decoding is possible, not that Playerjs has displayed its video.
        // Let its startup run for two seconds of actual playback, then wait for a painted frame.
        if (media.tagName === 'VIDEO') {
            let framePending = false, paintPending = false;
            const hasFrameCallback = typeof media.requestVideoFrameCallback === 'function';
            const canPreview = () => !finished && !started && !previewReady
                && media.readyState >= 2 && media.videoWidth > 0;
            const playedSeconds = () => {
                let seconds = 0;
                for (let i = 0; i < media.played.length; i++) seconds += media.played.end(i) - media.played.start(i);
                return seconds;
            };
            const freezeAfterPaint = () => {
                if (!canPreview() || paintPending || playedSeconds() < 2) return;
                paintPending = true;
                const revision = sourceRevision;
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    paintPending = false;
                    if (!canPreview() || revision !== sourceRevision) return;
                    previewReady = true;
                    $('shell').classList.add('preview-ready');
                    $('poster').hidden = true;
                    holdMain();
                }));
            };
            const waitForFrame = () => {
                if (!hasFrameCallback || framePending || finished || started || previewReady) return;
                framePending = true;
                media.requestVideoFrameCallback(() => {
                    framePending = false;
                    freezeAfterPaint();
                    waitForFrame();
                });
            };
            media.addEventListener('loadeddata', waitForFrame);
            media.addEventListener('playing', waitForFrame);
            if (!hasFrameCallback) media.addEventListener('timeupdate', freezeAfterPaint);
            waitForFrame();
        } else {
            // A separate audio element must never mark a video preview as ready.
            media.addEventListener('play', () => { if (!finished) media.pause(); });
            if (!finished) media.pause();
        }
        media.addEventListener('play', () => {
            if (!finished && (started || previewReady)) holdMain();
        });
        if (started && !finished) holdMain();
    }
    function prepareMain(stream) {
        if (!stream || !validId) return;
        const base = safeUrl(stream.streamBase);
        if (!base || typeof window.Playerjs !== 'function') return;
        streamChoice = new StreamChoice(stream, switchSource);
        const scan = () => {
            $('preroll').querySelectorAll('video, audio').forEach(watchMain);
            localizeNative();
            streamChoice.mount();
        };
        mainObserver = new MutationObserver(scan);
        mainObserver.observe($('preroll'), {childList: true, subtree: true, characterData: true,
            attributes: true, attributeFilter: ['title', 'aria-label']});
        // Warm up muted until a preview is painted. Never run the stream under an ad.
        window.player = new window.Playerjs({id: 'preroll',
            file: base.replace(/\/+$/, '') + '/' + encodeURIComponent(id) + '.m3u8',
            autoplay: started || finished ? 0 : 1, mute: 1, volume: 0, preload: 1, ratio: '16/9', lang: uiLanguage});
        scan();
        if (!finished) mainCommand('mute');
        void streamChoice.choose();
    }

    function safeUrl(value, base = location.href) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            const url = new URL(value, base);
            return url.protocol === 'https:' || (location.protocol === 'http:' && url.protocol === 'http:') ? url.href : '';
        } catch { return ''; }
    }
    function hash(host, salt) {
        let a = 5381, b = 52711;
        for (const char of salt + '|' + host) {
            a = (Math.imul(a, 33) ^ char.charCodeAt(0)) >>> 0;
            b = (Math.imul(b, 33) ^ char.charCodeAt(0)) >>> 0;
        }
        return a.toString(36).padStart(7, '0') + b.toString(36).padStart(7, '0');
    }
    function allowed(host, data) {
        if (data.keyAlgo !== 'pair-djb2-v1' || typeof data.key !== 'string' || typeof data.salt !== 'string'
            || data.key.length % 14 !== 0) return false;
        const parts = host.split('.');
        while (parts.length >= 2) {
            const candidate = hash(parts.join('.'), data.salt);
            for (let i = 0; i < data.key.length; i += 14) if (data.key.slice(i, i + 14) === candidate) return true;
            parts.shift();
        }
        return false;
    }
    async function request(url, options = {}, timeout = 10000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {credentials: 'omit', cache: 'no-store', ...options, signal: controller.signal});
            if (!response.ok) throw new Error('Request failed');
            // Read while the abort timeout is still active.
            return await response.text();
        } finally { clearTimeout(timer); }
    }
    function macros(url, code = '') {
        const cache = String(Math.floor(10000000 + Math.random() * 90000000));
        const time = new Date().toISOString();
        const playhead = new Date(Math.max(0, video.currentTime || 0) * 1000).toISOString().slice(11, 23);
        return url.replace(/\[(?:CACHEBUSTING|CACHEBUSTER|RANDOM)\]|%%CACHEBUSTER%%/gi, cache)
            .replace(/\[ERRORCODE\]/gi, code).replace(/\[TIMESTAMP\]/gi, encodeURIComponent(time))
            .replace(/\[CONTENTPLAYHEAD\]/gi, encodeURIComponent(playhead));
    }
    function ping(url, code = '') {
        const target = safeUrl(macros(url, code));
        if (!target) return;
        const img = new Image();
        trackers.add(img);
        img.onload = img.onerror = () => trackers.delete(img);
        img.src = target;
    }
    function event(name) {
        if (!ad || sentEvents.has(name)) return;
        sentEvents.add(name);
        for (const item of ad.tracking) if (item.event === name) ping(item.url);
    }
    function text(node, selector) { return node.querySelector(selector)?.textContent.trim() || ''; }
    function urls(node, selector, base) {
        return Array.from(node.querySelectorAll(selector), n => safeUrl(n.textContent.trim(), base)).filter(Boolean);
    }
    async function loadVast(url, depth = 0, inherited = {impressions: [], errors: [], tracking: [], clicks: []}) {
        if (depth > 5) { inherited.errors.forEach(u => ping(u, '302')); throw new Error('Wrapper limit'); }
        try {
            const xml = new DOMParser().parseFromString(await request(macros(url), {}, 7000), 'application/xml');
            if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'VAST') throw new Error('Invalid VAST');
            const node = xml.querySelector('Ad > InLine, Ad > Wrapper');
            if (!node) {
                urls(xml, 'VAST > Error', url).forEach(u => ping(u, '303'));
                throw new Error('Empty VAST');
            }
            const linear = node.querySelector('Creative > Linear');
            const data = {
                impressions: [...inherited.impressions, ...urls(node, ':scope > Impression', url)],
                errors: [...inherited.errors, ...urls(node, ':scope > Error', url)],
                clicks: [...inherited.clicks, ...urls(linear || node, 'VideoClicks > ClickTracking', url)],
                tracking: [...inherited.tracking, ...Array.from((linear || node).querySelectorAll('TrackingEvents > Tracking'), n => ({
                    event: n.getAttribute('event'), offset: n.getAttribute('offset'), url: safeUrl(n.textContent.trim(), url)
                })).filter(t => t.url)]
            };
            if (node.localName === 'Wrapper') {
                const next = safeUrl(text(node, 'VASTAdTagURI'), url);
                if (!next) throw new Error('Missing wrapper URL');
                return await loadVast(next, depth + 1, data);
            }
            const media = Array.from((linear || node).querySelectorAll('MediaFiles > MediaFile')).find(n => {
                const type = n.getAttribute('type') || '';
                return !n.getAttribute('apiFramework') && video.canPlayType(type) && safeUrl(n.textContent.trim(), url);
            });
            if (!media) { data.errors.forEach(u => ping(u, '403')); throw new Error('Unsupported media'); }
            return {...data, media: safeUrl(media.textContent.trim(), url), click: safeUrl(text(linear, 'VideoClicks > ClickThrough'), url)};
        } catch (error) {
            if (depth === 0) inherited.errors.forEach(u => ping(u, '301'));
            throw error;
        }
    }
    function setStallTimer() {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => failAd('402'), 20000);
    }
    function updateProgress() {
        if (finished || !ad) return;
        const now = performance.now();
        const delta = video.currentTime - previous;
        const wall = (now - previousWall) / 1000;
        if (!video.paused && !video.seeking && !document.hidden && delta > 0) {
            watched += Math.min(delta, wall + 0.02);
            setStallTimer();
        }
        previous = video.currentTime; previousWall = now;
        updateSkip();
        if (Number.isFinite(video.duration) && video.duration > 0) {
            for (const [name, fraction] of [['firstQuartile', .25], ['midpoint', .5], ['thirdQuartile', .75]]) {
                if (watched >= video.duration * fraction) event(name);
            }
        }
        for (const item of ad.tracking) {
            if (item.event !== 'progress' || !item.offset) continue;
            const seconds = item.offset.endsWith('%') ? video.duration * parseFloat(item.offset) / 100
                : item.offset.split(':').reduce((sum, n) => sum * 60 + Number(n), 0);
            const key = 'progress:' + item.offset + ':' + item.url;
            if (watched >= seconds && !sentEvents.has(key)) { sentEvents.add(key); ping(item.url); }
        }
    }
    async function finishAd() {
        if (finished) return;
        finished = true;
        clearInterval(progressTimer); clearTimeout(stallTimer);
        video.pause(); video.removeAttribute('src'); video.load();
        adBox.hidden = true;
        setStatus('loadingStream');
        const stream = await streamPromise;
        if (!stream || !validId) {
            setStatus(validId ? 'unavailable' : 'invalidId');
            return;
        }
        if (!window.player) { setStatus('playerError'); return; }
        status.hidden = true;
        $('poster').hidden = true;
        $('player-stage').inert = false;
        streamChoice?.mount();
        for (const media of mainVideos) { media.muted = false; media.volume = 1; }
        mainCommand('volume', 1);
        mainCommand('unmute');
        if (pendingSource) {
            const next = pendingSource; pendingSource = null;
            switchSource(next);
        }
        mainCommand('play');
    }
    function failAd(code) {
        if (finished) return;
        if (ad) ad.errors.forEach(url => ping(url, code));
        void finishAd();
    }
    async function playAd() {
        if (started || !config) return;
        started = true; gate.hidden = true;
        holdMain();
        $('poster').hidden = true;
        if (!config.vastUrl) { await finishAd(); return; }
        setStatus('loadingAd');
        try {
            const vast = safeUrl(config.vastUrl);
            if (!vast) throw new Error('Invalid VAST URL');
            // A total budget covers an entire Wrapper chain, including failed requests.
            stallTimer = setTimeout(() => failAd('301'), 25000);
            const loaded = await loadVast(vast);
            if (finished) return;
            ad = loaded; status.hidden = true; adBox.hidden = false;
            click.hidden = !ad.click; if (ad.click) click.href = ad.click;
            previousWall = performance.now(); previous = 0;
            video.src = ad.media; video.load(); setStallTimer();
            progressTimer = setInterval(updateProgress, 200);
            await tryPlay();
        } catch { failAd('301'); }
    }
    async function tryPlay() {
        try { await video.play(); resume.hidden = true; }
        catch {
            clearTimeout(stallTimer); resume.hidden = false;
        }
    }
    video.addEventListener('playing', () => {
        previous = video.currentTime; previousWall = performance.now(); wasPlaying = true;
        resume.hidden = true; setAdControl(pause, 'pause'); setStallTimer();
        if (!impressionSent && ad) {
            impressionSent = true; ad.impressions.forEach(u => ping(u)); event('start'); event('creativeView');
        } else if (sentEvents.has('pause')) event('resume');
    });
    video.addEventListener('pause', () => {
        clearTimeout(stallTimer);
        if (!finished && wasPlaying) { event('pause'); setAdControl(pause, 'continue'); resume.hidden = false; }
    });
    video.addEventListener('ended', () => { event('complete'); void finishAd(); });
    video.addEventListener('error', () => { if (ad && !finished) failAd('405'); });
    video.addEventListener('ratechange', () => { if (video.playbackRate !== 1) video.playbackRate = 1; });
    video.addEventListener('seeking', () => { previous = video.currentTime; previousWall = performance.now(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && !finished && ad) { video.pause(); resume.hidden = false; }
    });
    skip.addEventListener('click', () => { if (watched >= 15) { event('skip'); void finishAd(); } });
    resume.addEventListener('click', () => void tryPlay());
    pause.addEventListener('click', () => video.paused ? void tryPlay() : video.pause());
    mute.addEventListener('click', () => { video.muted = !video.muted; setAdControl(mute, video.muted ? 'unmute' : 'mute'); event(video.muted ? 'mute' : 'unmute'); });
    click.addEventListener('click', () => { if (ad) ad.clicks.forEach(u => ping(u)); });
    gate.addEventListener('click', () => void playAd());

    async function init() {
        try {
            // Only a genuine iframe parent is eligible. An ordinary incoming link is not a parent.
            if (window.parent !== window && document.referrer) {
                const url = new URL(document.referrer);
                if (['http:', 'https:'].includes(url.protocol)) {
                    parentRef = url.origin; parentHost = url.hostname.toLowerCase().replace(/\.$/, '');
                }
            }
            config = JSON.parse(await request(GEO + 'restrictions.json', {cache: 'default'}));
            if (typeof config.vastUrl !== 'string') throw new Error('Invalid config');
            if (parentHost && validId && allowed(parentHost, config)) {
                // A CORS-safelisted content type avoids OPTIONS, which some upstream proxies reject.
                // The body remains JSON and is decoded/validated by the handler as before.
                streamPromise = request(GEO, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify({parentRef})})
                    .then(JSON.parse).then(stream => { applyLanguage(stream.uiLanguage); prepareMain(stream); return stream; })
                    .catch(() => { void loadUiLanguage(); return null; });
            } else void loadUiLanguage();
            status.hidden = true; gate.disabled = false;
        } catch {
            setStatus('settingsError');
            gate.hidden = true;
        }
    }
    applyLanguage(uiLanguage);
    void init();
})();
