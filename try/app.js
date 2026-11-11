/* Glass Home for LG (webOS) and Samsung (Tizen) TVs.
 * Plain ES5 so it runs on older TV browsers (webOS 4+/Chromium 53, Tizen 4+/Chromium 56).
 * Weather from Open-Meteo (free, no key, no account). Settings are kept on the TV only. */
(function () {
  'use strict';

  // ---------- settings ----------
  var DEFAULTS = { city: '', lat: null, lon: null, tz: '', h24: false, fahrenheit: true, name: '',
                   bg: 'auto', world: 0, welcomed: false };
  var WORLD_SETS = [
    { label: 'London · Tokyo · Sydney', zones: [['London', 'Europe/London'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney']] },
    { label: 'New York · Paris · Dubai', zones: [['New York', 'America/New_York'], ['Paris', 'Europe/Paris'], ['Dubai', 'Asia/Dubai']] },
    { label: 'Los Angeles · Chennai · Singapore', zones: [['Los Angeles', 'America/Los_Angeles'], ['Chennai', 'Asia/Kolkata'], ['Singapore', 'Asia/Singapore']] },
    { label: 'Chicago · Berlin · Hong Kong', zones: [['Chicago', 'America/Chicago'], ['Berlin', 'Europe/Berlin'], ['Hong Kong', 'Asia/Hong_Kong']] }
  ];
  var BGS = [['auto', 'Day & night (automatic)'], ['day', 'Grand Teton, day'], ['night', 'Grand Teton, night'], ['dark', 'Plain dark']];

  var S = load();
  function load() {
    var s = {}, k, saved = null;
    try { saved = JSON.parse(localStorage.getItem('glasshome') || 'null'); } catch (e) { }
    for (k in DEFAULTS) s[k] = DEFAULTS[k];
    if (saved) for (k in saved) if (k in DEFAULTS) s[k] = saved[k];
    return s;
  }
  function save() { try { localStorage.setItem('glasshome', JSON.stringify(S)); } catch (e) { } }

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- time in another zone (Intl, with a safe fallback) ----------
  function partsIn(zone, d) {
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false });
      var out = {}, p = f.formatToParts ? f.formatToParts(d) : null;
      if (p) { for (var i = 0; i < p.length; i++) out[p[i].type] = p[i].value; }
      else { var m = f.format(d).match(/(\w+),? (\d+):(\d+)/); out = { weekday: m[1], hour: m[2], minute: m[3] }; }
      return { h: parseInt(out.hour, 10) % 24, m: parseInt(out.minute, 10), wd: out.weekday };
    } catch (e) { return null; }
  }
  function fmtTime(h, m) {
    if (S.h24) return { t: pad(h) + ':' + pad(m), ap: '' };
    var hh = h % 12 || 12;
    return { t: hh + ':' + pad(m), ap: h < 12 ? 'AM' : 'PM' };
  }

  // ---------- clock, date, greeting ----------
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var lastMin = -1;

  function tick() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    if (m !== lastMin) {
      lastMin = m;
      var hh = S.h24 ? pad(h) : String(h % 12 || 12);
      $('hh').textContent = hh;
      $('mm').textContent = pad(m);
      $('ampm').textContent = S.h24 ? '' : (h < 12 ? 'AM' : 'PM');
      $('date').textContent = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
      var g = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
      $('greet').textContent = S.name ? g + ', ' + S.name : g;
      drawWorld(d);
      setBackground(h);
      // Move the clock a few pixels each minute so nothing sits still on the panel for hours.
      var dx = ((m * 7) % 13) - 6, dy = ((m * 5) % 11) - 5;
      $('hero').style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  }

  function drawWorld(d) {
    var set = WORLD_SETS[S.world % WORLD_SETS.length].zones, html = '';
    var here = d.getDay();
    for (var i = 0; i < set.length; i++) {
      var p = partsIn(set[i][1], d);
      if (!p) continue;
      var f = fmtTime(p.h, p.m);
      var shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var diffDay = p.wd && p.wd !== shortDays[here] ? p.wd : 'Today';
      html += '<div class="city"><div class="c">' + set[i][0] + '</div><div class="t">' + f.t +
              (f.ap ? '<small>' + f.ap + '</small>' : '') + '</div><div class="d">' + diffDay + '</div></div>';
    }
    $('world').innerHTML = html;
  }

  // ---------- background ----------
  var bgShown = '', bgFront = 'bgA', sunMins = null;
  function setBackground(h) {
    var mins = h * 60 + new Date().getMinutes();
    var day = sunMins ? mins >= sunMins[0] && mins < sunMins[1] + 30 : h >= 6 && h < 19;   // real sunrise/sunset once weather is in
    var want = S.bg === 'auto' ? (day ? 'day' : 'night') : S.bg;
    if (want === bgShown) return;
    bgShown = want;
    var back = bgFront === 'bgA' ? 'bgB' : 'bgA', el = $(back);
    el.style.backgroundImage = want === 'dark' ? 'radial-gradient(ellipse at 70% 30%, #1d2740 0%, #0b0d12 70%)'
                                                 : 'url(img/teton-' + want + '.jpg)';
    el.className = 'bg-img on';
    $(bgFront).className = 'bg-img';
    bgFront = back;
  }

  // ---------- weather ----------
  var ICON = {
    sun: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="12" fill="#FFD54A"/><g stroke="#FFD54A" stroke-width="4" stroke-linecap="round"><path d="M32 6v7M32 51v7M6 32h7M51 32h7M13.6 13.6l5 5M45.4 45.4l5 5M13.6 50.4l5-5M45.4 18.6l5-5"/></g></svg>',
    moon: '<svg viewBox="0 0 64 64"><path d="M40 10a22 22 0 1 0 14 34A18 18 0 0 1 40 10z" fill="#E8EEFF"/></svg>',
    partly: '<svg viewBox="0 0 64 64"><circle cx="24" cy="24" r="10" fill="#FFD54A"/><path d="M22 52h26a10 10 0 0 0 0-20 14 14 0 0 0-26 4 8 8 0 0 0 0 16z" fill="#F2F5FA"/></svg>',
    cloud: '<svg viewBox="0 0 64 64"><path d="M18 50h30a11 11 0 0 0 0-22 15 15 0 0 0-29 4 9 9 0 0 0-1 18z" fill="#E3E8F0"/></svg>',
    rain: '<svg viewBox="0 0 64 64"><path d="M18 40h30a11 11 0 0 0 0-22 15 15 0 0 0-29 4 9 9 0 0 0-1 18z" fill="#E3E8F0"/><g stroke="#6FB6FF" stroke-width="4" stroke-linecap="round"><path d="M22 46l-3 8M33 46l-3 8M44 46l-3 8"/></g></svg>',
    snow: '<svg viewBox="0 0 64 64"><path d="M18 40h30a11 11 0 0 0 0-22 15 15 0 0 0-29 4 9 9 0 0 0-1 18z" fill="#E3E8F0"/><g fill="#fff"><circle cx="22" cy="50" r="3"/><circle cx="33" cy="54" r="3"/><circle cx="44" cy="50" r="3"/></g></svg>',
    storm: '<svg viewBox="0 0 64 64"><path d="M18 38h30a11 11 0 0 0 0-22 15 15 0 0 0-29 4 9 9 0 0 0-1 18z" fill="#C9D0DC"/><path d="M34 40l-8 12h7l-3 10 10-14h-7l3-8z" fill="#FFD54A"/></svg>',
    fog: '<svg viewBox="0 0 64 64"><g stroke="#E3E8F0" stroke-width="4" stroke-linecap="round"><path d="M12 24h40M8 34h48M14 44h36"/></g></svg>'
  };
  function kind(code, night) {
    if (code === 0) return night ? 'moon' : 'sun';
    if (code <= 2) return night ? 'moon' : 'partly';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'rain';
  }
  function words(code) {
    if (code === 0) return 'Clear';
    if (code === 1) return 'Mostly clear';
    if (code === 2) return 'Partly cloudy';
    if (code === 3) return 'Cloudy';
    if (code === 45 || code === 48) return 'Fog';
    if (code >= 51 && code <= 57) return 'Drizzle';
    if (code >= 61 && code <= 67) return 'Rain';
    if (code >= 71 && code <= 77) return 'Snow';
    if (code >= 80 && code <= 82) return 'Showers';
    if (code === 85 || code === 86) return 'Snow showers';
    if (code >= 95) return 'Thunderstorms';
    return '';
  }

  function get(url, ok, fail) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 15000;
    x.onload = function () {
      if (x.status === 200) { try { ok(JSON.parse(x.responseText)); return; } catch (e) { } }
      if (fail) fail();
    };
    x.onerror = x.ontimeout = function () { if (fail) fail(); };
    x.send();
  }

  function fmtClock(iso) {   // "2026-11-09T17:20" -> "5:20 PM"
    var m = /T(\d+):(\d+)/.exec(iso || '');
    if (!m) return '';
    var f = fmtTime(parseInt(m[1], 10), parseInt(m[2], 10));
    return f.t + (f.ap ? ' ' + f.ap : '');
  }

  function refreshWeather() {
    if (S.lat === null) {
      $('wCity').textContent = 'Weather';
      $('wTemp').textContent = '--°';
      $('wDesc').textContent = 'Press OK to set your city';
      $('wHiLo').textContent = '';
      $('wIcon').innerHTML = ICON.partly;
      $('days').innerHTML = '';
      $('forecastCard').style.display = 'none';
      return;
    }
    var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + S.lat + '&longitude=' + S.lon +
      '&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset' +
      '&timezone=auto&forecast_days=6' + (S.fahrenheit ? '&temperature_unit=fahrenheit' : '');
    get(u, function (r) {
      var c = r.current, dl = r.daily;
      $('wCity').textContent = S.city;
      $('wTemp').textContent = Math.round(c.temperature_2m) + '°';
      $('wIcon').innerHTML = ICON[kind(c.weather_code, !c.is_day)];
      $('wDesc').textContent = words(c.weather_code);
      $('wHiLo').textContent = 'H ' + Math.round(dl.temperature_2m_max[0]) + '°  L ' + Math.round(dl.temperature_2m_min[0]) + '°';
      $('sun').textContent = 'Sunrise ' + fmtClock(dl.sunrise[0]) + '   ·   Sunset ' + fmtClock(dl.sunset[0]);
      var toMin = function (iso) { var m = /T(\d+):(\d+)/.exec(iso || ''); return m ? +m[1] * 60 + +m[2] : null; };
      var a = toMin(dl.sunrise[0]), b = toMin(dl.sunset[0]);
      sunMins = a !== null && b !== null ? [a, b] : null;
      setBackground(new Date().getHours());
      var html = '', short = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (var i = 0; i < dl.time.length && i < 6; i++) {
        var p = dl.time[i].split('-'), wd = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
        html += '<div class="day"><div class="n">' + (i === 0 ? 'Today' : short[wd]) + '</div>' + ICON[kind(dl.weather_code[i], false)] +
                '<div class="t">' + Math.round(dl.temperature_2m_max[i]) + '°<span>' + Math.round(dl.temperature_2m_min[i]) + '°</span></div></div>';
      }
      $('days').innerHTML = html;
      $('forecastCard').style.display = '';
    }, function () { $('wDesc').textContent = 'Weather unavailable — will retry'; });
  }

  function findCity(name, done) {
    get('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=' + encodeURIComponent(name), function (r) {
      var g = r.results && r.results[0];
      if (!g) { done(false); return; }
      S.city = g.name; S.lat = g.latitude; S.lon = g.longitude; save(); done(true);
    }, function () { done(false); });
  }

  // ---------- settings ----------
  var rows = [
    { k: 'city', t: 'City for weather', v: function () { return S.city || 'Not set'; }, edit: 'city' },
    { k: 'name', t: 'Name in the greeting', v: function () { return S.name || 'None'; }, edit: 'name' },
    { k: 'h24', t: 'Clock', v: function () { return S.h24 ? '24-hour' : '12-hour'; }, act: function () { S.h24 = !S.h24; } },
    { k: 'f', t: 'Temperature', v: function () { return S.fahrenheit ? '°F' : '°C'; }, act: function () { S.fahrenheit = !S.fahrenheit; refreshWeather(); } },
    { k: 'world', t: 'World clocks', v: function () { return WORLD_SETS[S.world % WORLD_SETS.length].label; }, act: function () { S.world = (S.world + 1) % WORLD_SETS.length; } },
    { k: 'bg', t: 'Background', v: function () { for (var i = 0; i < BGS.length; i++) if (BGS[i][0] === S.bg) return BGS[i][1]; return ''; },
      act: function () { for (var i = 0; i < BGS.length; i++) if (BGS[i][0] === S.bg) { S.bg = BGS[(i + 1) % BGS.length][0]; break; } } }
  ];
  var sel = 0, mode = 'home', editing = null;

  function drawRows() {
    var html = '';
    for (var i = 0; i < rows.length; i++)
      html += '<li class="' + (i === sel ? 'sel' : '') + '"><span>' + rows[i].t + '</span><span class="v">' + rows[i].v() + '</span></li>';
    $('rows').innerHTML = html;
  }
  function openSettings() { mode = 'settings'; sel = 0; drawRows(); $('settings').className = ''; $('hint').className = 'hint fade'; }
  function closeSettings() { mode = 'home'; $('settings').className = 'hidden'; lastMin = -1; tick(); }

  function openEditor(which) {
    editing = which; mode = 'edit';
    $('edTitle').textContent = which === 'city' ? 'Your city' : 'Name for the greeting';
    $('edHint').textContent = which === 'city' ? 'For example: Detroit, London, Chennai — then press OK' : 'For example: Sam & Alex — then press OK';
    var inp = $('edInput');
    inp.value = which === 'city' ? S.city : S.name;
    $('editor').className = '';
    setTimeout(function () { inp.focus(); }, 50);   // brings up the TV's on-screen keyboard
  }
  function closeEditor() {
    $('edInput').blur(); $('editor').className = 'hidden';
    if (flow) { flowNext(); return; }   // first run: on to the next question
    mode = 'settings'; drawRows();
  }

  // ---------- first run: welcome -> name -> city -> how the remote works ----------
  var flow = 0;   // 0 = not in the first run; otherwise the step that comes next
  function showWelcome(step) {
    flow = step; mode = 'welcome';
    var b = '', h = '';
    if (step === 1) {
      $('wlTitle').textContent = 'Welcome to Glass Home';
      b = '<p>A calm home screen for this TV: a big clock, the weather and forecast, and world clocks.</p>' +
          '<p>Two quick questions and you\u2019re done \u2014 all with the remote.</p><div class="wl-go">Get started</div>';
      h = 'OK  start  \u00b7  Back  skip';
    } else {
      $('wlTitle').textContent = S.name ? 'All set, ' + S.name : 'All set';
      b = '<div class="wl-row"><span class="key">OK</span>Settings: city, name, clock, \u00b0F/\u00b0C, world clocks, background</div>' +
          '<div class="wl-row"><span class="key">\u25B2\u25BC</span>Choose a setting, then OK to change it</div>' +
          '<div class="wl-row"><span class="key">Back</span>Close settings \u2014 or, on the home screen, leave Glass Home</div>' +
          '<p style="margin-top:2.6rem">On Fire TV and Google TV, Glass Home does much more: widgets, your photos, a phone remote. Settings stay on this TV.</p>' +
          '<div class="wl-go">Start</div>';
      h = 'OK  start';
    }
    $('wlBody').innerHTML = b; $('wlHint').textContent = h;
    $('welcome').className = '';
  }
  function flowNext() {
    if (flow === 1) { flow = 2; $('welcome').className = 'hidden'; openEditor('name'); return; }
    if (flow === 2) { flow = 3; openEditor('city'); return; }
    if (flow === 3) { showWelcome(3); flow = 4; return; }
    endWelcome();
  }
  function endWelcome() {
    flow = 0; S.welcomed = true; save();
    $('welcome').className = 'hidden'; mode = 'home'; lastMin = -1; tick();
  }
  function submitEditor() {
    var v = $('edInput').value.replace(/^\s+|\s+$/g, '');
    if (editing === 'name') { S.name = v.slice(0, 40); save(); closeEditor(); return; }
    if (!v) { S.city = ''; S.lat = S.lon = null; save(); refreshWeather(); closeEditor(); return; }
    $('edHint').textContent = 'Looking up ' + v + '…';
    findCity(v, function (ok) {
      if (!ok) { $('edHint').textContent = 'Couldn’t find "' + v + '". Try another spelling.'; return; }
      refreshWeather(); closeEditor();
    });
  }

  // ---------- remote control ----------
  var BACK = { 461: 1, 10009: 1, 8: 1, 27: 1 };   // webOS Back, Tizen Back, Backspace, Esc
  function exitApp() {
    try { if (window.tizen) { tizen.application.getCurrentApplication().exit(); return; } } catch (e) { }
    try { window.close(); } catch (e) { }
  }
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (mode === 'welcome') {
      e.preventDefault();
      if (k === 13) flowNext();
      else if (BACK[k]) endWelcome();
      return;
    }
    if (mode === 'edit') {
      if (k === 13 || k === 65376) { e.preventDefault(); submitEditor(); }        // OK / keyboard "Done"
      else if (k === 461 || k === 10009 || k === 27 || k === 65385) { e.preventDefault(); closeEditor(); }
      return;   // let the on-screen keyboard type
    }
    if (mode === 'settings') {
      if (k === 38) sel = (sel + rows.length - 1) % rows.length;
      else if (k === 40) sel = (sel + 1) % rows.length;
      else if (k === 13 || k === 39) {
        var r = rows[sel];
        if (r.edit) { openEditor(r.edit); return; }
        r.act(); save(); lastMin = -1;
      } else if (BACK[k] || k === 37) { e.preventDefault(); closeSettings(); return; }
      drawRows();
      e.preventDefault();
      return;
    }
    if (k === 13 || k === 38 || k === 40 || k === 37 || k === 39) { e.preventDefault(); openSettings(); }
    else if (BACK[k]) { e.preventDefault(); exitApp(); }
  });

  // Mouse/Magic Remote pointer (LG): clicking anywhere opens settings, clicking a row picks it.
  document.addEventListener('click', function (e) {
    if (mode === 'welcome') { flowNext(); return; }
    if (mode === 'edit') return;
    if (mode === 'home') { openSettings(); return; }
    if (mode !== 'settings') return;
    var li = e.target; while (li && li.tagName !== 'LI') li = li.parentNode;
    if (!li) { closeSettings(); return; }
    var items = $('rows').children;
    for (var i = 0; i < items.length; i++) if (items[i] === li) sel = i;
    var r = rows[sel];
    if (r.edit) openEditor(r.edit); else { r.act(); save(); lastMin = -1; drawRows(); }
  });

  // ---------- start ----------
  setTimeout(function () { $('hint').className = 'hint fade'; }, 8000);
  if (!S.welcomed) showWelcome(1);
  tick();
  refreshWeather();
  setInterval(refreshWeather, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { lastMin = -1; refreshWeather(); } });
})();
