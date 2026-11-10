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
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    paintPending = false;
                    if (!canPreview()) return;
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
        const scan = () => $('preroll').querySelectorAll('video, audio').forEach(watchMain);
        mainObserver = new MutationObserver(scan);
        mainObserver.observe($('preroll'), {childList: true, subtree: true});
        // Warm up muted until a preview is painted. Never run the stream under an ad.
        window.player = new window.Playerjs({id: 'preroll',
            file: base.replace(/\/+$/, '') + '/' + encodeURIComponent(id) + '.m3u8',
            autoplay: started || finished ? 0 : 1, mute: 1, volume: 0, preload: 1, ratio: '16/9'});
        scan();
        if (!finished) mainCommand('mute');
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
        const remaining = Math.max(0, Math.ceil(15 - watched));
        skip.disabled = remaining > 0;
        skip.textContent = remaining ? `Пропустить через ${remaining} с` : 'Пропустить';
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
        status.textContent = 'Загрузка трансляции…'; status.hidden = false;
        const stream = await streamPromise;
        if (!stream || !validId) {
            status.textContent = validId ? 'Трансляция недоступна на этой странице.' : 'Идентификатор трансляции не указан или некорректен.';
            return;
        }
        if (!window.player) { status.textContent = 'Не удалось загрузить плеер.'; return; }
        status.hidden = true;
        $('poster').hidden = true;
        mainObserver?.disconnect();
        $('player-stage').inert = false;
        for (const media of mainVideos) { media.muted = false; media.volume = 1; }
        mainCommand('volume', 1);
        mainCommand('unmute');
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
        status.textContent = 'Загрузка рекламы…'; status.hidden = false;
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
            resume.textContent = 'Нажмите, чтобы смотреть рекламу';
        }
    }
    video.addEventListener('playing', () => {
        previous = video.currentTime; previousWall = performance.now(); wasPlaying = true;
        resume.hidden = true; pause.textContent = 'Пауза'; setStallTimer();
        if (!impressionSent && ad) {
            impressionSent = true; ad.impressions.forEach(u => ping(u)); event('start'); event('creativeView');
        } else if (sentEvents.has('pause')) event('resume');
    });
    video.addEventListener('pause', () => {
        clearTimeout(stallTimer);
        if (!finished && wasPlaying) { event('pause'); pause.textContent = 'Продолжить'; }
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
    mute.addEventListener('click', () => { video.muted = !video.muted; mute.textContent = video.muted ? 'Включить звук' : 'Выключить звук'; event(video.muted ? 'mute' : 'unmute'); });
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
                    .then(JSON.parse).then(stream => { prepareMain(stream); return stream; }).catch(() => null);
            }
            status.hidden = true; gate.disabled = false;
        } catch {
            status.textContent = 'Не удалось загрузить настройки. Обновите страницу.';
            gate.hidden = true;
        }
    }
    void init();
})();
