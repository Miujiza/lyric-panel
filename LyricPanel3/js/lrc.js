// Lyric Panel v2: the LRCLIB rules that need no Premiere and no files (which entry is this song, entry -> SRT).
// Loaded by main.js; also runs in a plain browser page for tests.
window.LRC = (function () {
  var FPS = 24000 / 1001, FR = 1 / FPS;
  // caption rules, the same numbers as v1's pipeline (combine.py)
  var LEAD = 6 * FR, GAP = 11 * FR, MAXHOLD = 4.0, TAIL = 1.4, ROW = 46, PAIR_GAP = 2.0;
  var MARK_HOLD = 0.5;          // LRCLIB marked the end of a line itself: the lyric goes this long after that mark
  var AGREE = 0.3;              // two uploads have the same timing when their lines are this close (seconds)
  var LENGTH_TOL = 2.0;        // an entry is this recording only if its length is within this many seconds of the mp3
  var HOMOGLYPHS = { 'е': 'e', 'о': 'o', 'а': 'a', 'с': 'c', 'р': 'p', 'х': 'x', 'і': 'i', 'у': 'y' };

  function plain(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function norm(s) {
    return plain(s).toLowerCase().replace(/&/g, ' and ').replace(/['’‘`´]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  // ---------- titles ----------
  // Words in a title's brackets (or after " - ") that make it a different recording. Both sides must agree on these.
  var KINDS = {
    sped: /\b(sped up|speed up|spedup|nightcore|fast version)\b/,
    slowed: /\b(slowed|slow version|reverb)\b/,
    live: /\b(live|en vivo|en directo|directo|ao vivo|unplugged|concierto|concert)\b/,
    remix: /\b(remix|rmx|bootleg|flip|rework|mashup|vip)\b/,
    acoustic: /\b(acoustic|acustico|acustica|stripped|piano version)\b/,
    instrumental: /\b(instrumental|karaoke)\b/,
    demo: /\bdemo\b/,
    cover: /\bcover\b/
  };
  // Words that only describe the same recording; the length check guards the rest.
  var COSMETIC = /\b(remaster|remastered|remasterizado|remasterizada|version|edit|mix|feat|ft|featuring|with|con|explicit|clean|official|oficial|audio|video|lyric|lyrics|letra|mono|stereo|bonus|deluxe|from|visualizer|hd|hq|paused|single|album|original|soundtrack|ost|prod|\d{4})\b/;
  var SPEED_TAIL = /^(.*\S)\s+(sped up|speed up|nightcore|slowed down|slowed (?:and |n )?reverb|slowed)$/;

  function kindsOf(text) {
    var t = norm(text), out = [];
    Object.keys(KINDS).forEach(function (k) { if (KINDS[k].test(t)) out.push(k); });
    return out;
  }
  // "Song (Are Made of This) (Remastered) - Live" -> { full: 'song are made of this', core: 'song', kinds: ['live'], remix: '' }
  function analyse(title) {
    var tags = [], rest = String(title || '');
    rest = rest.replace(/[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, function (m, inner) { tags.push(inner); return ' \u0001' + (tags.length - 1) + '\u0001 '; });
    var dash = rest.split(/\s+[-–—]\s+/);
    if (dash.length > 1) {        // "Title - Live", "Title - 2011 Remaster": a describing tail, unless it is plainly more title
      var tail = dash.slice(1).join(' - ');
      if (kindsOf(tail).length || COSMETIC.test(norm(tail))) { tags.push(tail); rest = dash[0]; }
    }
    var kinds = {}, remix = [], kept = [];
    tags.forEach(function (tag, i) {
      var ks = kindsOf(tag);
      ks.forEach(function (k) { kinds[k] = 1; });
      if (ks.indexOf('remix') >= 0) remix.push(norm(tag));
      if (!ks.length && !COSMETIC.test(norm(tag))) kept.push(i);
    });
    var core = norm(rest.replace(/\u0001\d+\u0001/g, ' '));
    var m = SPEED_TAIL.exec(core);                      // "i'm yours sped up" written without brackets
    if (m) { kindsOf(m[2]).forEach(function (k) { kinds[k] = 1; }); core = m[1]; }
    var full = norm(rest.replace(/\u0001(\d+)\u0001/g, function (x, i) { return kept.indexOf(+i) >= 0 ? ' ' + tags[+i] + ' ' : ' '; }));
    m = SPEED_TAIL.exec(full);
    if (m) full = m[1];
    return { full: full, core: core, kinds: Object.keys(kinds).sort(), remix: remix.sort().join(' | ') };
  }
  // The title as it goes on a title card: the song's own name, without what only describes the recording
  // ("(Sped Up)", "[Live]", " - 2011 Remaster", a trailing "slowed"). Brackets that are part of the name stay.
  function displayTitle(title) {
    function describes(t) { return kindsOf(t).length > 0 || COSMETIC.test(norm(t)); }
    var rest = String(title || '').replace(/[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, function (m, inner) { return describes(inner) ? ' ' : m; });
    var dash = rest.split(/\s+[-–—]\s+/);
    if (dash.length > 1 && describes(dash.slice(1).join(' - '))) rest = dash[0];
    rest = rest.replace(/\s+(sped up|speed up|nightcore|slowed down|slowed (?:and |n |\+ |& )?reverb|slowed)\s*$/i, '');
    return rest.replace(/\s+/g, ' ').trim() || String(title || '').trim();
  }
  function sameTitle(a, b) {
    if (!a.core || !b.core) return false;
    return a.full === b.full || a.core === b.core;
  }
  function sameKinds(a, b) {
    if (a.kinds.join() !== b.kinds.join()) return false;
    return !a.remix || a.remix === b.remix || a.remix.indexOf(b.remix) >= 0 || b.remix.indexOf(a.remix) >= 0;
  }

  // ---------- artists ----------
  function artists(s) {
    return plain(s).split(/\s*(?:,|;|\/|&|\+)\s*|\s+(?:x|feat\.?|ft\.?|featuring|y|con|and|with|vs\.?)\s+/i).map(norm).filter(function (x) { return x; });
  }
  function sameArtist(a, b) {
    var na = norm(a), nb = norm(b), la = artists(a), lb = artists(b);
    if (!na || !nb) return false;
    if (na === nb || la.some(function (x) { return lb.indexOf(x) >= 0; })) return true;
    return (' ' + na + ' ').indexOf(' ' + nb + ' ') >= 0 || (' ' + nb + ' ').indexOf(' ' + na + ' ') >= 0;
  }

  // "Artist - Title" (the file name without its extension) -> what to look for; null when there is no " - "
  function parseName(stem, swapped) {
    var i = stem.indexOf(' - ');
    if (i < 1) return null;
    var artist = stem.slice(0, i).trim(), title = stem.slice(i + 3).trim();
    if (swapped) { var t = artist; artist = title; title = t; }
    if (!artist || !title) return null;
    var first = plain(artist).split(/\s*(?:,|;|\/|&)\s*|\s+(?:x|feat\.?|ft\.?|featuring)\s+/i)[0].trim() || artist;
    var a = analyse(title);
    return { artist: artist, artistFirst: first, title: title, a: a, searchTitle: title.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ').replace(/\s+/g, ' ').trim() || title };
  }

  function timedLines(synced) { return parseLrc(synced).filter(function (l) { return l.text; }).length; }
  function median(v) { v = v.slice().sort(function (x, y) { return x - y; }); return v.length ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : 0; }

  // How far apart two uploads' line times are: the middle difference over lines with the same text, taken in order.
  // -> seconds, or null when they share fewer than 5 lines (other line breaks: no comparison)
  function timeGap(a, b) {
    var d = [], j = 0, i, k;
    for (i = 0; i < a.length; i++) {
      for (k = j; k < b.length && b[k].t <= a[i].t + 10; k++) {
        if (b[k].key === a[i].key && Math.abs(b[k].t - a[i].t) <= 10) { d.push(Math.abs(b[k].t - a[i].t)); j = k + 1; break; }
      }
    }
    return d.length >= 5 ? median(d) : null;
  }
  // Uploads of one recording can disagree on the line times by seconds, and the one with the nearest length is not always right.
  // list: timed entries, nearest length first. The nearest stays unless it stands apart from the timing the others sit closest to;
  // then the nearest length among the uploads with that timing is taken. Each upload counts once.
  function agreed(list) {
    if (list.length < 3) return list[0];
    var lines = list.map(function (e) {
      return parseLrc(e.syncedLyrics).filter(function (l) { return l.text; }).map(function (l) { return { t: l.t, key: norm(l.text) }; });
    });
    var mid = -1, low = 0;
    list.forEach(function (e, i) {
      var sum = 0, n = 0;
      list.forEach(function (o, j) { var g = i === j ? null : timeGap(lines[i], lines[j]); if (g !== null) { sum += Math.min(g, 5); n++; } });
      if (n >= 2 && (mid < 0 || sum / n < low - 1e-9)) { mid = i; low = sum / n; }
    });
    if (mid <= 0) return list[0];
    var first = timeGap(lines[0], lines[mid]);
    if (first === null || first <= AGREE) return list[0];
    for (var i = 1; i < mid; i++) { var g = timeGap(lines[i], lines[mid]); if (g !== null && g <= AGREE) return list[i]; }
    return list[mid];
  }

  // Decides what LRCLIB has for one song. entries: everything the searches returned. seconds: length of the mp3.
  // -> { state: 'found' | 'scaled' | 'lyricsonly' | 'notfound', entry, scale, plain, why }
  function decide(info, seconds, entries) {
    var mine = info.a, speed = mine.kinds.filter(function (k) { return k === 'sped' || k === 'slowed'; });
    var base = { full: mine.full, core: mine.core, kinds: mine.kinds.filter(function (k) { return speed.indexOf(k) < 0; }), remix: mine.remix };
    var same = [], original = [];
    (entries || []).forEach(function (e) {
      if (!e || !e.trackName || !sameArtist(info.artist, e.artistName)) return;
      var t = analyse(e.trackName);
      if (!sameTitle(mine, t)) return;
      // a live album counts as "live" for a song whose own title does not say so
      if (mine.kinds.indexOf('live') >= 0 && t.kinds.indexOf('live') < 0 && KINDS.live.test(norm(e.albumName))) { t.kinds.push('live'); t.kinds.sort(); }
      if (sameKinds(mine, t)) same.push(e);
      else if (speed.length && sameKinds(base, t)) original.push(e);
    });
    var near = same.filter(function (e) { return e.duration && Math.abs(e.duration - seconds) <= LENGTH_TOL; });
    near.sort(function (x, y) { return Math.abs(x.duration - seconds) - Math.abs(y.duration - seconds); });
    var synced = near.filter(function (e) { return e.syncedLyrics && timedLines(e.syncedLyrics) >= 3; });
    if (synced.length) {
      var best = agreed(synced), found = { state: 'found', entry: best, scale: 1, others: synced.length - 1 };
      if (best !== synced[0]) found.why = 'The uploads disagree on the line times: entry ' + synced[0].id + ' has the nearest length but stands apart from the others';
      return found;
    }

    if (speed.length) {
      // no entry for this speed: the normal version's times, stretched by the two lengths
      var lo = speed.indexOf('sped') >= 0 ? 0.5 : 1.02, hi = speed.indexOf('slowed') >= 0 ? 1.8 : 0.98;
      var orig = original.filter(function (e) {
        var r = e.duration ? seconds / e.duration : 0;
        return e.syncedLyrics && timedLines(e.syncedLyrics) >= 3 && r >= lo && r <= hi;
      });
      if (orig.length) {
        // most uploads agree on the real length; one read from a file (not a whole number) is the most exact
        var count = {}, top = 0, mode = 0;
        orig.forEach(function (e) { var k = Math.round(e.duration); count[k] = (count[k] || 0) + 1; if (count[k] > top) { top = count[k]; mode = k; } });
        var group = orig.filter(function (e) { return Math.abs(e.duration - mode) <= 1; });
        var exact = group.filter(function (e) { return Math.abs(e.duration - Math.round(e.duration)) > 0.01; });
        var len = exact.length ? median(exact.map(function (e) { return e.duration; })) : mode;
        group.sort(function (x, y) { return Math.abs(x.duration - len) - Math.abs(y.duration - len); });
        return { state: 'scaled', entry: group[0], scale: seconds / len, others: group.length - 1 };
      }
    }
    var text = near.filter(function (e) { return e.plainLyrics && e.plainLyrics.trim(); })[0];
    if (text) return { state: 'lyricsonly', plain: text.plainLyrics, why: 'On LRCLIB with lyrics but no timing' };
    var lens = same.filter(function (e) { return e.duration; }).map(function (e) { return Math.round(e.duration); });
    return { state: 'notfound', why: lens.length ? 'LRCLIB only has other lengths of this title (' + lens.slice(0, 4).map(mmss).join(', ') + '); this file is ' + mmss(seconds) : 'No entry on LRCLIB' };
  }
  function mmss(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  // ---------- entry -> SRT ----------
  // -> [{ t, text }] in time order; text '' is LRCLIB's own "nothing is sung from here" mark
  function parseLrc(synced) {
    var out = [];
    String(synced || '').split(/\r?\n/).forEach(function (line) {
      var times = [], m, re = /^\s*\[(\d+):(\d+(?:[.:]\d+)?)\]/;
      while ((m = re.exec(line))) { times.push((+m[1]) * 60 + parseFloat(m[2].replace(':', '.'))); line = line.slice(m[0].length); }
      if (!times.length) return;
      var raw = line.replace(/<\d+:\d+(?:\.\d+)?>/g, ' ').trim(), text = clean(raw);
      if (raw && !text) return;   // an ad-lib or symbols only: not a lyric, and not an end mark either
      times.forEach(function (t) { out.push({ t: t, text: text }); });
    });
    out.sort(function (x, y) { return x.t - y.t; });
    return out;
  }
  // the same tidying v1 gives a lyrics line: look-alike letters, curly quotes, one-word ad-libs in brackets dropped
  function clean(t) {
    t = String(t).split('').map(function (c) { return HOMOGLYPHS[c] || c; }).join('');
    t = t.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[♪♫♩♬]/g, ' ');
    t = t.replace(/\(([^)]*)\)/g, function (m, inner) { return inner.trim().split(/\s+/).length > 1 ? ' ' + inner + ' ' : ' '; });
    t = t.replace(/\s+/g, ' ').trim();
    return /\p{L}/u.test(t) ? t : '';
  }
  function rows(t) {
    if (t.length <= ROW) return [t];
    var best = -1, i;
    for (i = 0; i < t.length; i++) if (t.charAt(i) === ' ' && (best < 0 || Math.abs(i - t.length / 2) < Math.abs(best - t.length / 2))) best = i;
    return best < 0 ? [t] : [t.slice(0, best), t.slice(best + 1)];
  }
  function snap(s) { return Math.max(Math.round(s * FPS) / FPS, 0); }
  function stamp(s) {
    var ms = Math.round(snap(s) * 1000);
    function p(n, w) { return ('000' + n).slice(-w); }
    return p(Math.floor(ms / 3600000), 2) + ':' + p(Math.floor(ms / 60000) % 60, 2) + ':' + p(Math.floor(ms / 1000) % 60, 2) + ',' + p(ms % 1000, 3);
  }
  // LRCLIB gives only where each line starts. Where its singing ends is taken from the next line, from LRCLIB's
  // own end mark when there is one, or else guessed from the number of words; the captions are then put together
  // the way v1 does it (two short lines share a screen, a lyric stays until just before the next one, 4 s at most
  // into a break). scale stretches the times for a sped-up or slowed version; seconds is the length of the mp3.
  function toCues(synced, scale, seconds) {
    var all = parseLrc(synced), k = scale || 1, units = [], caps = [], i;
    all.forEach(function (l) { l.t *= k; });
    // how long this singer takes per word: where lines follow each other without a break, a line lasts until the
    // next one, so the quicker third of "seconds to the next line / words" is singing with no pause in it
    var pace = [];
    all.forEach(function (l, n) {
      var next = all[n + 1];
      if (l.text && next && next.t - l.t < 15) pace.push((next.t - l.t) / l.text.split(' ').length);
    });
    pace.sort(function (x, y) { return x - y; });
    var perWord = pace.length ? Math.min(1.5, Math.max(0.25, pace[Math.floor(pace.length * 0.3)])) : 0.45;
    all.forEach(function (l, n) {
      if (!l.text) return;
      var next = all[n + 1], words = l.text.split(' ').length;
      var guess = l.t + Math.max(1.0, perWord * words + 0.3);
      var end, hard = false;
      if (next && !next.text) { end = Math.max(next.t, l.t + 0.3); hard = true; }
      else if (next) end = Math.max(Math.min(guess, next.t - 0.05), l.t + 0.1);
      else end = seconds ? Math.min(guess, Math.max(seconds - 0.2, l.t + 0.3)) : guess;
      if (l.text.length <= 2 * ROW) { units.push({ text: l.text, s: l.t, e: end, hard: hard }); return; }
      // longer than one screen: cut at words into pieces of about 0.6 of a screen, time shared by length
      var parts = [], cur = [];
      l.text.split(' ').forEach(function (w) {
        cur.push(w);
        if (cur.join(' ').length >= 2 * ROW * 0.6) { parts.push(cur.join(' ')); cur = []; }
      });
      if (cur.length) { if (parts.length && cur.join(' ').length < 12) parts[parts.length - 1] += ' ' + cur.join(' '); else parts.push(cur.join(' ')); }
      var total = parts.join(' ').length, at = l.t;
      parts.forEach(function (p, q) {
        var to = q === parts.length - 1 ? end : at + (end - l.t) * (p.length + 1) / (total + 1);
        units.push({ text: p, s: at, e: to, hard: hard && q === parts.length - 1 });
        at = to;
      });
    });
    for (i = 0; i < units.length; i++) {
      var u = units[i], v = units[i + 1];
      if (v && u.text.length <= ROW && v.text.length <= ROW && v.s - u.e <= PAIR_GAP) {
        caps.push({ s: u.s, last: v.e, rows: rows(u.text).concat(rows(v.text)), hard: v.hard });
        i++;
      } else caps.push({ s: u.s, last: u.e, rows: rows(u.text), hard: u.hard });
    }
    caps.forEach(function (c) { c.s -= LEAD; });
    caps.forEach(function (c, n) {
      if (n + 1 < caps.length) {
        var nxt = caps[n + 1].s, e = Math.min(nxt - GAP, c.last + (c.hard ? MARK_HOLD : MAXHOLD));
        if (e < c.last) e = Math.min(c.last, nxt - 0.08);
        c.e = Math.max(e, c.s + 0.3);
      } else c.e = Math.max(c.last + TAIL, c.s + 1.0);
      if (seconds && c.e > seconds) c.e = Math.max(seconds, c.s + 0.3);
    });
    return caps.filter(function (c) { return !seconds || c.s < seconds - 0.2; })
      .map(function (c) { return { start: snap(c.s), end: Math.max(snap(c.e), snap(c.s) + FR), rows: c.rows }; });
  }
  function toSrt(synced, scale, seconds) {
    var cues = toCues(synced, scale, seconds);
    return { count: cues.length, text: cues.map(function (c, n) { return (n + 1) + '\n' + stamp(c.start) + ' --> ' + stamp(c.end) + '\n' + c.rows.join('\n') + '\n'; }).join('\n') };
  }

  return { norm: norm, analyse: analyse, displayTitle: displayTitle, parseName: parseName, sameArtist: sameArtist, decide: decide, parseLrc: parseLrc, toCues: toCues, toSrt: toSrt, mmss: mmss };
})();
