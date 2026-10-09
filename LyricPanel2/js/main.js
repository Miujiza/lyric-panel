// Lyric Panel v2: the lyrics and their timing come from lrclib.net; building, fades, SRT saving and export are v1's.
// Loaded by the installed panel from the dev folder (DEV, req are globals set by the loader).
(function () {
  var fs = req('fs'), path = req('path'), cp = req('child_process');
  if (!window.LRC) (0, eval)(fs.readFileSync(DEV + '/js/lrc.js', 'utf8'));
  var TMP = DEV + '/_tmp';
  if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);
  var DATA = path.join(process.env.APPDATA || TMP, 'LyricPanel');   // shared with v1: same settings, same batch
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);
  var LOG = TMP + '/panel_log.txt';
  var F = 10594584000;          // ticks per frame at 23.976
  var FPS_N = 24000, FPS_D = 1001, FPS = FPS_N / FPS_D;
  var CAPTION_BIAS = 1;         // Premiere 23.3 puts an imported SRT cue one frame earlier than its time
  var callNo = 0, busy = false;

  var DEFAULTS = {
    lyricsTemplate: '', mainTemplate: '', bgTrack: 0, lyricTrack: 1, bgBin: 'Backgrounds', gap: 20,
    font: 'DK Midnight Chalker', size: 115, maxWidth: 72, caps: true,
    lift: 19, perRow: 5.5, bgNext: 0, songsDir: '', songsDir2: '', overlay: '', overlayTrack: 2
  };
  var videoItems = [];          // video files in the project, for the overlay picker
  var PREVIEW_LINE = 'Long lyrics wrap onto two rows';
  var fontNames = [];           // installed fonts, filled by loadFontList
  var settings = JSON.parse(JSON.stringify(DEFAULTS));
  var project = null;           // result of host('info')
  var songs = [];               // scanned folder
  var batches = [];             // every batch built in this project that still exists
  var batch = null;             // the batch currently shown (export / re-position / build target)
  var menuIds = {};             // Premiere menu command ids, read once per build
  var NAME = 'Lyric Panel';

  // ---------- look ----------
  var ICON = {
    folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v8.8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
    inout: '<svg viewBox="0 0 24 24"><path d="M7 5H5v14h2M17 5h2v14h-2M9.5 12h5M12.5 9.5L15 12l-2.5 2.5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };
  var css = [
    '*{box-sizing:border-box}',
    'html,body{height:100%}',
    'body{margin:0;background:#1d1d1f;color:#c9c9cd;font:12px/1.4 "Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;user-select:none}',
    'svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;display:block}',
    '.tabs{display:flex;align-items:stretch;background:#262628;border-bottom:1px solid #111}',
    '.tabs button{background:none;border:0;border-right:1px solid #1a1a1c;color:#8d8d93;font:600 10.5px "Segoe UI",sans-serif;letter-spacing:.12em;padding:10px 14px;cursor:pointer}',
    '.tabs button:hover{color:#d6d6da}',
    '.tabs button.on{color:#fff;box-shadow:inset 0 -2px 0 #1aa3ff}',
    '.proj{margin-left:auto;align-self:center;padding:0 12px;color:#6f6f76;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    'section{display:none;flex:1;min-height:0;flex-direction:column;padding:12px;overflow:auto}',
    'section.on{display:flex}',
    '.card{background:#262628;border:1px solid #303033;border-radius:8px;padding:10px 12px;margin-bottom:10px}',
    '.card h3{margin:0 0 8px;font:600 10.5px "Segoe UI",sans-serif;letter-spacing:.1em;color:#7f7f86;text-transform:uppercase}',
    '.row{display:flex;align-items:center;gap:8px;margin:6px 0;min-height:28px}',
    '.row>label{flex:0 0 118px;color:#a2a2a8}',
    '.row>.grow{flex:1;min-width:0;display:flex;align-items:center;gap:8px}',
    'select,input[type=text],input[type=number]{background:#19191b;border:1px solid #38383c;border-radius:5px;color:#e6e6ea;font:12px "Segoe UI",sans-serif;height:28px;padding:0 8px;min-width:0;outline:0}',
    'select{flex:1}',
    'input[type=text]{flex:1}',
    'input[type=number]{width:62px}',
    'select:focus,input:focus{border-color:#1aa3ff}',
    'input[type=range]{flex:1;accent-color:#1aa3ff;min-width:60px}',
    'input[type=checkbox]{accent-color:#1aa3ff;width:15px;height:15px;margin:0}',
    '.path{flex:1;min-width:0;display:flex;align-items:center;background:#19191b;border:1px solid #38383c;border-radius:5px;height:30px;cursor:pointer}',
    '.path:hover{border-color:#55555b}',
    '.path span{flex:1;padding:0 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e6e6ea}',
    '.path span.empty{color:#74747b}',
    '.path i{display:flex;align-items:center;padding:0 9px;height:100%;border-left:1px solid #38383c;color:#9a9aa1}',
    'button.btn{background:#323236;border:1px solid #434348;border-radius:5px;color:#e6e6ea;font:12px "Segoe UI",sans-serif;height:28px;padding:0 12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}',
    'button.btn:hover{background:#3b3b40}',
    'button.btn.small{height:24px;padding:0 8px;font-size:11px}',
    'button.btn.primary{background:#1aa3ff;border-color:#1aa3ff;color:#04131f;font-weight:600;height:34px;padding:0 18px}',
    'button.btn.primary:hover{background:#45b4ff}',
    'button:disabled{opacity:.4;cursor:default;pointer-events:none}',
    '.listhead{display:flex;align-items:center;gap:8px;margin:2px 0 6px;color:#8d8d93}',
    '.listhead b{color:#e6e6ea;font-weight:600}',
    '.listhead .sp{flex:1}',
    '.list{flex:1;min-height:90px;overflow:auto;background:#19191b;border:1px solid #303033;border-radius:8px}',
    '.song{display:flex;align-items:center;gap:9px;padding:7px 10px;border-bottom:1px solid #242427}',
    '.song:last-child{border-bottom:0}',
    '.song .name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e0e0e4}',
    '.song.off .name{color:#6f6f76}',
    '.song .meta{color:#74747b;font-size:11px;white-space:nowrap}',
    '.chip{font:600 10px "Segoe UI",sans-serif;letter-spacing:.04em;padding:2px 7px;border-radius:10px;white-space:nowrap}',
    '.chip.ok{background:#12351f;color:#5fd38a}',
    '.chip.warn{background:#3a2e10;color:#e9b949}',
    '.chip.bad{background:#3b1717;color:#f08080}',
    '.chip.in{background:#10304a;color:#6cc2ff}',
    '.empty{padding:26px 14px;text-align:center;color:#6f6f76}',
    '.foot{padding-top:10px;display:flex;align-items:center;gap:12px}',
    '.foot .stat{flex:1;min-width:0}',
    '.foot .msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#a2a2a8}',
    '.bar{height:4px;background:#2c2c30;border-radius:2px;margin-top:6px;overflow:hidden}',
    '.bar i{display:block;height:100%;width:0;background:#1aa3ff;transition:width .25s}',
    '.banner{display:none;background:#3a2e10;color:#f0cf7a;border-radius:6px;padding:7px 10px;margin-bottom:10px}',
    '.banner.on{display:block}',
    '.notice{display:none;background:#2b2b2f;border:1px solid #4a4326;border-radius:6px;padding:7px 10px;margin:2px 0 8px;color:#e9c96a;align-items:center;gap:10px}',
    '.notice.on{display:flex}',
    '.notice div{flex:1;min-width:0}',
    '.notice p{margin:2px 0}',
    '.chip[data-open]{cursor:pointer}',
    'button.btn.done{background:#12351f;border-color:#1f5a35;color:#5fd38a}',
    '.result{display:none;margin:10px 0 0}',
    '.result.on{display:block}',
    '.result .line{display:flex;gap:8px;align-items:flex-start;margin:3px 0}',
    '.result .line svg{flex:0 0 16px;margin-top:1px}',
    '.result .good{color:#5fd38a}',
    '.result .bad{color:#f08080}',
    '.hint{color:#74747b;font-size:11px;margin:2px 0 0}',
    '.val{flex:0 0 44px;text-align:right;color:#e6e6ea;font-variant-numeric:tabular-nums}',
    '.badge{font-size:11px;white-space:nowrap}',
    '.card h3.lockhead{display:flex;align-items:center}',
    '.lock{margin-left:auto;display:flex;align-items:center;gap:6px;color:#a2a2a8;letter-spacing:0;text-transform:none;font-weight:400;font-size:11.5px;cursor:pointer}',
    '.locked{opacity:.45;pointer-events:none}',
    '#wrapPrev{display:block;width:100%;border:1px solid #38383c;border-radius:5px;margin:8px 0 6px}',
    'pre{margin:0;white-space:pre-wrap;word-break:break-all;font:11px/1.45 Consolas,monospace;color:#a2a2a8;user-select:text}'
  ].join('\n');

  function row(label, inner) { return '<div class="row"><label>' + label + '</label><div class="grow">' + inner + '</div></div>'; }
  function slider(id, min, max, step, unit) {
    return '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '"><span class="val" id="' + id + 'V" data-unit="' + unit + '"></span>';
  }

  document.head.insertAdjacentHTML('beforeend', '<style>' + css + '</style>');
  document.body.innerHTML =
    '<div class="tabs">' +
      '<button data-tab="build" class="on">BUILD</button><button data-tab="settings">SETTINGS</button>' +
      '<button data-tab="export">EXPORT</button><button data-tab="log">LOG</button>' +
      '<span class="proj" id="proj"></span>' +
    '</div>' +

    '<section id="tab-build" class="on">' +
      '<div class="banner" id="banner">Building. Please don\'t click in Premiere until this finishes.</div>' +
      '<div class="row" style="margin-top:0"><label>Songs folder</label><div class="path" id="pickSongs" title="Click to browse"><span id="songsPath" class="empty">Choose a folder</span><i>' + ICON.folder + '</i></div></div>' +
      '<div class="notice" id="notice"></div>' +
      '<div class="listhead"><b id="songCount">No folder chosen</b><span class="sp"></span>' +
        '<button class="btn small" id="selAll">All</button><button class="btn small" id="selNone">None</button>' +
        '<button class="btn small" id="rescan" title="Scan the folder again">' + ICON.refresh + '</button></div>' +
      '<div class="list" id="songs"><div class="empty">Pick the folder that holds your mp3 files.</div></div>' +
      '<div class="result card" id="result"></div>' +
      '<div class="foot"><div class="stat"><div class="msg" id="status">Ready</div><div class="bar"><i id="barFill"></i></div></div>' +
        '<button class="btn primary" id="build">' + ICON.play + 'Build</button></div>' +
    '</section>' +

    '<section id="tab-settings">' +
      '<div class="card"><h3>Templates</h3>' +
        row('Lyrics template', '<select id="lyricsTemplate"></select>') +
        row('Main template', '<select id="mainTemplate"></select>') +
        '<p class="hint">Guides only. Each batch is built in fresh copies, so your templates are never changed.</p>' +
      '</div>' +
      '<div class="card"><h3>Main sequence tracks</h3>' +
        row('Backgrounds on', '<select id="bgTrack"></select>') +
        row('Lyrics on', '<select id="lyricTrack"></select>') +
        row('Overlay on', '<select id="overlayTrack"></select>') +
        '<p class="hint">Where each layer goes in the main sequence. In the lyrics sequence the lyrics are always on V1 and the songs on A1.</p>' +
      '</div>' +
      '<div class="card"><h3>Backgrounds and overlay</h3>' +
        row('Backgrounds bin', '<select id="bgBin"></select><span class="badge" id="bgCount"></span>') +
        row('Next background', '<input type="number" id="bgNext" min="1" step="1"><span class="hint" style="margin:0">continues from the last batch</span>') +
        row('Overlay video', '<select id="overlay"></select>') +
        '<p class="hint">The overlay is added over every song and cut to the song length. If a template already contains this video, its blend mode, opacity and scale are copied.</p>' +
      '</div>' +
      '<div class="card"><h3>Songs</h3>' +
        row('Gap between songs', '<input type="number" id="gap" min="0" step="1"><span>seconds</span>') +
      '</div>' +
      '<div class="card"><h3 class="lockhead">Lyric text<label class="lock" title="Set once per channel. Tick to change it."><input type="checkbox" id="textEdit">Edit</label></h3>' +
        '<div id="textBody">' +
          row('Font', '<select id="font"></select><span class="badge" id="fontOk"></span>') +
          row('Size', '<input type="number" id="size" min="10" step="1"><span style="margin-left:10px">All caps</span><input type="checkbox" id="caps">') +
          row('Max row width', slider('maxWidth', 40, 95, 1, '%')) +
        '</div>' +
        '<canvas id="wrapPrev" width="480" height="270"></canvas>' +
        '<p class="hint">The picture is the video frame. A row of lyrics never goes past the two blue lines; a longer lyric wraps onto a second row, and one that needs more than two rows becomes two screens. No words are ever cut. Set once per channel to match its text style. Changing these does not alter a batch that is already built.</p>' +
      '</div>' +
    '</section>' +

    '<section id="tab-export">' +
      '<div class="row" style="margin-top:0"><label>Save videos to</label><div class="path" id="pickExport" title="Click to browse"><span id="exportPath"></span><i>' + ICON.folder + '</i></div></div>' +
      row('Quality', '<select id="exportPreset"></select>') +
      '<div class="row"><label>Save SRTs to</label><div class="path" id="pickSrt" title="Click to browse"><span id="srtPath"></span><i>' + ICON.folder + '</i></div></div>' +
      '<div class="listhead"><b id="exportTitle">No batch built yet</b><span class="sp"></span>' +
        '<button class="btn small" id="exAll">All</button><button class="btn small" id="exNone">None</button></div>' +
      '<div class="list" id="exportList"><div class="empty">Build a batch first. Each song will appear here with its range in the main sequence.</div></div>' +
      '<div style="display:flex;gap:8px;padding-top:10px">' +
        '<button class="btn" id="addFades" title="Puts a 6-frame fade in and a 6-frame fade out on every lyric, measured from where each lyric really starts and ends. Click it again after you trim a lyric.">Add fades</button>' +
        '<button class="btn" id="saveSrts" title="Writes the lyrics as they are now on the timeline (your corrected timing and text) to one SRT per song.">Save SRTs</button></div>' +
      '<div class="foot"><div class="stat"><div class="msg" id="exStatus">Exports straight from Premiere, one song after another.</div><div class="bar"><i id="exBar"></i></div></div>' +
        '<button class="btn primary" id="exportAll">Export</button></div>' +
    '</section>' +

    '<section id="tab-log"><pre id="log"></pre></section>';

  var $ = function (id) { return document.getElementById(id); };

  // ---------- small helpers ----------
  function log(s) {
    var line = new Date().toTimeString().slice(0, 8) + ' ' + s;
    $('log').textContent += line + '\n';
    try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {}
  }
  function status(msg, fraction) {
    $('status').textContent = msg;
    if (fraction !== undefined) $('barFill').style.width = Math.round(fraction * 100) + '%';
    log('[status] ' + msg);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fwd(p) { return String(p).replace(/\\/g, '/'); }
  function clock(frames) {
    var s = Math.round(frames / FPS), m = Math.floor(s / 60);
    return m + ':' + ('0' + (s % 60)).slice(-2);
  }
  function natural(x, y) { return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }); }

  // ---------- bridges ----------
  function host(fn, args, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = ++callNo, a = TMP + '/args_' + id + '.json', r = TMP + '/res_' + id + '.json', done = false;
      fs.writeFileSync(a, JSON.stringify(args || {}), 'utf8');
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error('Premiere did not answer (' + fn + '). A dialog may be open in Premiere.')); }
      }, timeoutMs || 120000);
      var script = '$.evalFile("' + DEV + '/jsx/host.jsx"); lpRun("' + fn + '","' + a + '","' + r + '")';
      window.__adobe_cep__.evalScript(script, function () {
        if (done) return;
        done = true; clearTimeout(timer);
        try {
          var res = JSON.parse(fs.readFileSync(r, 'utf8').replace(/^﻿/, ''));
          fs.unlinkSync(a); fs.unlinkSync(r);
          if (res.ok) resolve(res.data); else reject(new Error(fn + ': ' + res.error + ' (line ' + res.line + ')'));
        } catch (e) { reject(new Error(fn + ': bad result file: ' + e)); }
      });
    });
  }
  function menu(mode, items) {
    return new Promise(function (resolve) {
      var args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DEV + '/bin/menu_tool.ps1', '-Mode', mode];
      if (items) args.push('-Items', String(items));
      cp.execFile('powershell', args, { maxBuffer: 20 * 1024 * 1024 }, function (err, out, errOut) {
        resolve((out || '') + (errOut ? '\nSTDERR ' + errOut : '') + (err && !out ? '\nERR ' + err : ''));
      });
    });
  }
  function pickFolder(title, start) {
    var open = window.cep.fs.showOpenDialogEx || window.cep.fs.showOpenDialog;
    var r = open.call(window.cep.fs, false, true, title, start || '');
    return (r && r.err === 0 && r.data && r.data.length) ? fwd(r.data[0]) : null;
  }

  // ---------- settings ----------
  function projectKey() { return project ? project.project.replace(/\.prproj$/i, '') : '_default'; }
  function settingsFile() { return path.join(DATA, projectKey() + '.json'); }
  function loadSettings() {
    settings = JSON.parse(JSON.stringify(DEFAULTS));
    settings.textSet = false;
    // a copy of a project ("Rock Tunes_1") starts from its channel's settings ("Rock Tunes"), and the other way round
    var base = projectKey().replace(/[_ ]\d+$/, ''), files = [settingsFile(), path.join(DATA, base + '.json')], i;
    try {
      fs.readdirSync(DATA).sort(natural).forEach(function (f) {
        if (/\.json$/i.test(f) && !/\.batches\.json$/i.test(f) && f.replace(/\.json$/i, '').replace(/[_ ]\d+$/, '') === base) files.push(path.join(DATA, f));
      });
    } catch (e) {}
    for (i = 0; i < files.length; i++) {
      try {
        var saved = JSON.parse(fs.readFileSync(files[i], 'utf8'));
        Object.keys(saved).forEach(function (k) { settings[k] = saved[k]; });
        if (saved.textSet === undefined) settings.textSet = !!saved.font; // files saved before textSet existed
        if (files[i] !== settingsFile()) log('settings for ' + projectKey() + ' taken from ' + path.basename(files[i]));
        break;
      } catch (e) {}
    }
  }
  function saveSettings() { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 1), 'utf8'); } catch (e) { log('could not save settings: ' + e); } }

  function fillSelect(id, options, value) {
    $(id).innerHTML = options.map(function (o) { return '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>'; }).join('');
    $(id).value = String(value);
    if ($(id).selectedIndex < 0 && options.length) $(id).selectedIndex = 0;
  }
  function showSliders() {
    ['maxWidth'].forEach(function (id) { $(id + 'V').textContent = $(id).value + $(id + 'V').dataset.unit; });
  }
  function checkFont() {
    var name = $('font').value.trim(), ok = fontReady(name, 100);
    $('fontOk').textContent = !name ? '' : ok ? 'installed' : 'not found';
    $('fontOk').style.color = ok ? '#5fd38a' : '#f08080';
  }
  // Every font installed in Windows; the saved one is kept in the list even if it has gone missing.
  function fillFonts() {
    var opts = fontNames.map(function (n) { return { v: n, t: n }; });
    if (settings.textSet && fontNames.indexOf(settings.font) < 0) opts.unshift({ v: settings.font, t: settings.font });
    if (!settings.textSet) opts.unshift({ v: '', t: 'Choose a font' });
    fillSelect('font', opts, settings.textSet ? settings.font : '');
  }
  function setTextLock(locked) {
    $('textEdit').checked = !locked;
    $('textBody').className = locked ? 'locked' : '';
    ['font', 'size', 'caps', 'maxWidth'].forEach(function (id) { $(id).disabled = locked; });
  }
  // Draws the frame with the widest allowed row and a sample line wrapped the way a build would wrap it.
  function drawPreview() {
    var c = $('wrapPrev'), g = c.getContext('2d'), W = c.width, H = c.height;
    var tpl = (project ? project.sequences : []).filter(function (q) { return q.name === $('lyricsTemplate').value; })[0];
    var fw = tpl ? tpl.w : 1920, k = W / fw;
    var font = $('font').value, size = parseFloat($('size').value) || 0, caps = $('caps').checked, pct = parseFloat($('maxWidth').value) || 72;
    var half = W * pct / 200;
    g.fillStyle = '#0c0c0e'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1d1d21'; g.fillRect(W / 2 - half, 0, half * 2, H);
    g.strokeStyle = '#1aa3ff'; g.lineWidth = 1; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(W / 2 - half, 0); g.lineTo(W / 2 - half, H); g.moveTo(W / 2 + half, 0); g.lineTo(W / 2 + half, H); g.stroke();
    g.setLineDash([]);
    if (!font || !size) return;
    ctx.font = size + 'px "' + font + '", sans-serif';
    var rows = fitRows(PREVIEW_LINE, function (t) { return ctx.measureText(caps ? t.toUpperCase() : t).width; }, fw * pct / 100).slice(0, 2);
    g.font = (size * k) + 'px "' + font + '", sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    rows.forEach(function (r, i) { g.fillText(caps ? r.toUpperCase() : r, W / 2, H / 2 + (i - (rows.length - 1) / 2) * size * k * 1.2); });
  }
  async function refreshBgCount() {
    try {
      var r = await host('binItems', { name: $('bgBin').value });
      $('bgCount').textContent = r.found ? r.items.length + ' items' : 'bin not found';
      $('bgNext').max = Math.max(1, r.items.length);
    } catch (e) { $('bgCount').textContent = ''; }
  }
  function renderSettings() {
    var seqs = project ? project.sequences : [];
    seqs = seqs.filter(function (s) { return !/^(Batch \d|ZZ |Lyric Panel )/.test(s.name); });
    var opts = seqs.map(function (q) { return { v: q.name, t: q.name + '  (' + q.w + 'x' + q.h + ', ' + q.v + ' video tracks)' }; });
    function has(name) { return seqs.some(function (q) { return q.name === name; }); }
    if (!has(settings.lyricsTemplate)) {
      var guessL = seqs.filter(function (q) { return /^lyrics?$/i.test(q.name); })[0] || seqs.filter(function (q) { return /lyric/i.test(q.name); })[0] || seqs[0];
      settings.lyricsTemplate = guessL ? guessL.name : '';
    }
    if (!has(settings.mainTemplate)) {
      // the main sequence is usually named after the channel, like the project file
      var key = projectKey().replace(/[_ ]\d+$/, '').toLowerCase();
      var rest = seqs.filter(function (q) { return q.name !== settings.lyricsTemplate; });
      var guessM = rest.filter(function (q) { return q.name.toLowerCase() === key; })[0] || rest.filter(function (q) { return !/nest|logo|intro/i.test(q.name); })[0] || rest[0];
      settings.mainTemplate = guessM ? guessM.name : settings.lyricsTemplate;
    }
    fillSelect('lyricsTemplate', opts, settings.lyricsTemplate);
    fillSelect('mainTemplate', opts, settings.mainTemplate);
    var tpl = seqs.filter(function (q) { return q.name === $('mainTemplate').value; })[0];
    var tracks = [];
    for (var i = 0; i < (tpl ? tpl.v : 5); i++) tracks.push({ v: i, t: 'V' + (i + 1) });
    fillSelect('bgTrack', tracks, settings.bgTrack);
    fillSelect('lyricTrack', tracks, settings.lyricTrack);
    fillSelect('overlayTrack', tracks, settings.overlayTrack);
    fillSelect('overlay', [{ v: '', t: 'None' }].concat(videoItems.map(function (v) { return { v: v.path, t: v.name + (v.bin ? '  (' + v.bin + ')' : '') }; })), settings.overlay);
    fillSelect('bgBin', (project ? project.bins : []).map(function (b) { return { v: b.name, t: b.name }; }), settings.bgBin);
    $('bgNext').value = (settings.bgNext || 0) + 1;
    $('gap').value = settings.gap;
    fillFonts();
    $('size').value = settings.textSet ? settings.size : '';
    $('caps').checked = !!settings.caps;
    $('maxWidth').value = settings.maxWidth;
    setTextLock(!!settings.textSet);
    showSliders(); checkFont(); drawPreview();
    if (project) refreshBgCount();
  }
  function readSettings() {
    settings.lyricsTemplate = $('lyricsTemplate').value;
    settings.mainTemplate = $('mainTemplate').value;
    settings.bgTrack = parseInt($('bgTrack').value, 10) || 0;
    settings.lyricTrack = parseInt($('lyricTrack').value, 10) || 0;
    settings.bgBin = $('bgBin').value;
    settings.overlay = $('overlay').value;
    settings.overlayTrack = parseInt($('overlayTrack').value, 10) || 0;
    settings.bgNext = Math.max(0, (parseInt($('bgNext').value, 10) || 1) - 1);
    settings.gap = Math.max(0, parseFloat($('gap').value) || 0);
    settings.font = $('font').value.trim();
    settings.size = parseFloat($('size').value) || 0;
    settings.textSet = !!(settings.font && settings.size);
    settings.caps = $('caps').checked;
    settings.maxWidth = parseFloat($('maxWidth').value) || 72;
    saveSettings();
  }
  function loadFontList() {
    var keys = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'];
    var names = {}, left = keys.length + 1;
    function finish() {
      if (--left !== 0) return;
      fontNames = Object.keys(names).filter(function (n) { return fontReady(n, 100); }).sort(natural);
      var cur = $('font').value;
      fillFonts();
      if (cur) $('font').value = cur;
      checkFont(); drawPreview();
    }
    // the registry lists a font by its file's label, which is not always the name programs use ("BaksoSapi" for
    // "Bakso Sapi"), so Windows is also asked for the real family names
    cp.execFile('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'], { maxBuffer: 8 * 1024 * 1024 }, function (err, out) {
      (out || '').split(/\r?\n/).forEach(function (l) { if (l.trim()) names[l.trim()] = 1; });
      finish();
    });
    keys.forEach(function (k) {
      cp.execFile('reg', ['query', k], { maxBuffer: 8 * 1024 * 1024 }, function (err, out) {
        (out || '').split(/\r?\n/).forEach(function (l) {
          var m = /^\s{2,}(.+?)\s{2,}REG_SZ/.exec(l);
          if (!m) return;
          var n = m[1].replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, '').replace(/(\s+(Bold|Italic|Regular|Light|Medium|Semibold|Black|Thin|Oblique))+$/i, '');
          n.split(' & ').forEach(function (x) { names[x.trim()] = 1; names[x.trim().replace(/([a-z])([A-Z])/g, '$1 $2')] = 1; });
        });
        finish();
      });
    });
  }

  // ---------- srt + wrapping ----------
  function parseSrt(file) {
    var t = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
    var re = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/, cues = [];
    t.split(/\n\s*\n/).forEach(function (b) {
      var lines = b.split('\n').filter(function (x) { return x.trim() !== ''; }), i, m;
      for (i = 0; i < lines.length; i++) {
        m = re.exec(lines[i]);
        if (m) {
          var rows = lines.slice(i + 1).map(function (x) { return x.trim(); });
          if (rows.length) cues.push({
            start: (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000,
            end: (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000,
            rows: rows
          });
          break;
        }
      }
    });
    return cues;
  }
  function toFrame(sec) { return Math.round(sec * FPS); }
  function srtTime(frame) {
    var ms = Math.floor((frame + CAPTION_BIAS) / FPS * 1000) + 10; // 10 ms inside the frame
    var h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000), r = ms % 1000;
    function p(n, w) { return ('000' + n).slice(-w); }
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(r, 3);
  }
  var ctx = document.createElement('canvas').getContext('2d');
  function fontReady(family, size) {
    if (!family) return false;
    // installed if it changes the width against either fallback (one fallback alone misses the fallback font itself)
    return ['monospace', 'serif'].some(function (fb) {
      ctx.font = size + 'px ' + fb; var a = ctx.measureText('The quick brown fox 123').width;
      ctx.font = size + 'px "' + family + '", ' + fb; var b = ctx.measureText('The quick brown fox 123').width;
      return Math.abs(a - b) > 0.5;
    });
  }
  function makeMeasure() {
    var caps = settings.caps;
    ctx.font = settings.size + 'px "' + settings.font + '", sans-serif';
    return function (t) { return ctx.measureText(caps ? t.toUpperCase() : t).width; };
  }
  // Splits one lyric line into the fewest rows that each fit maxPx, as evenly as possible.
  function fitRows(line, measure, maxPx) {
    if (measure(line) <= maxPx) return [line];
    var words = line.split(/\s+/), n, i;
    for (n = 2; n <= 6; n++) {
      var target = Math.max(measure(line) / n * 1.08, 1), rows = [], cur = '';
      for (i = 0; i < words.length; i++) {
        var tryRow = cur ? cur + ' ' + words[i] : words[i];
        if (cur && (measure(tryRow) > maxPx || (measure(tryRow) > target && rows.length < n - 1))) { rows.push(cur); cur = words[i]; }
        else cur = tryRow;
      }
      if (cur) rows.push(cur);
      if (rows.length <= n && rows.every(function (r) { return measure(r) <= maxPx; })) return rows;
    }
    return [line];
  }
  // Turns one cue into one or more screens of at most 2 rows that fit.
  function reflowCue(cue, measure, maxPx) {
    var screens = [], cur = [];
    cue.rows.forEach(function (line) {
      var rows = fitRows(line, measure, maxPx);
      if (cur.length + rows.length <= 2) { cur = cur.concat(rows); return; }
      if (cur.length) { screens.push(cur); cur = []; }
      while (rows.length > 2) screens.push(rows.splice(0, 2));
      cur = rows;
    });
    if (cur.length) screens.push(cur);
    return screens;
  }

  // ---------- songs folder ----------
  // v2 layout: the mp3 files lie directly in the folder, each with its SRT next to it once fetched.
  var AUDIO = /\.(mp3|wav|m4a|flac|aac)$/i;
  var API = 'https://lrclib.net/api/';
  var NOTFOUND = 'Not found';   // sub-folder for songs LRCLIB has no timed lyrics for (they go through Lyric Panel v1)
  var checks = {};              // audio path -> what LRCLIB has for it, kept while the panel is open
  var checkRun = 0, checking = null;   // checking: { done, total } while the folder is being looked up
  var audioCtx = null;

  // The exact length of an audio file: it is decoded here, so no outside program is needed.
  function audioSeconds(file) {
    return new Promise(function (resolve, reject) {
      function probe() {
        cp.execFile('C:/ffmpeg/bin/ffprobe.exe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file.replace(/\//g, '\\')], function (err, out) {
          var d = parseFloat(out);
          if (d > 0) resolve(d); else reject(new Error('could not read the length of ' + path.basename(file)));
        });
      }
      try {
        var buf = fs.readFileSync(file), Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtx = audioCtx || new Ctx();
        audioCtx.decodeAudioData(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), function (a) { resolve(a.duration); }, probe);
      } catch (e) { probe(); }
    });
  }
  // null for "LRCLIB has nothing" (404); an error only when LRCLIB could not be reached
  // LRCLIB is a free service and now and then answers "busy" (503): a few patient retries before giving up
  async function getJson(url) {
    var waits = [1500, 3000, 6000], n;
    for (n = 0; ; n++) {
      try { return await getJsonOnce(url); }
      catch (e) { if (n >= waits.length) throw e; await sleep(waits[n]); }
    }
  }
  function getJsonOnce(url) {
    return new Promise(function (resolve, reject) {
      var https = null;
      try { https = req('https'); } catch (e) {}
      if (!https || !https.get) {
        fetch(url).then(function (r) { return r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error('LRCLIB answered ' + r.status)); }).then(resolve, reject);
        return;
      }
      var r = https.get(url, { headers: { 'User-Agent': 'LyricPanel v2 (Premiere Pro panel)' }, timeout: 25000 }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          if (res.statusCode === 404) return resolve(null);
          if (res.statusCode !== 200) return reject(new Error('LRCLIB answered ' + res.statusCode));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
        });
      });
      r.on('timeout', function () { r.destroy(new Error('LRCLIB did not answer')); });
      r.on('error', reject);
    });
  }
  async function searchLrclib(info) {
    var e = encodeURIComponent, seen = {}, out = [], i, list;
    var qs = ['search?track_name=' + e(info.searchTitle) + '&artist_name=' + e(info.artistFirst),
              'search?track_name=' + e(info.title) + '&artist_name=' + e(info.artistFirst),
              'search?q=' + e(info.artistFirst + ' ' + info.searchTitle)];
    qs = qs.filter(function (q, n) { return qs.indexOf(q) === n; });
    for (i = 0; i < qs.length; i++) {
      list = await getJson(API + qs[i]);
      (list || []).forEach(function (x) { if (x && !seen[x.id]) { seen[x.id] = 1; out.push(x); } });
      await sleep(300);
    }
    return out;
  }
  // What LRCLIB has for one song: the title, the artist and the length must all agree (rules in lrc.js).
  async function lookup(s) {
    var seconds = await audioSeconds(s.audio), res = null, n;
    for (n = 0; n < 2; n++) {       // "Artist - Title", then the other way round
      var info = LRC.parseName(s.name, n === 1);
      if (!info) break;
      var r = LRC.decide(info, seconds, await searchLrclib(info));
      if (!res || r.state !== 'notfound') res = r;
      if (r.state !== 'notfound') break;
    }
    res = res || { state: 'notfound', why: 'The file name is not "Artist - Title"' };
    res.seconds = seconds;
    return res;
  }
  function fetchable(s) { return !s.srt && !!s.check && (s.check.state === 'found' || s.check.state === 'scaled'); }
  function missing(s) { return !s.srt && !s.problem && !!s.check && (s.check.state === 'notfound' || s.check.state === 'lyricsonly'); }
  // Looks up every song that has no SRT yet, one after another, filling the list in as the answers arrive.
  async function checkSongs() {
    var run = ++checkRun, todo = songs.filter(function (s) { return s.audio && !s.srt && !s.check && !s.problem; }), errors = 0, i, s;
    if (!todo.length) { checking = null; return; }
    checking = { done: 0, total: todo.length };
    renderSongs();
    for (i = 0; i < todo.length; i++) {
      s = todo[i];
      try {
        s.check = errors >= 2 ? { state: 'error', why: 'LRCLIB could not be reached' } : await lookup(s);
        if (s.check.state !== 'error') { errors = 0; checks[s.audio] = s.check; }
        log('lrclib: ' + s.name + ': ' + s.check.state + (s.check.entry ? ' (entry ' + s.check.entry.id + ', ' + LRC.mmss(s.check.entry.duration) + (s.check.scale !== 1 ? ', stretched x' + s.check.scale.toFixed(3) : '') + ')' : '') + (s.check.why ? ' - ' + s.check.why : ''));
      } catch (e) {
        errors++;
        s.check = { state: 'error', why: e.message };
        log('lrclib: ' + s.name + ': ' + e.message);
      }
      if (run !== checkRun) return;   // another folder was picked meanwhile
      s.on = fetchable(s);
      checking.done = i + 1;
      renderSongs();
    }
    checking = null;
    renderSongs();
    var f = songs.filter(fetchable).length, m = songs.filter(missing).length;
    status(f + (f === 1 ? ' song has' : ' songs have') + ' timed lyrics on LRCLIB' + (m ? ', ' + m + ' not found' : '') + '.', 0);
  }
  // Writes the SRT next to every ticked song LRCLIB has, and moves the songs it does not have into "Not found".
  // A song whose lyrics are there without timing takes those lyrics along as a .txt, ready for v1.
  async function fetchSrts() {
    var root = settings.songsDir2, got = 0, moved = 0, failed = [];
    if (checking) throw fail('Still checking LRCLIB. Wait until the list is complete.');
    songs.filter(function (s) { return fetchable(s) && s.on; }).forEach(function (s) {
      try {
        var srt = LRC.toSrt(s.check.entry.syncedLyrics, s.check.scale, s.check.seconds);
        if (srt.count < 3) throw new Error('the LRCLIB entry has almost no lyrics');
        fs.writeFileSync(root + '/' + s.name + '.srt', srt.text, { encoding: 'utf8', flag: 'wx' });
        got++;
        log('fetch: ' + s.name + ': ' + srt.count + ' lyrics from entry ' + s.check.entry.id + (s.check.scale !== 1 ? ' stretched x' + s.check.scale.toFixed(3) : ''));
      } catch (e) { failed.push(s.name); log('ERROR fetch: ' + s.name + ': ' + e.message); }
    });
    var gone = songs.filter(missing);
    if (gone.length && !fs.existsSync(root + '/' + NOTFOUND)) fs.mkdirSync(root + '/' + NOTFOUND);
    gone.forEach(function (s) {
      var file = path.basename(s.audio), to = root + '/' + NOTFOUND + '/' + file;
      try {
        if (fs.existsSync(to)) throw new Error('a file of that name is already in "' + NOTFOUND + '"');
        fs.renameSync(s.audio, to);
        delete checks[s.audio];
        moved++;
        if (s.check.state === 'lyricsonly') try { fs.writeFileSync(root + '/' + NOTFOUND + '/' + s.name + '.txt', s.check.plain.replace(/\r?\n/g, '\r\n'), { encoding: 'utf8', flag: 'wx' }); } catch (e) {}
        log('fetch: ' + s.name + ': moved to "' + NOTFOUND + '" (' + (s.check.why || s.check.state) + ')');
      } catch (e) { failed.push(s.name); log('ERROR move: ' + s.name + ': ' + e.message); }
    });
    setSongsDir(root);
    if (failed.length) throw fail(got + ' SRTs fetched, ' + moved + ' songs moved to "' + NOTFOUND + '". Failed: ' + failed.join(', ') + ' (see Log).');
    status(got + (got === 1 ? ' SRT' : ' SRTs') + ' fetched' + (moved ? ', ' + moved + (moved === 1 ? ' song' : ' songs') + ' moved to "' + NOTFOUND + '"' : '') + (got ? '. Now click Build.' : '.'), 0);
  }
  // Shown only when there is something to do or to know.
  function renderNotice() {
    var lines = [];
    var f = songs.filter(fetchable).length, m = songs.filter(missing).length;
    var off = songs.filter(function (s) { return s.check && s.check.state === 'error'; }).length;
    if (checking) lines.push('Checking LRCLIB: ' + checking.done + ' of ' + checking.total + '.');
    else {
      if (f) lines.push(f + (f === 1 ? ' song has' : ' songs have') + ' timed lyrics on LRCLIB. Fetch SRTs gets them for the ticked songs.');
      if (m) lines.push(m + (m === 1 ? ' song is' : ' songs are') + ' not there with timing and ' + (f ? 'will be moved to the "' : 'can be moved to the "') + NOTFOUND + '" folder, for Lyric Panel v1.');
      if (off) lines.push('LRCLIB could not be reached for ' + off + (off === 1 ? ' song' : ' songs') + '. Check the internet connection, then click the refresh button.');
    }
    $('notice').className = lines.length ? 'notice on' : 'notice';
    $('notice').innerHTML = '<div>' + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>';
  }
  function scanSongs(root) {
    var out = [], names = fs.readdirSync(root).sort(natural), lower = {};
    names.forEach(function (n) { lower[n.toLowerCase()] = n; });
    names.forEach(function (file) {
      if (!AUDIO.test(file) || file.charAt(0) === '_' || file.charAt(0) === '.') return;
      try { if (fs.statSync(root + '/' + file).isDirectory()) return; } catch (e) { return; }
      var name = file.replace(/\.[^.]+$/, ''), s = { name: name, dir: root, audio: root + '/' + file, srt: null, cues: 0, problem: '', check: null };
      if (out.some(function (o) { return o.name.toLowerCase() === name.toLowerCase(); })) return;     // the same song as .mp3 and .wav: first one counts
      var srt = lower[(name + '.srt').toLowerCase()];
      if (srt) {
        s.srt = root + '/' + srt;
        try { s.cues = parseSrt(s.srt).length; } catch (e) { s.cues = 0; }
        if (!s.cues) s.problem = 'SRT has no lyrics';
      } else {
        s.check = checks[s.audio] || null;
        if (!LRC.parseName(name)) s.problem = 'name is not Artist - Title';
      }
      s.ready = !!(s.srt && s.cues);
      s.on = s.ready || fetchable(s);
      out.push(s);
    });
    return out;
  }
  var canBuild = false;         // a ready song that is not in the batch yet is ticked
  // The one button of the Build tab is whatever has to happen next: fetch the ticked songs' SRTs (which also moves
  // the songs LRCLIB does not have), or move those songs when there is nothing to fetch, or build.
  function nextStep() {
    if (checking) return { kind: '', label: 'Checking LRCLIB', why: 'Wait until every song has been looked up.' };
    var hasFetch = songs.some(fetchable), ticked = songs.some(function (s) { return fetchable(s) && s.on; });
    if (ticked) return { kind: 'fetch', label: 'Fetch SRTs' };
    if (songs.some(missing)) return { kind: 'fetch', label: 'Move to "' + NOTFOUND + '"' };
    if (canBuild) return { kind: 'build', label: ICON.play + 'Build' };
    if (hasFetch) return { kind: '', label: 'Fetch SRTs', why: 'Tick at least one song to fetch its SRT.' };
    return { kind: '', label: ICON.play + 'Build', why: 'Tick at least one song that is ready and not already in the batch.' };
  }
  function updateButtons() {
    var step = nextStep();
    $('build').innerHTML = step.label;
    $('build').disabled = busy || !step.kind;
    $('build').title = step.why || '';
    $('rescan').disabled = busy;
    renderActions();
  }
  // Add fades and Save SRTs show when they have been done for the batch as it is now; a build that adds songs resets them.
  function batchKey(b) { return b.songs.length + ':' + b.expected.length; }
  function renderActions() {
    var faded = !!batch && batch.fadesFor === batchKey(batch), saved = !!batch && batch.srtsFor === batchKey(batch);
    $('addFades').className = 'btn' + (faded ? ' done' : '');
    $('addFades').innerHTML = faded ? ICON.check + 'Fades added' : 'Add fades';
    $('addFades').title = faded ? 'Every lyric has its fade. Click again only after you trim a lyric.' : 'Puts a 6-frame fade in and a 6-frame fade out on every lyric, measured from where each lyric really starts and ends.';
    $('addFades').disabled = busy || !batch;
    $('saveSrts').className = 'btn' + (saved ? ' done' : '');
    $('saveSrts').innerHTML = saved ? ICON.check + 'SRTs saved' : 'Save SRTs';
    $('saveSrts').title = saved ? 'Saved to the folder above. Click again only after you change a lyric.' : 'Writes the lyrics as they are now on the timeline (your corrected timing and text) to one SRT per song.';
    $('saveSrts').disabled = busy || !batch;
  }
  function renderSongs() {
    var list = $('songs');
    if (!settings.songsDir2) return;
    renderNotice();
    if (!songs.length) { canBuild = false; updateButtons(); list.innerHTML = '<div class="empty">No songs found in this folder. The mp3 files must lie directly in it, named "Artist - Title".</div>'; $('songCount').textContent = '0 songs'; return; }
    var tb = targetBatch();
    function inB(s) { return !!(tb && tb.songs.some(function (b) { return b.name === s.name; })); }
    list.innerHTML = songs.map(function (s, i) {
      var inBatch = inB(s), c = s.check, why = c && c.why ? ' title="' + esc(c.why) + '"' : '';
      var chip = inBatch ? '<span class="chip in">IN BATCH</span>'
        : s.ready ? '<span class="chip ok">READY</span>'
        : s.problem ? '<span class="chip bad">' + esc(s.problem.toUpperCase()) + '</span>'
        : !c ? '<span class="chip in">' + (checking ? 'CHECKING' : 'NOT CHECKED') + '</span>'
        : c.state === 'found' ? '<span class="chip ok" title="Same title, artist and length on LRCLIB">ON LRCLIB</span>'
        : c.state === 'scaled' ? '<span class="chip warn" title="LRCLIB only has the normal-speed version. Its timing is stretched to fit this one: check it.">ON LRCLIB (STRETCHED)</span>'
        : c.state === 'lyricsonly' ? '<span class="chip warn"' + why + '>LYRICS ONLY</span>'
        : c.state === 'error' ? '<span class="chip bad"' + why + '>NO CONNECTION</span>'
        : '<span class="chip bad"' + why + '>NOT FOUND</span>';
      var can = (s.ready || fetchable(s)) && !inBatch;
      return '<div class="song' + (s.on ? '' : ' off') + '"><input type="checkbox" data-i="' + i + '"' + (s.on && can ? ' checked' : '') + (can ? '' : ' disabled') + '>' +
        '<span class="name" title="' + esc(s.name) + '">' + esc(s.name) + '</span>' +
        '<span class="meta">' + (s.cues ? s.cues + ' lyrics' : '') + '</span>' + chip + '</div>';
    }).join('');
    var ready = songs.filter(function (s) { return s.ready; }).length, on = songs.filter(function (s) { return s.on && !inB(s); }).length;
    canBuild = songs.some(function (s) { return s.on && s.ready && !inB(s); });
    updateButtons();
    $('songCount').textContent = on + ' of ' + songs.length + ' selected' + (ready < songs.length ? '  (' + (songs.length - ready) + ' without an SRT)' : '');
  }
  function setSongsDir(dir) {
    var unticked = {};            // a rescan of the same folder keeps what the user unticked
    if (dir === settings.songsDir2) songs.forEach(function (s) { if (!s.on && (s.ready || fetchable(s))) unticked[s.name] = 1; });
    else checks = {};
    Object.keys(checks).forEach(function (k) { if (checks[k].state === 'error') delete checks[k]; });
    settings.songsDir2 = dir; saveSettings();
    $('songsPath').textContent = dir; $('songsPath').className = '';
    $('pickSongs').title = dir;
    try { songs = scanSongs(dir); } catch (e) { songs = []; log('scan failed: ' + e); }
    songs.forEach(function (s) { if (unticked[s.name]) s.on = false; });
    renderSongs();
    checkSongs().catch(function (e) { checking = null; log('ERROR check: ' + e.message); renderSongs(); });
  }

  // ---------- batches ----------
  function batchesFile() { return path.join(DATA, projectKey() + '.batches.json'); }
  function saveBatches() { try { fs.writeFileSync(batchesFile(), JSON.stringify(batches), 'utf8'); } catch (e) { log('could not save batches: ' + e); } }
  // Keeps only batches whose two sequences are still in the project, and picks up renames.
  function syncBatches() {
    var byId = {};
    (project ? project.sequences : []).forEach(function (q) { byId[q.id] = q; });
    batches = batches.filter(function (b) { return byId[b.lyricsId] && byId[b.mainId]; });
    batches.forEach(function (b) { b.lyricsName = byId[b.lyricsId].name; b.mainName = byId[b.mainId].name; });
    if (batch && batches.indexOf(batch) < 0) batch = batches.filter(function (b) { return b.mainId === batch.mainId; })[0] || null;
    if (!batch && batches.length) batch = batches[batches.length - 1];
  }
  function loadBatches() {
    try { batches = JSON.parse(fs.readFileSync(batchesFile(), 'utf8')); } catch (e) { batches = []; }
    batch = null;
    syncBatches();
  }
  // There is one batch per project: the pair of sequences with the fixed names below. It is looked up by name every time.
  function namedSeq(name) { return project ? project.sequences.filter(function (q) { return q.name === name; })[0] || null : null; }
  function targetBatch() {
    var l = namedSeq(NAME + ' Lyrics'), mn = namedSeq(NAME + ' Main');
    if (!l || !mn) return null;
    var b = batches.filter(function (x) { return x.lyricsId === l.id && x.mainId === mn.id; })[0];
    if (!b) {
      // the sequences exist but were not built in this session's records: adopt them, songs unknown
      b = { lyricsId: l.id, lyricsName: l.name, mainId: mn.id, mainName: mn.name, songs: [], expected: [] };
      batches.push(b);
    }
    return b;
  }

  // ---------- build ----------
  function fail(msg) { return new Error(msg); }

  async function build() {
    // Lyric Panel v1 shares the settings and batch files and may have built since this panel read them
    try {
      var disk = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
      if (typeof disk.bgNext === 'number' && (parseInt($('bgNext').value, 10) || 1) - 1 === settings.bgNext) { settings.bgNext = disk.bgNext; $('bgNext').value = disk.bgNext + 1; }
    } catch (e) {}
    loadBatches();
    readSettings();
    project = await host('info');
    syncBatches();
    var target = targetBatch();
    var picked = songs.filter(function (s) {
      return s.on && s.ready && !(target && target.songs.some(function (b) { return b.name === s.name; }));
    });
    if (!settings.textSet) throw fail('This channel has no lyric font and size yet. Open Settings, fill in Lyric text to match this channel\'s text style, then build again.');
    if (!fontReady(settings.font, 100)) throw fail('The font "' + settings.font + '" is not installed, so lyrics cannot be measured. Pick the channel font in Settings.');
    if (!picked.length) throw fail(target ? 'Tick at least one ready song that is not already in this batch.' : 'Tick at least one song that is ready.');
    var tpl = project.sequences.filter(function (q) { return q.name === settings.lyricsTemplate; })[0];
    var tplMain = project.sequences.filter(function (q) { return q.name === settings.mainTemplate; })[0];
    if (!tpl) throw fail('Lyrics template "' + settings.lyricsTemplate + '" is not in this project. Pick one in Settings.');
    if (!tplMain) throw fail('Main template "' + settings.mainTemplate + '" is not in this project. Pick one in Settings.');
    if (tpl.w !== tplMain.w || tpl.h !== tplMain.h) log('NOTE: lyrics template is ' + tpl.w + 'x' + tpl.h + ', main template is ' + tplMain.w + 'x' + tplMain.h);
    if (settings.bgTrack === settings.lyricTrack) throw fail('Backgrounds and lyrics are set to the same track. Change one in Settings.');
    if (settings.overlay && (settings.overlayTrack === settings.bgTrack || settings.overlayTrack === settings.lyricTrack)) throw fail('The overlay is set to the same track as the backgrounds or lyrics. Change it in Settings.');
    if (Math.max(settings.bgTrack, settings.lyricTrack, settings.overlay ? settings.overlayTrack : 0) >= tplMain.v) throw fail('The main template has only ' + tplMain.v + ' video tracks. Pick lower tracks in Settings or add tracks to that template.');
    if (String(tpl.timebase) !== String(F) || String(tplMain.timebase) !== String(F)) log('WARNING: a template is not 23.976 fps');
    if (!fontReady(settings.font, settings.size)) log('WARNING: font "' + settings.font + '" not found by the panel; row widths are a guess');

    var bins = await host('binItems', { name: settings.bgBin });
    var bgs = bins.items.sort(function (x, y) { return natural(x.name, y.name); });
    if (!bgs.length) log('WARNING: no backgrounds in bin "' + settings.bgBin + '"');

    var now = new Date(), stamp = ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2) + ' ' + now.toTimeString().slice(0, 8).replace(/:/g, '');
    var steps = picked.length * 2 + 6, step = 0;
    function tick(msg) { status(msg, ++step / steps); }
    function idx(t, i) { return i; }
    var gapFrames = Math.round(settings.gap * FPS), i, s, b;

    // 1. the two sequences: fresh copies of the templates, or the batch being added to
    if (target) {
      tick('Adding to ' + target.mainName);
      b = target;
    } else {
      tick('Creating the sequences');
      var names = { lyrics: NAME + ' Lyrics', main: NAME + ' Main' };
      if (namedSeq(names.lyrics) || namedSeq(names.main)) throw fail('Only one of "' + names.lyrics + '" and "' + names.main + '" exists. Delete or rename it, then build again.');
      var lyrNew = await host('cloneSequence', { name: settings.lyricsTemplate, newName: names.lyrics });
      var lb = await host('report', { seqId: lyrNew.id });
      await host('clearTracks', { seqId: lyrNew.id, video: lb.video.map(idx), audio: lb.audio.map(idx) });
      var mainNew = await host('cloneSequence', { name: settings.mainTemplate, newName: names.main });
      var mb = await host('report', { seqId: mainNew.id });
      await host('clearTracks', { seqId: mainNew.id, video: mb.video.map(idx), audio: mb.audio.map(idx) });
      b = { lyricsId: lyrNew.id, lyricsName: lyrNew.name, mainId: mainNew.id, mainName: mainNew.name, songs: [], expected: [] };
    }
    var lyr = { id: b.lyricsId, name: b.lyricsName }, main = { id: b.mainId, name: b.mainName };
    var lrep = await host('report', { seqId: lyr.id });
    var endFrames = Math.ceil(Number(lrep.end) / F);
    var cursor = endFrames > 0 ? endFrames + gapFrames : 0;

    // 2. song audio in the lyrics sequence
    var imp = await host('ensureImported', { paths: picked.map(function (p) { return p.audio; }), bin: NAME }, 600000);
    var lost = imp.items.filter(function (it) { return !it.found; });
    if (lost.length) throw fail('Premiere could not import: ' + lost.map(function (it) { return path.basename(it.path); }).join(', '));
    for (i = 0; i < picked.length; i++) {
      s = picked[i];
      tick('Placing audio ' + (i + 1) + ' of ' + picked.length);
      var au = await host('placeAudio', { seqId: lyr.id, path: s.audio, startTicks: cursor * F, track: 0 });
      s.startFrame = cursor;
      s.audioFrames = Math.floor((Number(au.end) - Number(au.start)) / F);
      cursor += s.audioFrames + gapFrames;
    }

    // 3. one combined SRT for the new songs, re-wrapped for this channel's font
    tick('Preparing lyrics');
    var measure = makeMeasure(), maxPx = tpl.w * settings.maxWidth / 100;
    var lines = [], n = 0, added = [], split = 0, rewrapped = 0;
    picked.forEach(function (song) {
      var prevEnd = 0; song.lyricCount = 0;
      parseSrt(song.srt).forEach(function (c) {
        var sf = Math.max(toFrame(c.start), prevEnd), ef = Math.min(toFrame(c.end), song.audioFrames);
        if (sf > song.audioFrames - 2) return;
        if (ef - sf < 2) ef = sf + 2;
        prevEnd = ef;
        var screens = reflowCue(c, measure, maxPx);
        if (screens.length > 1) split++;
        else if (screens[0].join('\n') !== c.rows.join('\n')) rewrapped++;
        var total = screens.reduce(function (a, r) { return a + r.join(' ').length; }, 0), at = sf;
        screens.forEach(function (rows, k) {
          var len = rows.join(' ').length;
          var to = (k === screens.length - 1) ? ef : Math.max(at + 12, Math.round(at + (ef - sf) * len / total));
          if (to > ef) to = ef;
          if (to - at < 2) return;
          n++; song.lyricCount++;
          lines.push(n + '\r\n' + srtTime(song.startFrame + at) + ' --> ' + srtTime(song.startFrame + to) + '\r\n' + rows.join('\r\n') + '\r\n');
          added.push({ s: (song.startFrame + at) * F, e: (song.startFrame + to) * F, rows: rows.length });
          at = to;
        });
      });
    });
    var srtPath = fwd(path.join(DATA, 'lyrics ' + stamp + '.srt'));
    fs.writeFileSync(srtPath, '\uFEFF' + lines.join('\r\n'), 'utf8');
    log('combined SRT: ' + n + ' lyrics, re-wrapped ' + rewrapped + ', split ' + split);
    await host('ensureImported', { paths: [srtPath], bin: NAME });
    await host('createCaptions', { seqId: lyr.id, path: srtPath }, 600000);

    // 4. captions -> graphics
    tick('Converting captions to graphics');
    var landed = await upgradeCaptions(lyr, settings.lyricsTemplate);
    if (landed < 0) throw fail('Premiere did not convert the captions to graphics. Details are in the Log tab.');
    await host('removeEmptyVideoTracks', { seqId: lyr.id });
    if (menuIds['Sequence>Captions>Hide All Caption Tracks']) await menu('id', menuIds['Sequence>Captions>Hide All Caption Tracks']);

    // the batch now really contains the new songs: record it before the remaining steps
    b.expected = b.expected.concat(added);
    b.songs = b.songs.concat(picked.map(function (p) { return { name: p.name, audio: p.audio, startFrame: p.startFrame, audioFrames: p.audioFrames, lyricCount: p.lyricCount }; }));
    if (batches.indexOf(b) < 0) batches.push(b);
    batch = b;
    saveBatches();

    tick('Checking timing and positioning lyrics');
    var check = await positionLyrics(added);

    // 5. main sequence: overlay and background per new song, then the lyrics sequence nested over everything
    tick('Building the main sequence');
    var info = { bgShort: [], overlay: null, added: n, split: split };
    if (settings.overlay) {
      var ovFull = true, ovLook = false, ovNotes = [];
      for (i = 0; i < picked.length; i++) {
        s = picked[i];
        var ov = await host('placeOverlay', { seqId: main.id, path: settings.overlay, tplNames: [settings.mainTemplate, settings.lyricsTemplate], track: settings.overlayTrack, startTicks: s.startFrame * F, endTicks: (s.startFrame + s.audioFrames) * F });
        ovFull = ovFull && ov.full; ovLook = ov.lookCopied; ovNotes = ovNotes.concat(ov.notes);
      }
      info.overlay = { full: ovFull, lookCopied: ovLook };
      log('overlay on V' + (settings.overlayTrack + 1) + ': full ' + ovFull + ', look copied ' + ovLook + (ov.viaNest ? ', placed as the template nest "' + ov.viaNest + '"' : '') + (ovNotes.length ? ' [' + ovNotes.slice(0, 3).join('; ') + ']' : ''));
    }
    if (bgs.length) {
      var used = [];
      for (i = 0; i < picked.length; i++) {
        s = picked[i];
        tick('Background ' + (i + 1) + ' of ' + picked.length);
        var bgItem = bgs[(settings.bgNext + i) % bgs.length];
        var bg = await host('placeVideo', { seqId: main.id, path: bgItem.path, startTicks: s.startFrame * F, endTicks: (s.startFrame + s.audioFrames) * F, track: settings.bgTrack, scaleToFrame: true });
        if (bg.end !== bg.wantEnd) info.bgShort.push(s.name);
        used.push(bgItem.name);
      }
      log('backgrounds: ' + used.join(', '));
      settings.bgNext = (settings.bgNext + picked.length) % bgs.length;
      saveSettings(); $('bgNext').value = settings.bgNext + 1;
    } else {
      step += picked.length;
    }
    // the nest is always re-placed so it covers the songs just added; this also clears audio the layers brought along
    var mrep = await host('report', { seqId: main.id });
    await host('clearTracks', { seqId: main.id, video: [settings.lyricTrack], audio: mrep.audio.map(idx) });
    var nest = await host('placeSequence', { seqId: main.id, nestId: lyr.id, track: settings.lyricTrack, audioTrack: 0, startTicks: 0 });
    log('nest placed: form ' + nest.form + ' audio ' + JSON.stringify(nest.audioBefore) + ' -> ' + JSON.stringify(nest.audioAfter));
    info.audioOnA1 = nest.audioAfter[0] > nest.audioBefore[0];
    var lastNew = picked[picked.length - 1];
    info.nestCovers = Number(nest.end) >= (lastNew.startFrame + lastNew.audioFrames) * F;

    // 6. leave the new lyric graphics selected so the text style can be applied in one go
    await host('activate', { seqId: lyr.id });
    var sel = await host('selectTrack', { seqId: lyr.id, track: check.newTrack });
    status('Done. ' + picked.length + ' songs, ' + n + ' lyrics' + (target ? ' added.' : '.'), 1);
    project = await host('info');
    showResult(check, info, sel.selected);
    renderSongs();
    renderExport();
  }

  // Focuses the timeline, selects everything and fires Premiere's own upgrade command. Returns the track that got the graphics.
  async function upgradeCaptions(seq, otherSeqName) {
    var mid = await host('report', { seqId: seq.id });
    var before = mid.video.map(function (t) { return t.count; });
    // both timelines must be open: switching between them is what moves the focus to the timeline panel
    var other = project.sequences.filter(function (q) { return q.name === otherSeqName; })[0];
    if (other) await host('activate', { seqId: other.id });
    await host('activate', { seqId: seq.id });
    var dump = await menu('dump'), ids = {};
    dump.split(/\r?\n/).forEach(function (l) { var p = l.split('\t'); if (p.length >= 2) ids[p[0]] = p[1]; });
    menuIds = ids;
    var target = 'Window>Timelines>' + seq.name, need = [target, 'Edit>Select All', 'Graphics and Titles>Upgrade Caption to Graphic'];
    var absent = need.filter(function (k) { return !ids[k]; });
    if (absent.length) { log('menu items missing: ' + absent.join(', ')); return -1; }
    var otherKey = Object.keys(ids).filter(function (k) { return k.indexOf('Window>Timelines>') === 0 && k !== target; })[0];
    if (!otherKey) log('WARNING: no second timeline open; focus switch may fail');
    var best = -1, attempt;
    for (attempt = 1; attempt <= 3 && best < 0; attempt++) {
      var selected = 0, tries;
      for (tries = 1; tries <= 3 && !selected; tries++) {
        if (otherKey) { await menu('id', ids[otherKey]); await sleep(900); }
        await menu('id', ids[target]); await sleep(1200);
        await menu('id', ids['Edit>Select All']); await sleep(1200);
        selected = (await host('selectionCount', { seqId: seq.id })).selected;
        log('upgrade attempt ' + attempt + '.' + tries + ': ' + selected + ' clips selected');
      }
      if (!selected) continue;
      await menu('id', ids['Graphics and Titles>Upgrade Caption to Graphic']);
      var last = '', stable = 0, rep, k;
      for (k = 0; k < 90 && stable < 3; k++) {
        await sleep(2000);
        rep = await host('report', { seqId: seq.id });
        var sig = JSON.stringify(rep.video.map(function (t) { return t.count; }));
        stable = (sig === last) ? stable + 1 : 0;
        last = sig;
      }
      var gainBest = 0;
      rep.video.forEach(function (t, j) { var g = t.count - (before[j] || 0); if (g > gainBest) { gainBest = g; best = j; } });
      log('upgrade attempt ' + attempt + ': ' + gainBest + ' graphics' + (best >= 0 ? ' on V' + (best + 1) : ''));
    }
    return best;
  }

  // Compares lyrics with their expected frames and sets their vertical position.
  // only: check just these expected entries (a build); omitted: every lyric of the current batch (the sliders).
  async function positionLyrics(only) {
    var rep = await host('report', { seqId: batch.lyricsId, full: true });
    var want = only || batch.expected, byTrack = {}, miss = 0, off = 0, newTrack = -1, positioned = 0;
    want.forEach(function (x) {
      var hit = null, hitTrack = -1, d;
      for (d = 0; d <= 3 && !hit; d++) {
        rep.video.forEach(function (t, ti) {
          if (hit) return;
          var c = t.clips.filter(function (c) { return c.n === 'Graphic' && Math.abs(Number(c.s) - x.s) === d * F; })[0];
          if (c) { hit = c; hitTrack = ti; }
        });
      }
      if (!hit) { miss++; return; }
      if (Number(hit.s) !== x.s || Number(hit.e) !== x.e) off++;
      if (newTrack < 0) newTrack = hitTrack;
      (byTrack[hitTrack] = byTrack[hitTrack] || []).push({ s: hit.s, y: 0.5 - (settings.lift + (x.rows - 1) * settings.perRow) / 100 });
    });
    var tracks = Object.keys(byTrack), k;
    for (k = 0; k < tracks.length; k++) {
      var pos = await host('setLyricPosition', { seqId: batch.lyricsId, track: +tracks[k], items: byTrack[tracks[k]] });
      positioned += pos.set;
      if (pos.notes.length) log('position notes: ' + pos.notes.join('; '));
    }
    var exact = want.length - miss - off;
    log('timing check: ' + exact + ' exact, ' + off + ' off, ' + miss + ' missing | positioned ' + positioned);
    return { total: want.length, exact: exact, off: off, missing: miss, positioned: positioned, newTrack: newTrack };
  }

  function showResult(check, info, selected) {
    function line(ok, text) { return '<div class="line ' + (ok ? 'good' : 'bad') + '">' + ICON.check + '<span>' + esc(text) + '</span></div>'; }
    function note(text) { return '<div class="line"><span style="width:16px"></span><span>' + esc(text) + '</span></div>'; }
    var total = check.total, h = '<h3>Result</h3>';
    h += line(check.exact === total, check.exact === total ? 'All ' + total + ' lyrics are on the exact frame' : check.exact + ' of ' + total + ' lyrics on the exact frame (' + check.off + ' off, ' + check.missing + ' missing)');
    h += line(check.positioned === total - check.missing, check.positioned + ' lyrics positioned');
    h += line(info.audioOnA1, info.audioOnA1 ? 'Audio is on A1 in the main sequence' : 'Audio did not land on A1 in the main sequence');
    if (!info.nestCovers) h += line(false, 'The lyrics nest does not reach the end of the last song');
    if (info.bgShort.length) h += line(false, 'Background shorter than the song: ' + info.bgShort.join(', '));
    if (info.overlay) {
      h += line(info.overlay.full, info.overlay.full ? 'Overlay added to every song' : 'Overlay does not cover every song');
      if (!info.overlay.lookCopied) h += note('The overlay is not in your templates, so it was added with normal blending. Put it in the main template once, with the blend mode and opacity you want, and the next build will copy that look.');
    }
    if (info.split) h += note(info.split + ' long lyrics were split into two screens');
    h += '<p class="hint" style="margin-top:8px">' + selected + ' new lyric graphics are selected in "' + esc(batch.lyricsName) + '". Apply your text style to them, then open "' + esc(batch.mainName) + '" to review.</p>';
    $('result').innerHTML = h;
    $('result').className = 'result card on';
  }

  // ---------- centering ----------
  // Loads a PNG and returns the vertical centre of what is drawn in it, as a fraction of the height (null if empty).
  function measureCenter(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        var g = c.getContext('2d'); g.drawImage(img, 0, 0);
        var d = g.getImageData(0, 0, c.width, c.height).data, x, y, i, top = -1, bottom = -1, seeThrough = false;
        for (i = 3; i < d.length && !seeThrough; i += 4 * 97) if (d[i] < 250) seeThrough = true;
        for (y = 0; y < c.height; y++) {
          for (x = 0; x < c.width; x += 2) {
            i = (y * c.width + x) * 4;
            if (seeThrough ? d[i + 3] > 40 : (d[i] > 48 || d[i + 1] > 48 || d[i + 2] > 48)) { if (top < 0) top = y; bottom = y; break; }
          }
        }
        resolve(top < 0 ? null : { center: (top + bottom + 1) / 2 / c.height, rows: (bottom - top + 1) / c.height });
      };
      img.onerror = function () { reject(new Error('could not read the exported frame')); };
      img.src = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    });
  }
  async function frameCenter(ticks, tag) {
    var out = fwd(path.join(DATA, 'frame ' + tag + '.png')), tries;
    [out, out + '.png'].forEach(function (p) { try { fs.unlinkSync(p); } catch (e) {} });
    var r = await host('exportFrame', { seqId: batch.lyricsId, ticks: ticks, path: out }, 60000);
    for (tries = 0; tries < 40; tries++) {
      var found = [out, out + '.png'].filter(function (p) { try { return fs.statSync(p).size > 0; } catch (e) { return false; } })[0];
      if (found) { await sleep(300); return measureCenter(found); }
      await sleep(250);
    }
    throw fail('Premiere did not write the test frame (timecode ' + r.timecode + ').');
  }
  // Renders one sample lyric per row count from the lyrics sequence, measures where it sits, and shifts
  // every lyric with that row count so it lands in the middle of the frame. Works for any font or style.
  async function centerLyrics() {
    loadBatches(); project = await host('info'); syncBatches();
    batch = targetBatch();
    if (!batch) throw fail('Nothing to center yet. Build first.');
    if (!batch.expected.length) throw fail('This batch was not built by the panel in this project, so its lyrics are unknown.');
    status('Measuring lyrics', 0.2);
    var rep = await host('report', { seqId: batch.lyricsId, full: true });
    var found = [], miss = 0;
    batch.expected.forEach(function (x) {
      var hit = null, hitTrack = -1;
      rep.video.forEach(function (t, ti) {
        if (hit) return;
        var c = t.clips.filter(function (c) { return c.n === 'Graphic' && Math.abs(Number(c.s) - x.s) <= 3 * F; })[0];
        if (c) { hit = c; hitTrack = ti; }
      });
      if (hit) found.push({ s: hit.s, e: hit.e, track: hitTrack, rows: x.rows }); else miss++;
    });
    if (!found.length) throw fail('No lyric graphics were found in ' + batch.lyricsName + '.');
    var shift = {}, rowCounts = {}, k;
    found.forEach(function (f) { rowCounts[f.rows] = 1; });
    var keys = Object.keys(rowCounts);
    for (k = 0; k < keys.length; k++) {
      // the longest lyric of this row count is the safest sample (clear of any fade in or out)
      var group = found.filter(function (f) { return String(f.rows) === keys[k]; });
      var sample = group.reduce(function (a, f) { return (Number(f.e) - Number(f.s)) > (Number(a.e) - Number(a.s)) ? f : a; });
      var mid = Math.round((Number(sample.s) + Number(sample.e)) / 2 / F) * F;
      var got = await frameCenter(mid, 'rows' + keys[k]);
      if (!got) { log('center: sample for ' + keys[k] + ' rows rendered empty'); continue; }
      shift[keys[k]] = 0.5 - got.center;
      log('center: ' + keys[k] + '-row lyrics sit at ' + (got.center * 100).toFixed(1) + '% -> shift ' + (shift[keys[k]] * 100).toFixed(1) + '%');
      status('Measuring lyrics', 0.2 + 0.5 * (k + 1) / keys.length);
    }
    var byTrack = {}, moved = 0, biggest = 0;
    found.forEach(function (f) {
      var dy = shift[f.rows];
      if (dy === undefined) return;
      biggest = Math.max(biggest, Math.abs(dy));
      if (Math.abs(dy) < 0.002) return;
      (byTrack[f.track] = byTrack[f.track] || []).push({ s: f.s, dy: dy });
    });
    var tracks = Object.keys(byTrack);
    for (k = 0; k < tracks.length; k++) moved += (await host('nudgeLyrics', { seqId: batch.lyricsId, track: +tracks[k], items: byTrack[tracks[k]] })).set;
    status(moved ? 'Centered ' + moved + ' lyrics.' : 'Lyrics are already centered.', 1);
    if (miss) log('center: ' + miss + ' lyrics not found (edited by hand?)');
    await host('activate', { seqId: batch.mainId });
  }

  // ---------- export tab ----------
  var exOn = {};                // song name -> ticked on the Export tab
  var exporting = null;         // { stop } while an export run is going
  var SYS_PRESETS = [
    { v: 'sys:00 - Match Source - High bitrate.epr', t: 'H.264, same size as the sequence, high bitrate' },
    { v: 'sys:00 - Match Source - Medium bitrate.epr', t: 'H.264, same size as the sequence, medium bitrate' },
    { v: 'sys:High Quality 1080 HD.epr', t: 'H.264, High Quality 1080 HD' }
  ];
  function exportDir() {
    return settings.exportDir || (process.env.USERPROFILE || '').replace(/\\/g, '/') + '/Documents/' + projectKey().replace(/[_ ]\d+$/, '') + '/Videos';
  }
  function exportedFile(s) { return exportDir() + '/' + s.name + '.mp4'; }
  // Premiere's own presets plus any the user saved from the Export screen.
  function fillPresets() {
    var opts = SYS_PRESETS.slice(), root = (process.env.USERPROFILE || '').replace(/\\/g, '/') + '/Documents/Adobe/Adobe Media Encoder';
    try {
      fs.readdirSync(root).forEach(function (ver) {
        var dir = root + '/' + ver + '/Presets', list = [];
        try { list = fs.readdirSync(dir); } catch (e) {}
        list.filter(function (f) { return /\.epr$/i.test(f); }).sort(natural).forEach(function (f) { opts.push({ v: dir + '/' + f, t: 'My preset: ' + f.replace(/\.epr$/i, '') }); });
      });
    } catch (e) {}
    fillSelect('exportPreset', opts, settings.exportPreset || opts[0].v);
  }
  function exStatus(msg, fraction, bad) {
    $('exStatus').textContent = msg; $('exStatus').title = msg;
    $('exStatus').style.color = bad ? '#f08080' : '';
    if (fraction !== undefined) $('exBar').style.width = Math.round(fraction * 100) + '%';
    log('[export] ' + msg);
  }
  function renderExport() {
    renderActions();
    $('exportPath').textContent = exportDir();
    $('srtPath').textContent = libraryDir();
    $('exportAll').innerHTML = exporting ? (exporting.stop ? 'Stopping after this song' : 'Stop after this song') : ICON.play + 'Export';
    var anyOn = !!batch && batch.songs.some(function (s) { return exOn[s.name] === undefined ? !fs.existsSync(exportedFile(s)) : exOn[s.name]; });
    $('exportAll').disabled = exporting ? exporting.stop : !anyOn;
    $('exportAll').title = exporting || anyOn ? '' : 'Tick at least one song to export.';
    if (!batch) { $('exportTitle').textContent = 'No batch built yet'; $('exportList').innerHTML = '<div class="empty">Build a batch first. Each song will appear here with its range in the main sequence.</div>'; return; }
    var left = 0;
    $('exportList').innerHTML = batch.songs.map(function (s, i) {
      var done = false;
      try { done = fs.existsSync(exportedFile(s)); } catch (e) {}
      if (exOn[s.name] === undefined) exOn[s.name] = !done;
      if (exOn[s.name]) left++;
      return '<div class="song' + (exOn[s.name] ? '' : ' off') + '"><input type="checkbox" data-x="' + i + '"' + (exOn[s.name] ? ' checked' : '') + (exporting ? ' disabled' : '') + '>' +
        '<span class="name" title="' + esc(s.name) + '">' + esc(s.name) + '</span>' +
        '<span class="meta">' + clock(s.startFrame) + ' - ' + clock(s.startFrame + s.audioFrames) + '</span>' +
        (done ? '<span class="chip ok">EXPORTED</span>' : '') +
        '<button class="btn small" data-song="' + i + '" title="Set in and out points to this song">' + ICON.inout + 'In/Out</button></div>';
    }).join('');
    $('exportTitle').textContent = left + ' of ' + batch.songs.length + ' to export';
  }
  // One song at a time: in/out on the main sequence, export to "<Song>.part.mp4", rename when Premiere has finished.
  // A song only counts as exported once it has its final name, so after a crash the unfinished one is simply done again.
  async function exportAll() {
    loadBatches(); batch = targetBatch();
    if (!batch) throw fail('Build a batch first.');
    var dir = exportDir(), preset = $('exportPreset').value, done = 0, stopped = false, i, s, part, fin, r;
    var todo = batch.songs.filter(function (x) { return exOn[x.name]; });
    if (!todo.length) throw fail('Tick at least one song to export.');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    exporting = { stop: false };
    renderExport();
    try {
      for (i = 0; i < todo.length && !exporting.stop; i++) {
        s = todo[i]; part = dir + '/' + s.name + '.part.mp4'; fin = exportedFile(s);
        exStatus('Exporting ' + (i + 1) + ' of ' + todo.length + ': ' + s.name, i / todo.length);
        try { fs.unlinkSync(part); } catch (e) {}
        await host('setInOut', { seqId: batch.mainId, inTicks: s.startFrame * F, outTicks: (s.startFrame + s.audioFrames) * F });
        r = await host('exportDirect', { seqId: batch.mainId, out: part.replace(/\//g, '\\'), preset: preset }, 4 * 3600000);
        log('export: ' + s.name + ': Premiere answered "' + r.result + '"');
        if (!fs.existsSync(part) || fs.statSync(part).size < 10000) {
          try { fs.unlinkSync(part); } catch (e) {}
          throw fail('"' + s.name + '" was not exported (Premiere answered: ' + r.result + '). Export stopped.');
        }
        if (fs.existsSync(fin)) fs.unlinkSync(fin);
        fs.renameSync(part, fin);
        exOn[s.name] = false; done++;
        renderExport();
      }
    } finally { stopped = exporting.stop; exporting = null; renderExport(); }
    exStatus((stopped ? 'Stopped. ' : 'Done. ') + done + ' of ' + todo.length + (todo.length === 1 ? ' song' : ' songs') + ' exported to ' + dir, done / todo.length);
  }

  // ---------- save SRTs ----------
  // Premiere's scripting cannot read a graphic's text, but the saved project file holds it. So the project is saved
  // and the lyrics sequence is read from the file: every graphic's text and frames, and every song's place on the audio track.
  function unxml(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  // The text of a graphic sits in a small binary table: root -> field 0 -> field 0 = list of layers, each layer's field 0 = its text.
  function graphicText(b) {
    function follow(table, i) {   // where field i of a table points to; 0 when the field is absent
      var vt = table - b.readInt32LE(table), size = b.readUInt16LE(vt), off = 4 + 2 * i < size ? b.readUInt16LE(vt + 4 + 2 * i) : 0;
      return off ? table + off + b.readUInt32LE(table + off) : 0;
    }
    try {
      var list = follow(follow(12 + b.readUInt32LE(12), 0), 0), n = b.readUInt32LE(list), out = [], k, el, str;
      for (k = 0; k < n && k < 64; k++) {
        el = list + 4 + 4 * k; str = follow(el + b.readUInt32LE(el), 0);
        if (str) out.push(b.toString('utf8', str + 4, str + 4 + b.readUInt32LE(str)));
      }
      return out.join('\r');
    } catch (e) { return null; }
  }
  // Returns { songs: [{ name, s, e }], lyrics: [{ s, e, text }] } for one sequence, times in ticks. text is null when it could not be read.
  function readProjectLyrics(file, seqName) {
    var xml = req('zlib').gunzipSync(fs.readFileSync(file)).toString('utf8');
    var starts = [], tags = [], at = {}, re = /\n\t<([\w.]+) Object(?:U?)ID="([^"]+)"/g, m, i;
    while ((m = re.exec(xml))) { at[m[2]] = starts.length; starts.push(m.index); tags.push(m[1]); }
    function body(key) { var j = at[key]; return j === undefined ? '' : xml.slice(starts[j], j + 1 < starts.length ? starts[j + 1] : xml.length); }
    function all(text, rx) { var out = [], x; while ((x = rx.exec(text))) out.push(x[1]); return out; }
    var blobs = {}, bre = /<StartKeyframeValue [^>]*BinaryHash="([^"]+)">([^<]+)</g;   // a repeated value is stored once and referred to by its hash
    while ((m = bre.exec(xml))) blobs[m[1]] = m[2];
    function textOf(chainKey) {
      var comps = all(body(chainKey), /<Component Index="\d+" ObjectRef="(\d+)"\/>/g), c, b, p, v, h, data;
      for (c = 0; c < comps.length; c++) {
        b = body(comps[c]);
        if (b.indexOf('<MatchName>AE.ADBE Text</MatchName>') < 0) continue;
        p = /<Param Index="0" ObjectRef="(\d+)"\/>/.exec(b);
        v = p ? /<StartKeyframeValue ([^>]*?)(?:\/>|>([^<]*)<)/.exec(body(p[1])) : null;
        if (!v) return null;
        data = (v[2] || '').trim();
        if (!data) { h = /BinaryHash="([^"]+)"/.exec(v[1]); data = h ? blobs[h[1]] || '' : ''; }
        return data ? graphicText(Buffer.from(data, 'base64')) : null;
      }
      return undefined;           // not a text graphic
    }
    function items(trackKey) {
      var b = body(trackKey), from = b.indexOf('<ClipItems'), to = b.indexOf('</ClipItems>');
      return all(from < 0 ? '' : b.slice(from, to < 0 ? b.length : to), /<TrackItem Index="\d+" ObjectRef="(\d+)"\/>/g).map(function (id) {
        var t = body(id), sub = /<SubClip ObjectRef="(\d+)"\/>/.exec(t), chain = /<Components ObjectRef="(\d+)"\/>/.exec(t);
        var name = sub ? /<Name>([^<]*)<\/Name>/.exec(body(sub[1])) : null;
        return { s: Number((/<Start>(-?\d+)<\/Start>/.exec(t) || [0, 0])[1]), e: Number((/<End>(-?\d+)<\/End>/.exec(t) || [0, 0])[1]), name: name ? unxml(name[1]) : '', chain: chain ? chain[1] : null };
      });
    }
    var seq = '', nm;
    for (i = 0; i < tags.length && !seq; i++) {
      if (tags[i] !== 'Sequence') continue;
      nm = /\n\t\t<Name>([^<]*)<\/Name>/.exec(xml.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : xml.length));
      if (nm && unxml(nm[1]) === seqName) seq = xml.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : xml.length);
    }
    if (!seq) throw fail('"' + seqName + '" was not found in the saved project file.');
    var out = { songs: [], lyrics: [] };
    all(seq, /<Second ObjectRef="(\d+)"\/>/g).forEach(function (g) {
      var kind = tags[at[g]], tracks = all(body(g), /<Track Index="\d+" ObjectURef="([^"]+)"\/>/g);
      if (kind === 'AudioTrackGroup') tracks.forEach(function (t) { out.songs = out.songs.concat(items(t)); });
      if (kind !== 'VideoTrackGroup') return;
      // the lyrics are the track with the most text graphics (titles and the like on other tracks are left out)
      tracks.forEach(function (t) {
        var texts = [];
        items(t).forEach(function (it) {
          var text = it.chain ? textOf(it.chain) : undefined;
          if (text !== undefined) texts.push({ s: it.s, e: it.e, text: text });
        });
        if (texts.length > out.lyrics.length) out.lyrics = texts;
      });
    });
    function byStart(x, y) { return x.s - y.s; }
    out.songs.sort(byStart); out.lyrics.sort(byStart);
    return out;
  }
  function plainSrtTime(frame) {
    var ms = Math.round(frame / FPS * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
    function p(n, w) { return ('000' + n).slice(-w); }
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(ms % 1000, 3);
  }
  function libraryDir() { return settings.srtDir || (process.env.USERPROFILE || '').replace(/\\/g, '/') + '/Documents/Lyric Library'; }
  // Writes one SRT per song from the lyrics as they now are on the timeline, into the folder chosen on the Export tab.
  // The SRTs in the song folders are never touched.
  async function saveSrts() {
    loadBatches(); project = await host('info'); syncBatches();
    batch = targetBatch();
    if (!batch) throw fail('Build a batch first.');
    exStatus('Saving the project', 0.1);
    var saved = await host('saveProject', {}, 300000);
    exStatus('Reading the lyrics from the project', 0.4);
    await sleep(100);
    var got = readProjectLyrics(saved.path, batch.lyricsName), lib = libraryDir(), stray = 0, done = 0, skipped = [];
    if (!got.songs.length) throw fail('No songs were found on the audio track of "' + batch.lyricsName + '".');
    if (!got.lyrics.length) throw fail('No lyric graphics were found in "' + batch.lyricsName + '".');
    got.songs.forEach(function (a, i) { a.next = i + 1 < got.songs.length ? got.songs[i + 1].s : Infinity; a.cues = []; a.bad = 0; });
    got.lyrics.forEach(function (l) {
      var a = got.songs.filter(function (x) { return l.s >= x.s && l.s < x.next; })[0];
      if (!a) { stray++; return; }
      if (!l.text || !l.text.trim()) { a.bad++; return; }
      a.cues.push(l);
    });
    if (!fs.existsSync(lib)) fs.mkdirSync(lib, { recursive: true });
    got.songs.forEach(function (a) {
      var stem = a.name.replace(/\.[^.]+$/, '');
      var known = batch.songs.filter(function (b) { return b.startFrame * F === a.s; })[0] || batch.songs.filter(function (b) { return path.basename(b.audio) === a.name || b.name === stem; })[0];
      var scanned = songs.filter(function (s) { return s.audio && path.basename(s.audio) === a.name; })[0];
      var name = known ? known.name : scanned ? scanned.name : stem;
      if (a.bad || !a.cues.length) { skipped.push(name); log('save srt: ' + name + ': skipped, ' + (a.bad ? a.bad + ' lyrics could not be read' : 'no lyrics')); return; }
      var n = 0, text = a.cues.map(function (l) {
        var sf = Math.max(0, Math.round((l.s - a.s) / F)), ef = Math.round((l.e - a.s) / F);
        var rows = l.text.split(/\r\n|\r|\n/).map(function (r) { return r.trim(); }).filter(function (r) { return r; });
        return (++n) + '\r\n' + plainSrtTime(sf) + ' --> ' + plainSrtTime(Math.max(ef, sf + 1)) + '\r\n' + rows.join('\r\n') + '\r\n';
      }).join('\r\n');
      fs.writeFileSync(lib + '/' + name + '.srt', text, 'utf8');
      done++;
      log('save srt: ' + name + ': ' + n + ' lyrics');
    });
    if (stray) log('save srt: ' + stray + ' lyrics sit before the first song and were left out');
    if (done && !skipped.length) { batch.srtsFor = batchKey(batch); saveBatches(); }
    exStatus('Saved ' + done + (done === 1 ? ' SRT' : ' SRTs') + ' to ' + lib + (skipped.length ? '. Skipped: ' + skipped.join(', ') + ' (see Log)' : '.'), 1, skipped.length > 0);
  }

  // ---------- fades ----------
  // A preset cannot do the fade out: Premiere anchors it to the graphic's internal out point, which for a graphic made
  // from a caption is about 5 s after its start whatever its length on the timeline. So the keyframes are written here,
  // from each lyric's real start and end. Running it again replaces the fades (do that after trimming a lyric).
  var FADE_FRAMES = 6;
  async function addFades() {
    loadBatches(); project = await host('info'); syncBatches();
    batch = targetBatch();
    if (!batch) throw fail('Build a batch first.');
    var done = 0, skipped = 0, total = 0, from = 0, notes = [], r;
    exStatus('Adding fades', 0);
    do {                          // a few lyrics per call, so Premiere is never blocked for long
      r = await host('addFades', { seqId: batch.lyricsId, frames: FADE_FRAMES, from: from, count: 40 }, 300000);
      total = r.total; done += r.done; skipped += r.skipped; notes = notes.concat(r.notes); from += 40;
      $('exStatus').textContent = 'Adding fades: ' + Math.min(from, total) + ' of ' + total;
      $('exBar').style.width = (total ? Math.round(100 * Math.min(from, total) / total) : 100) + '%';
    } while (from < total && from < 20000);
    log('fades: ' + done + ' of ' + total + ' lyrics, ' + skipped + ' skipped, key form ' + r.form + (notes.length ? ' [' + notes.slice(0, 5).join('; ') + ']' : ''));
    if (!done) throw fail('Premiere did not accept the fades. Details are in the Log tab.');
    if (done + skipped >= total) { batch.fadesFor = batchKey(batch); saveBatches(); }
    exStatus('Fades added to ' + done + ' of ' + total + ' lyrics (' + FADE_FRAMES + ' frames in, ' + FADE_FRAMES + ' out)' + (skipped ? '; ' + skipped + ' left alone (too short or no opacity)' : '') + '.', 1, done + skipped < total);
  }

  // ---------- wiring ----------
  function run(fn) {
    return function (ev) {
      if (busy) return;
      busy = true;
      updateButtons();
      $('status').style.color = '';
      if (fn === build) { $('banner').className = 'banner on'; $('result').className = 'result card'; }
      Promise.resolve().then(function () { return fn(ev); }).catch(function (e) {
        var msg = e && e.message ? e.message : String(e);
        log('ERROR ' + msg);
        $('status').textContent = msg;
        $('status').title = msg;
        $('status').style.color = '#f08080';
      }).then(function () {
        busy = false;
        updateButtons();
        $('banner').className = 'banner';
      });
    };
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.className = x === b ? 'on' : ''; });
      Array.prototype.forEach.call(document.querySelectorAll('section'), function (x) { x.className = x.id === 'tab-' + b.dataset.tab ? 'on' : ''; });
    };
  });
  $('pickSongs').onclick = function () {
    if (busy) return;
    var d = pickFolder('Choose the folder that holds your mp3 files', settings.songsDir2);
    if (d) setSongsDir(d);
  };
  // the refresh button also asks LRCLIB again
  $('rescan').onclick = function () { if (settings.songsDir2 && !busy) { checks = {}; setSongsDir(settings.songsDir2); } };
  $('selAll').onclick = function () { songs.forEach(function (s) { s.on = s.ready || fetchable(s); }); renderSongs(); };
  $('selNone').onclick = function () { songs.forEach(function (s) { s.on = false; }); renderSongs(); };
  $('songs').onchange = function (ev) {
    var i = ev.target.dataset.i;
    if (i !== undefined) { songs[+i].on = ev.target.checked; renderSongs(); }
  };
  ['lyricsTemplate', 'mainTemplate', 'bgTrack', 'lyricTrack', 'overlay', 'overlayTrack', 'bgBin', 'bgNext', 'gap', 'font', 'size', 'caps', 'maxWidth'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      readSettings();
      if (id === 'mainTemplate') renderSettings();
      if (id === 'bgBin') refreshBgCount();
      if (id === 'font') checkFont();
      drawPreview();
    });
    $(id).addEventListener('input', function () { showSliders(); drawPreview(); });
  });
  $('textEdit').onchange = function () { setTextLock(!$('textEdit').checked); };
  $('build').onclick = function (ev) {
    var kind = nextStep().kind;
    if (kind === 'fetch') run(fetchSrts)(ev); else if (kind === 'build') run(build)(ev);
  };
  $('exportAll').onclick = function () {
    if (exporting) { exporting.stop = true; renderExport(); return; }
    if (busy) return;
    busy = true; $('build').disabled = true;
    exportAll().catch(function (e) { exStatus(e && e.message ? e.message : String(e), undefined, true); })
      .then(function () { busy = false; updateButtons(); });
  };
  $('addFades').onclick = function () {
    if (busy) return;
    busy = true; updateButtons();
    addFades().catch(function (e) { exStatus(e && e.message ? e.message : String(e), undefined, true); })
      .then(function () { busy = false; updateButtons(); });
  };
  $('saveSrts').onclick = function () {
    if (busy) return;
    busy = true; updateButtons();
    saveSrts().catch(function (e) { exStatus(e && e.message ? e.message : String(e), undefined, true); })
      .then(function () { busy = false; updateButtons(); });
  };
  $('exportList').onchange = function (ev) {
    var i = ev.target.dataset.x;
    if (i !== undefined && batch) { exOn[batch.songs[+i].name] = ev.target.checked; renderExport(); }
  };
  $('exAll').onclick = function () { if (batch && !exporting) { batch.songs.forEach(function (s) { exOn[s.name] = true; }); renderExport(); } };
  $('exNone').onclick = function () { if (batch && !exporting) { batch.songs.forEach(function (s) { exOn[s.name] = false; }); renderExport(); } };
  $('pickExport').onclick = function () {
    if (busy) return;
    var d = pickFolder('Choose the folder to save the finished videos in', exportDir());
    if (d) { settings.exportDir = d; saveSettings(); exOn = {}; renderExport(); }
  };
  $('pickSrt').onclick = function () {
    if (busy) return;
    var d = pickFolder('Choose the folder to save the SRTs in', fs.existsSync(libraryDir()) ? libraryDir() : (process.env.USERPROFILE || '').replace(/\\/g, '/') + '/Documents');
    if (d) { settings.srtDir = d; saveSettings(); renderExport(); }
  };
  $('exportPreset').onchange = function () { settings.exportPreset = $('exportPreset').value; saveSettings(); };
  $('exportList').onclick = run(async function (ev) {
    var b = ev.target.closest('button[data-song]');
    if (!b) return;
    var s = batch.songs[+b.dataset.song];
    var r = await host('setInOut', { seqId: batch.mainId, inTicks: s.startFrame * F, outTicks: (s.startFrame + s.audioFrames) * F });
    log('in/out for ' + s.name + ': form ' + r.form + ' in ' + r.inTicks + ' out ' + r.outTicks);
  });

  // ---------- start ----------
  (async function () {
    log('panel loaded');
    updateButtons();
    loadFontList();
    try {
      project = await host('info', {}, 15000);
      $('proj').textContent = projectKey();
    } catch (e) {
      $('proj').textContent = 'No project open';
      log('info failed: ' + e.message);
    }
    loadSettings();
    try { videoItems = (await host('videoItems', {}, 30000)).items.sort(function (x, y) { return natural(x.name, y.name); }); } catch (e) { log('video list failed: ' + e.message); }
    renderSettings();
    fillPresets();
    loadBatches(); batch = targetBatch(); renderExport();
    if (settings.songsDir2 && fs.existsSync(settings.songsDir2)) setSongsDir(settings.songsDir2);
  })();
})();
