// Lyric Panel host script (ExtendScript, Premiere Pro).
// Called as: lpRun("fnName", argsFilePath, resultFilePath). Args and results travel as UTF-8 JSON files.

var LP_FRAME_FALLBACK = "10594584000"; // 23.976 fps in ticks

function lpQuote(s) {
    var out = '"', i, c, code;
    for (i = 0; i < s.length; i++) {
        c = s.charAt(i); code = s.charCodeAt(i);
        if (c === '"') out += '\\"';
        else if (c === '\\') out += '\\\\';
        else if (code === 10) out += '\\n';
        else if (code === 13) out += '\\r';
        else if (code === 9) out += '\\t';
        else if (code < 32 || code > 126) out += '\\u' + ('0000' + code.toString(16)).slice(-4);
        else out += c;
    }
    return out + '"';
}

function lpStringify(v) {
    var t = typeof v, parts = [], i, k;
    if (v === null || v === undefined) return 'null';
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return lpQuote(v);
    if (v instanceof Array) {
        for (i = 0; i < v.length; i++) parts.push(lpStringify(v[i]));
        return '[' + parts.join(',') + ']';
    }
    if (t === 'object') {
        for (k in v) if (v.hasOwnProperty(k)) parts.push(lpQuote(k) + ':' + lpStringify(v[k]));
        return '{' + parts.join(',') + '}';
    }
    return lpQuote(String(v));
}

function lpReadFile(path) {
    var f = new File(path);
    f.encoding = 'UTF-8';
    if (!f.open('r')) throw new Error('cannot open ' + path);
    var s = f.read();
    f.close();
    return s;
}

function lpWriteFile(path, text) {
    var f = new File(path);
    f.encoding = 'UTF-8';
    f.open('w');
    f.write(text);
    f.close();
}

function lpRun(fnName, argsPath, resultPath) {
    var res;
    try {
        var args = eval('(' + lpReadFile(argsPath) + ')');
        res = { ok: true, data: LPFN[fnName](args) };
    } catch (e) {
        res = { ok: false, error: String(e), line: e && e.line ? e.line : 0, fn: fnName };
    }
    lpWriteFile(resultPath, lpStringify(res));
    return res.ok ? 'ok' : 'error';
}

// ---------- helpers ----------

function lpTime(ticks) {
    var t = new Time();
    t.ticks = String(ticks);
    return t;
}

function lpSeqById(id) {
    var seqs = app.project.sequences, i;
    for (i = 0; i < seqs.numSequences; i++) if (seqs[i].sequenceID === id) return seqs[i];
    throw new Error('sequence not found: ' + id);
}

function lpSeqByName(name) {
    var seqs = app.project.sequences, i;
    for (i = 0; i < seqs.numSequences; i++) if (seqs[i].name === name) return seqs[i];
    throw new Error('sequence not found: ' + name);
}

function lpNormPath(p) {
    return String(p).replace(/\\/g, '/').toLowerCase();
}

// Depth-first search of the project for an item whose media path matches.
function lpFindByPath(path) {
    var want = lpNormPath(path), stack = [app.project.rootItem], guard = 0, bin, i, ch, mp;
    while (stack.length && guard < 20000) {
        bin = stack.pop();
        for (i = 0; i < bin.children.numItems; i++) {
            guard++;
            ch = bin.children[i];
            if (ch.type === 2) { stack.push(ch); continue; }
            mp = '';
            try { mp = ch.getMediaPath(); } catch (e) {}
            if (mp && lpNormPath(mp) === want) return ch;
        }
    }
    return null;
}

function lpFindBin(name, create) {
    var root = app.project.rootItem, i;
    for (i = 0; i < root.children.numItems; i++) {
        if (root.children[i].type === 2 && root.children[i].name === name) return root.children[i];
    }
    return create ? root.createBin(name) : null;
}

function lpFindClipAt(track, ticks) {
    var i, n = track.clips.numItems;
    for (i = 0; i < n; i++) if (String(track.clips[i].start.ticks) === String(ticks)) return track.clips[i];
    return null;
}

// overwriteClip's time argument differs between builds; try the known forms and confirm by lookup.
function lpPlace(track, item, ticks) {
    var forms = [lpTime(ticks), String(ticks), lpTime(ticks).seconds], i, clip;
    for (i = 0; i < forms.length; i++) {
        try { track.overwriteClip(item, forms[i]); } catch (e) {}
        clip = lpFindClipAt(track, ticks);
        if (clip) return { clip: clip, form: i };
    }
    throw new Error('could not place ' + item.name + ' at ' + ticks);
}

function lpTrackSummary(track, full) {
    var out = [], i, n = track.clips.numItems, c;
    for (i = 0; i < n; i++) {
        c = track.clips[i];
        if (full) out.push({ s: String(c.start.ticks), e: String(c.end.ticks), n: c.name });
        else if (i < 3 || i === n - 1) out.push({ s: String(c.start.ticks), e: String(c.end.ticks), n: c.name });
    }
    return { count: n, clips: out };
}

// ---------- callable functions ----------

var LPFN = {};

LPFN.info = function () {
    var seqs = [], i, s, bins = [], root = app.project.rootItem;
    for (i = 0; i < app.project.sequences.numSequences; i++) {
        s = app.project.sequences[i];
        seqs.push({
            name: s.name, id: s.sequenceID, w: s.frameSizeHorizontal, h: s.frameSizeVertical,
            timebase: String(s.timebase), v: s.videoTracks.numTracks, a: s.audioTracks.numTracks,
            end: String(s.end)
        });
    }
    for (i = 0; i < root.children.numItems; i++) {
        if (root.children[i].type === 2) bins.push({ name: root.children[i].name, items: root.children[i].children.numItems });
    }
    return {
        version: app.version, project: app.project.name, path: app.project.path,
        active: app.project.activeSequence ? app.project.activeSequence.name : null,
        sequences: seqs, bins: bins
    };
};

LPFN.cloneSequence = function (a) {
    var src = lpSeqByName(a.name), before = {}, i, s, made = null;
    for (i = 0; i < app.project.sequences.numSequences; i++) before[app.project.sequences[i].sequenceID] = true;
    src.clone();
    for (i = 0; i < app.project.sequences.numSequences; i++) {
        s = app.project.sequences[i];
        if (!before[s.sequenceID]) made = s;
    }
    if (!made) throw new Error('clone produced no new sequence');
    try { made.name = a.newName; } catch (e) {}
    if (made.name !== a.newName) { try { made.projectItem.name = a.newName; } catch (e2) {} }
    return { id: made.sequenceID, name: made.name, timebase: String(made.timebase) };
};

LPFN.clearTracks = function (a) {
    var seq = lpSeqById(a.seqId), removed = 0, k, tr, i, group;
    for (k = 0; k < a.video.length; k++) {
        tr = seq.videoTracks[a.video[k]];
        for (i = tr.clips.numItems - 1; i >= 0; i--) { tr.clips[i].remove(false, false); removed++; }
    }
    for (k = 0; k < a.audio.length; k++) {
        tr = seq.audioTracks[a.audio[k]];
        for (i = tr.clips.numItems - 1; i >= 0; i--) { tr.clips[i].remove(false, false); removed++; }
    }
    return { removed: removed };
};

// Imports any path not already in the project. Returns per-path status.
LPFN.ensureImported = function (a) {
    var missing = [], out = [], i, it, bin;
    for (i = 0; i < a.paths.length; i++) if (!lpFindByPath(a.paths[i])) missing.push(a.paths[i]);
    if (missing.length) {
        bin = lpFindBin(a.bin, true);
        app.project.importFiles(missing, true, bin, false);
    }
    for (i = 0; i < a.paths.length; i++) {
        it = lpFindByPath(a.paths[i]);
        out.push({ path: a.paths[i], found: !!it, name: it ? it.name : null });
    }
    return { imported: missing.length, items: out };
};

LPFN.placeAudio = function (a) {
    var seq = lpSeqById(a.seqId), item = lpFindByPath(a.path);
    if (!item) throw new Error('not imported: ' + a.path);
    var r = lpPlace(seq.audioTracks[a.track], item, a.startTicks);
    return { start: String(r.clip.start.ticks), end: String(r.clip.end.ticks), form: r.form };
};

// Places a still or video on a video track and trims/extends it to endTicks.
LPFN.placeVideo = function (a) {
    var seq = lpSeqById(a.seqId), item = lpFindByPath(a.path), note = [];
    if (!item) throw new Error('not imported: ' + a.path);
    if (a.scaleToFrame) { try { item.setScaleToFrameSize(); } catch (e) { note.push('scale: ' + e); } }
    var aBefore = [], i;
    for (i = 0; i < seq.audioTracks.numTracks; i++) aBefore.push(seq.audioTracks[i].clips.numItems);
    var r = lpPlace(seq.videoTracks[a.track], item, a.startTicks);
    try { r.clip.end = lpTime(a.endTicks); } catch (e2) { note.push('end: ' + e2); }
    var aAfter = [];
    for (i = 0; i < seq.audioTracks.numTracks; i++) aAfter.push(seq.audioTracks[i].clips.numItems);
    var again = lpFindClipAt(seq.videoTracks[a.track], a.startTicks);
    return {
        start: String(again.start.ticks), end: String(again.end.ticks), wantEnd: String(a.endTicks),
        audioBefore: aBefore, audioAfter: aAfter, form: r.form, note: note
    };
};

// Copies the keyframes of one property to another. shift = how much later the new clip's source time runs (ticks).
function lpCopyKeys(sp, dp, shift) {
    var keys = sp.getKeys(), i, v, t, form = -1, n = 0;
    if (!keys || !keys.length) return 0;
    if (!dp.isTimeVarying()) dp.setTimeVarying(true);
    for (i = 0; i < keys.length && i < 200; i++) {
        v = sp.getValueAtKey(keys[i]);
        t = Number(keys[i].ticks) + shift;
        form = lpAddKey(dp, t, v, form);
        if (form < 0) break;
        // a position that eases in the template eases here too (the exact curve is Premiere's own)
        if (v instanceof Array) { try { dp.setInterpolationTypeAtKey(lpTime(t), 5, false); } catch (e) {} }
        n++;
    }
    return n;
}

// Copies Motion and Opacity (incl. blend mode) from one clip to another. Returns notes on what could not be copied.
// keys: true = keyframes are copied too, false = keyframed properties are left alone, omitted = they are reported.
function lpCopyIntrinsics(src, dst, keys) {
    var notes = [], i, j, p, sc, dc, sp;
    var shift = Number(dst.inPoint.ticks) - Number(src.inPoint.ticks);
    for (i = 0; i < src.components.numItems; i++) {
        sc = src.components[i];
        if (sc.matchName !== 'AE.ADBE Motion' && sc.matchName !== 'AE.ADBE Opacity') {
            notes.push('not copied: ' + sc.displayName);
            continue;
        }
        dc = null;
        for (j = 0; j < dst.components.numItems; j++) if (dst.components[j].matchName === sc.matchName) dc = dst.components[j];
        if (!dc) { notes.push('missing on new clip: ' + sc.displayName); continue; }
        for (p = 0; p < sc.properties.numItems && p < dc.properties.numItems; p++) {
            sp = sc.properties[p];
            try {
                if (sp.isTimeVarying()) {
                    if (keys === true) { if (!lpCopyKeys(sp, dc.properties[p], shift)) notes.push('keyframes not copied: ' + sc.displayName + '/' + sp.displayName); }
                    else if (keys !== false) notes.push('keyframed, not copied: ' + sc.displayName + '/' + sp.displayName);
                    continue;
                }
                dc.properties[p].setValue(sp.getValue(), true);
            } catch (e) { notes.push(sc.displayName + '/' + sp.displayName + ': ' + e); }
        }
    }
    return notes;
}

// Adds to dst (qc = the same clip in the QE DOM) every effect src carries besides Motion and Opacity, with its settings.
function lpCopyEffects(src, dst, qc, keys, added, notes) {
    var i, p, sc, dc, fx, sp, before, col;
    var shift = Number(dst.inPoint.ticks) - Number(src.inPoint.ticks);
    for (i = 0; i < src.components.numItems && i < 50; i++) {
        sc = src.components[i];
        if (/Motion|Opacity|Time Remapping/.test(sc.matchName)) continue;
        fx = null;
        try { fx = qe.project.getVideoEffectByName(sc.displayName); } catch (e2) {}
        before = dst.components.numItems;
        try { if (fx) qc.addVideoEffect(fx); } catch (e3) { notes.push(sc.displayName + ': ' + e3); }
        if (dst.components.numItems <= before) { notes.push('not added: ' + sc.displayName); continue; }
        dc = dst.components[dst.components.numItems - 1];
        for (p = 0; p < sc.properties.numItems && p < dc.properties.numItems; p++) {
            sp = sc.properties[p];
            try {
                if (sp.isTimeVarying()) {
                    if (keys === true) lpCopyKeys(sp, dc.properties[p], shift);
                    else notes.push('keyframed, not copied: ' + sc.displayName + '/' + sp.displayName);
                    continue;
                }
                col = null;
                try { col = sp.getColorValue(); } catch (e4) {}
                if (col && col.length === 4) dc.properties[p].setColorValue(col[0], col[1], col[2], col[3], true);
                else dc.properties[p].setValue(sp.getValue(), true);
            } catch (e5) { if (notes.length < 8) notes.push(sc.displayName + '/' + sp.displayName + ': ' + e5); }
        }
        added.push(sc.displayName);
    }
}

// The clip of the QE DOM that starts at the given time on a video track (null if none).
function lpQeClipAt(q, track, ticks) {
    var qt = q.getVideoTrackAt(track), i, it;
    for (i = 0; i < qt.numItems && i < 5000; i++) {
        try {
            it = qt.getItemAt(i);
            if (it.type !== 'Empty' && String(it.start.ticks) === String(ticks)) return it;
        } catch (e) {}
    }
    return null;
}

// Re-places the template's layer (first clip on tplTrack of the template sequence) over [startTicks, endTicks],
// repeating it if its source is shorter than the slot.
LPFN.placeLayer = function (a) {
    var seq = lpSeqById(a.seqId), tpl = lpSeqByName(a.tplName);
    var src = tpl.videoTracks[a.tplTrack].clips[0];
    if (!src) throw new Error('template track V' + (a.tplTrack + 1) + ' has no clip');
    var item = src.projectItem, track = seq.videoTracks[a.track];
    var aBefore = [], aAfter = [], i, cursor = Number(a.startTicks), want = Number(a.endTicks), pieces = 0, notes = [], r, got;
    for (i = 0; i < seq.audioTracks.numTracks; i++) aBefore.push(seq.audioTracks[i].clips.numItems);
    while (cursor < want && pieces < 50) {
        r = lpPlace(track, item, cursor);
        try { r.clip.end = lpTime(want); } catch (e) { notes.push('end: ' + e); }
        r.clip = lpFindClipAt(track, cursor);
        got = Number(r.clip.end.ticks);
        if (pieces === 0) notes = notes.concat(lpCopyIntrinsics(src, r.clip));
        else lpCopyIntrinsics(src, r.clip);
        pieces++;
        if (got <= cursor) break;
        cursor = got;
    }
    for (i = 0; i < seq.audioTracks.numTracks; i++) aAfter.push(seq.audioTracks[i].clips.numItems);
    return { source: item.name, pieces: pieces, reached: String(cursor), want: String(want), audioBefore: aBefore, audioAfter: aAfter, notes: notes };
};

// Places the audio just to read its real length on the timeline, then removes it again.
LPFN.measureAudio = function (a) {
    var seq = lpSeqById(a.seqId), item = lpFindByPath(a.path);
    if (!item) throw new Error('not imported: ' + a.path);
    var r = lpPlace(seq.audioTracks[a.track], item, a.startTicks);
    var ticks = Number(r.clip.end.ticks) - Number(r.clip.start.ticks);
    r.clip.remove(false, false);
    return { ticks: String(ticks) };
};

// Removes every audio clip that starts inside [startTicks, endTicks) on any audio track.
LPFN.clearAudioRange = function (a) {
    var seq = lpSeqById(a.seqId), removed = 0, t, i, tr, s;
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        tr = seq.audioTracks[t];
        for (i = tr.clips.numItems - 1; i >= 0; i--) {
            s = Number(tr.clips[i].start.ticks);
            if (s >= Number(a.startTicks) && s < Number(a.endTicks)) { tr.clips[i].remove(false, false); removed++; }
        }
    }
    return { removed: removed };
};

LPFN.selectTrack = function (a) {
    var seq = lpSeqById(a.seqId), t, i, tr, n = 0;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        tr = seq.videoTracks[t];
        for (i = 0; i < tr.clips.numItems; i++) {
            tr.clips[i].setSelected(t === a.track, i === tr.clips.numItems - 1);
            if (t === a.track) n++;
        }
    }
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        tr = seq.audioTracks[t];
        for (i = 0; i < tr.clips.numItems; i++) tr.clips[i].setSelected(false, false);
    }
    return { selected: n };
};

// Selects the clips of one video track that start inside any of the given time ranges, and nothing else.
LPFN.selectRange = function (a) {
    var seq = lpSeqById(a.seqId), t, i, j, tr, s, hit, n = 0;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        tr = seq.videoTracks[t];
        for (i = 0; i < tr.clips.numItems; i++) {
            hit = false;
            if (t === a.track) {
                s = Number(tr.clips[i].start.ticks);
                for (j = 0; j < a.ranges.length && !hit; j++) hit = s >= a.ranges[j].s && s < a.ranges[j].e;
            }
            tr.clips[i].setSelected(hit, i === tr.clips.numItems - 1);
            if (hit) n++;
        }
    }
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        tr = seq.audioTracks[t];
        for (i = 0; i < tr.clips.numItems; i++) tr.clips[i].setSelected(false, false);
    }
    return { selected: n };
};

LPFN.createCaptions = function (a) {
    var seq = lpSeqById(a.seqId), item = lpFindByPath(a.path);
    if (!item) throw new Error('SRT not imported: ' + a.path);
    var r = seq.createCaptionTrack(item, 0, Sequence.CAPTION_FORMAT_SUBTITLE);
    return { result: String(r) };
};

LPFN.activate = function (a) {
    var seq = lpSeqById(a.seqId), r = app.project.openSequence(seq.sequenceID);
    return { opened: String(r), active: app.project.activeSequence ? app.project.activeSequence.name : null };
};

LPFN.report = function (a) {
    var seq = lpSeqById(a.seqId), v = [], au = [], i;
    for (i = 0; i < seq.videoTracks.numTracks; i++) v.push(lpTrackSummary(seq.videoTracks[i], a.fullTrack === i || a.full === true));
    for (i = 0; i < seq.audioTracks.numTracks; i++) au.push(lpTrackSummary(seq.audioTracks[i], false));
    return { name: seq.name, video: v, audio: au, end: String(seq.end) };
};

// ---------- track management (QE DOM; the public API cannot add or remove tracks) ----------

function lpQeSeq(seq) {
    app.project.openSequence(seq.sequenceID);
    app.enableQE();
    var q = qe.project.getActiveSequence();
    if (!q || q.name !== seq.name) throw new Error('QE active sequence is not ' + seq.name);
    return q;
}

// Adds video tracks above the current top track.
LPFN.addVideoTracks = function (a) {
    var seq = lpSeqById(a.seqId), q = lpQeSeq(seq), notes = [];
    var vBefore = seq.videoTracks.numTracks, aBefore = seq.audioTracks.numTracks;
    var forms = [
        function () { q.addTracks(a.count, vBefore, 0); },
        function () { q.addTracks(a.count, vBefore, 0, 0, 0, 0, 0); },
        function () { q.addTracks(a.count, vBefore - 1, 0, 1, 0, 0, 0); }
    ], i;
    for (i = 0; i < forms.length && seq.videoTracks.numTracks === vBefore; i++) {
        try { forms[i](); notes.push('form ' + i); } catch (e) { notes.push('form ' + i + ' failed: ' + e); }
    }
    return { videoBefore: vBefore, videoAfter: seq.videoTracks.numTracks, audioBefore: aBefore, audioAfter: seq.audioTracks.numTracks, notes: notes };
};

LPFN.removeEmptyVideoTracks = function (a) {
    var seq = lpSeqById(a.seqId), q = lpQeSeq(seq), notes = [], vBefore = seq.videoTracks.numTracks;
    try { q.removeEmptyVideoTracks(); } catch (e) { notes.push(String(e)); }
    return { videoBefore: vBefore, videoAfter: seq.videoTracks.numTracks, notes: notes };
};

// Moves each lyric graphic vertically. items: [{ s: startTicks, y: 0..1 }]
LPFN.setLyricPosition = function (a) {
    var seq = lpSeqById(a.seqId), tr = seq.videoTracks[a.track], want = {}, i, j, c, comp, set = 0, notes = [], cur;
    for (i = 0; i < a.items.length; i++) want[String(a.items[i].s)] = a.items[i].y;
    for (i = 0; i < tr.clips.numItems; i++) {
        c = tr.clips[i];
        if (want[String(c.start.ticks)] === undefined) continue;
        comp = null;
        for (j = 0; j < c.components.numItems; j++) if (c.components[j].matchName === 'AE.ADBE Graphic Group') comp = c.components[j];
        if (!comp) { if (notes.length < 3) notes.push('no Vector Motion on clip ' + i); continue; }
        try {
            cur = comp.properties[0].getValue();
            comp.properties[0].setValue([cur[0], want[String(c.start.ticks)]], i === tr.clips.numItems - 1);
            set++;
        } catch (e) { if (notes.length < 3) notes.push(String(e)); }
    }
    return { set: set, notes: notes };
};

// Gets ready to cut/paste clips between tracks: selects every clip on track `from` (and nothing else),
// targets only video track `to`, and parks the playhead on the first selected clip.
// With from = -1 it only re-applies the targeting and playhead (used right before Paste).
LPFN.prepareMove = function (a) {
    var seq = lpSeqById(a.seqId), notes = [], t, i, tr, n = 0, first = null;
    app.project.openSequence(seq.sequenceID);
    if (a.from >= 0) {
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            tr = seq.videoTracks[t];
            for (i = 0; i < tr.clips.numItems; i++) {
                tr.clips[i].setSelected(t === a.from, false);
                if (t === a.from) { n++; if (first === null) first = String(tr.clips[i].start.ticks); }
            }
        }
        for (t = 0; t < seq.audioTracks.numTracks; t++) {
            tr = seq.audioTracks[t];
            for (i = 0; i < tr.clips.numItems; i++) tr.clips[i].setSelected(false, false);
        }
        // one last call with updateUI = true so the timeline shows the selection
        tr = seq.videoTracks[a.from];
        if (tr.clips.numItems) tr.clips[0].setSelected(true, true);
    } else {
        first = String(a.playheadTicks);
    }
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        try { seq.videoTracks[t].setTargeted(t === a.to, true); } catch (e) { if (notes.length < 2) notes.push('target V' + (t + 1) + ': ' + e); }
    }
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        try { seq.audioTracks[t].setTargeted(false, true); } catch (e2) {}
    }
    if (first !== null) seq.setPlayerPosition(first);
    var targeted = [];
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        try { if (seq.videoTracks[t].isTargeted()) targeted.push(t + 1); } catch (e3) {}
    }
    return { selected: n, playhead: first, targeted: targeted, notes: notes };
};

// Places another sequence as a nested clip on a video track, with its audio on a chosen audio track.
LPFN.placeSequence = function (a) {
    var seq = lpSeqById(a.seqId), nest = lpSeqById(a.nestId), item = nest.projectItem, i, clip = null, form = -1;
    if (!item) throw new Error('sequence has no project item: ' + nest.name);
    var track = seq.videoTracks[a.track], aBefore = [], aAfter = [];
    for (i = 0; i < seq.audioTracks.numTracks; i++) aBefore.push(seq.audioTracks[i].clips.numItems);
    var forms = [lpTime(a.startTicks), String(a.startTicks), lpTime(a.startTicks).seconds];
    for (i = 0; i < forms.length && !clip; i++) {
        try { seq.overwriteClip(item, forms[i], a.track, a.audioTrack); } catch (e) {}
        clip = lpFindClipAt(track, a.startTicks);
        if (clip) form = i;
    }
    if (!clip) clip = lpPlace(track, item, a.startTicks).clip;
    for (i = 0; i < seq.audioTracks.numTracks; i++) aAfter.push(seq.audioTracks[i].clips.numItems);
    return {
        name: clip.name, start: String(clip.start.ticks), end: String(clip.end.ticks), form: form,
        videoCount: track.clips.numItems, audioBefore: aBefore, audioAfter: aAfter
    };
};

// Gives the first clip on a track of the sequence the effects (e.g. Drop Shadow) that the first clip on the same
// track of the template carries, with their settings. Motion and Opacity are left as they are.
LPFN.copyEffects = function (a) {
    var seq = lpSeqById(a.seqId), tpl = lpSeqByName(a.tplName), added = [], notes = [];
    var src = a.track < tpl.videoTracks.numTracks ? tpl.videoTracks[a.track].clips[0] : null;
    var dst = seq.videoTracks[a.track].clips[0];
    if (!src || !dst) return { added: added, notes: ['no clip to copy ' + (src ? 'to' : 'from')] };
    var q = lpQeSeq(seq), qc = lpQeClipAt(q, a.track, String(dst.start.ticks));
    if (!qc) return { added: added, notes: ['clip not found on V' + (a.track + 1)] };
    lpCopyEffects(src, dst, qc, false, added, notes);
    return { added: added, notes: notes };
};

// Lists the media directly inside a root-level bin (sub-bins are ignored).
LPFN.binItems = function (a) {
    var bin = lpFindBin(a.name, false), out = [], i, ch, mp;
    if (!bin) return { found: false, items: [] };
    for (i = 0; i < bin.children.numItems; i++) {
        ch = bin.children[i];
        if (ch.type === 2) continue;
        mp = '';
        try { mp = ch.getMediaPath(); } catch (e) {}
        if (mp) out.push({ name: ch.name, path: mp });
    }
    return { found: true, items: out };
};

// Sets the sequence in/out points and parks the playhead on the in point.
LPFN.setInOut = function (a) {
    var seq = lpSeqById(a.seqId), tps = 254016000000, got;
    app.project.openSequence(seq.sequenceID);
    var forms = [
        function () { seq.setInPoint(Number(a.inTicks) / tps); seq.setOutPoint(Number(a.outTicks) / tps); },
        function () { seq.setInPoint(String(a.inTicks)); seq.setOutPoint(String(a.outTicks)); }
    ], i, used = -1;
    for (i = 0; i < forms.length && used < 0; i++) {
        try { forms[i](); } catch (e) {}
        got = Number(seq.getInPointAsTime().ticks);
        if (Math.abs(got - Number(a.inTicks)) < 10594584000) used = i;
    }
    seq.setPlayerPosition(String(a.inTicks));
    return { form: used, inTicks: String(seq.getInPointAsTime().ticks), outTicks: String(seq.getOutPointAsTime().ticks) };
};

// Counts selected clips on the video and audio tracks (captions cannot be inspected, so audio stands in for them).
LPFN.selectionCount = function (a) {
    var seq = lpSeqById(a.seqId), n = 0, t, i, tr;
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        tr = seq.audioTracks[t];
        for (i = 0; i < tr.clips.numItems; i++) { try { if (tr.clips[i].isSelected()) n++; } catch (e) {} }
    }
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        tr = seq.videoTracks[t];
        for (i = 0; i < tr.clips.numItems; i++) { try { if (tr.clips[i].isSelected()) n++; } catch (e2) {} }
    }
    return { selected: n };
};

// Lists every video file in the project (any bin), for the overlay picker.
LPFN.videoItems = function () {
    var out = [], stack = [{ bin: app.project.rootItem, where: '' }], guard = 0, cur, i, ch, mp;
    while (stack.length && guard < 20000) {
        cur = stack.pop();
        for (i = 0; i < cur.bin.children.numItems; i++) {
            guard++;
            ch = cur.bin.children[i];
            if (ch.type === 2) { stack.push({ bin: ch, where: ch.name }); continue; }
            mp = '';
            try { mp = ch.getMediaPath(); } catch (e) {}
            if (mp && /[.](mp4|mov|mxf|avi|m4v|webm)$/i.test(mp)) out.push({ name: ch.name, path: mp, bin: cur.where });
        }
    }
    return { items: out };
};

// Finds a clip in a sequence that uses the given media file (used as the look reference for an overlay).
function lpFindClipOfItem(seq, path) {
    var want = lpNormPath(path), t, i, tr, mp;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        tr = seq.videoTracks[t];
        for (i = 0; i < tr.clips.numItems; i++) {
            mp = '';
            try { mp = tr.clips[i].projectItem.getMediaPath(); } catch (e) {}
            if (mp && lpNormPath(mp) === want) return tr.clips[i];
        }
    }
    return null;
}

// Finds a clip in a sequence that is itself a sequence (a nest) containing the given media file.
function lpFindNestOfItem(seq, path) {
    var t, i, k, tr, pi, inner;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        tr = seq.videoTracks[t];
        for (i = 0; i < tr.clips.numItems && i < 200; i++) {
            pi = tr.clips[i].projectItem;
            if (!pi) continue;
            inner = null;
            for (k = 0; k < app.project.sequences.numSequences && !inner; k++) {
                try { if (app.project.sequences[k].projectItem.nodeId === pi.nodeId) inner = app.project.sequences[k]; } catch (e) {}
            }
            if (inner && inner.sequenceID !== seq.sequenceID && lpFindClipOfItem(inner, path)) return tr.clips[i];
        }
    }
    return null;
}

// Places an overlay video over [startTicks, endTicks], repeating it if it is shorter than the song.
// If the template sequence already uses this file, its scale, opacity and blend mode are copied.
LPFN.placeOverlay = function (a) {
    var seq = lpSeqById(a.seqId), item = lpFindByPath(a.path), notes = [];
    if (!item) throw new Error('overlay is not in the project: ' + a.path);
    var ref = null;
    var n;
    for (n = 0; n < a.tplNames.length && !ref; n++) {
        try { ref = lpFindClipOfItem(lpSeqByName(a.tplNames[n]), a.path); } catch (e) {}
    }
    // The template may hold the overlay inside a nest (a sequence used as a clip): then that nest is what gets placed,
    // with the look of the template's nest clip.
    var viaNest = '';
    for (n = 0; n < a.tplNames.length && !ref; n++) {
        try { ref = lpFindNestOfItem(lpSeqByName(a.tplNames[n]), a.path); } catch (e4) {}
        if (ref) { item = ref.projectItem; viaNest = ref.name; }
    }
    if (!ref) { try { item.setScaleToFrameSize(); } catch (e2) { notes.push('scale: ' + e2); } }
    var track = seq.videoTracks[a.track], cursor = Number(a.startTicks), want = Number(a.endTicks), pieces = 0, r, got;
    while (cursor < want && pieces < 200) {
        r = lpPlace(track, item, cursor);
        try { r.clip.end = lpTime(want); } catch (e3) { notes.push('end: ' + e3); }
        r.clip = lpFindClipAt(track, cursor);
        got = Number(r.clip.end.ticks);
        if (ref) lpCopyIntrinsics(ref, r.clip);
        pieces++;
        if (got <= cursor) break;
        cursor = got;
    }
    return { pieces: pieces, full: cursor >= want, lookCopied: !!ref, viaNest: viaNest, notes: notes };
};

// Renders one frame of a sequence to a PNG (QE DOM). The panel reads the file to measure where the text sits.
LPFN.exportFrame = function (a) {
    var seq = lpSeqById(a.seqId), q = lpQeSeq(seq);
    seq.setPlayerPosition(String(a.ticks));
    var tc = q.CTI.timecode;
    q.exportFramePNG(tc, a.path);
    return { timecode: String(tc) };
};

// Shifts lyric graphics vertically by a relative amount. items: [{ s: startTicks, dy: fraction of frame height }]
LPFN.nudgeLyrics = function (a) {
    var seq = lpSeqById(a.seqId), tr = seq.videoTracks[a.track], want = {}, i, j, c, comp, set = 0, notes = [], cur;
    for (i = 0; i < a.items.length; i++) want[String(a.items[i].s)] = a.items[i].dy;
    for (i = 0; i < tr.clips.numItems; i++) {
        c = tr.clips[i];
        if (want[String(c.start.ticks)] === undefined) continue;
        comp = null;
        for (j = 0; j < c.components.numItems; j++) if (c.components[j].matchName === 'AE.ADBE Graphic Group') comp = c.components[j];
        if (!comp) { if (notes.length < 3) notes.push('no Vector Motion on clip ' + i); continue; }
        try {
            cur = comp.properties[0].getValue();
            comp.properties[0].setValue([cur[0], cur[1] + want[String(c.start.ticks)]], i === tr.clips.numItems - 1);
            set++;
        } catch (e) { if (notes.length < 3) notes.push(String(e)); }
    }
    return { set: set, notes: notes };
};

// ---------- review of marked lyrics ----------

LPFN.playhead = function (a) {
    return { ticks: String(lpSeqById(a.seqId).getPlayerPosition().ticks) };
};

LPFN.setPlayhead = function (a) {
    var seq = lpSeqById(a.seqId);
    seq.setPlayerPosition(String(a.ticks));
    return { ticks: String(seq.getPlayerPosition().ticks) };
};

// Adds one sequence marker per time in items (ticks).
LPFN.addMarkers = function (a) {
    var seq = lpSeqById(a.seqId), n = 0, i, m, notes = [];
    for (i = 0; i < a.items.length; i++) {
        try {
            m = seq.markers.createMarker(Number(a.items[i]) / 254016000000);
            m.name = a.name;
            try { m.setColorByIndex(a.color); } catch (e1) {}
            n++;
        } catch (e) { if (notes.length < 2) notes.push(String(e)); }
    }
    return { added: n, notes: notes };
};

// Moves the start of the lyric graphic that begins at `from` to `to` (ticks), keeping its end where it is.
// A previous lyric that would overlap is shortened to end at the new start.
LPFN.moveLyricStart = function (a) {
    var seq = lpSeqById(a.seqId), F = Number(LP_FRAME_FALLBACK), t, i, tr = null, c = null, ci = -1, notes = [];
    for (t = 0; t < seq.videoTracks.numTracks && !c; t++) {
        tr = seq.videoTracks[t];
        for (i = 0; i < tr.clips.numItems; i++) {
            if (Math.abs(Number(tr.clips[i].start.ticks) - Number(a.from)) <= F) { c = tr.clips[i]; ci = i; break; }
        }
    }
    if (!c) return { moved: false, why: 'no lyric starts at that time any more' };
    var end0 = String(c.end.ticks), to = Number(a.to), prev = ci > 0 ? tr.clips[ci - 1] : null;
    if (to >= Number(end0) - 2 * F) return { moved: false, why: 'the new start is past the end of the lyric' };
    if (prev && Number(prev.end.ticks) > to) {
        if (Number(prev.start.ticks) >= to - 2 * F) return { moved: false, why: 'the previous lyric is in the way' };
        try { prev.end = lpTime(to); } catch (e) { notes.push('previous end: ' + e); }
    }
    try { c.start = lpTime(to); } catch (e2) { notes.push('start: ' + e2); }
    if (String(c.end.ticks) !== end0) { try { c.end = lpTime(end0); } catch (e3) { notes.push('end: ' + e3); } }
    return { moved: Math.abs(Number(c.start.ticks) - to) <= F, start: String(c.start.ticks), end: String(c.end.ticks), wantEnd: end0, notes: notes };
};

// ---------- logo, title and thumbnail ----------

// Reads the lyrics template: which clip is the watermark (the only clip of its track, from the start) and which is
// the intro logo (first clip of a track that has more after it). Graphics (the template's title and lyric) are skipped.
LPFN.titleParts = function (a) {
    var tpl = lpSeqByName(a.tplName), out = { watermark: null, intro: null, tracks: tpl.videoTracks.numTracks }, t, tr, c, pi, mp, nest, part;
    for (t = 1; t < tpl.videoTracks.numTracks; t++) {
        tr = tpl.videoTracks[t];
        if (!tr.clips.numItems) continue;
        c = tr.clips[0]; pi = c.projectItem; mp = ''; nest = false;
        if (Number(c.start.ticks) !== 0 || !pi) continue;
        try { mp = pi.getMediaPath(); } catch (e) {}
        try { nest = !!pi.isSequence(); } catch (e2) {}
        if (!mp && !nest) continue;
        part = { track: t, index: 0, name: c.name, path: String(mp || ''), nest: nest, durTicks: String(Number(c.end.ticks) - Number(c.start.ticks)) };
        if (tr.clips.numItems === 1) { if (!out.watermark) out.watermark = part; }
        else if (!out.intro) out.intro = part;
    }
    return out;
};

// Puts a copy of a template clip (same source, same look, same effects) on a track of the sequence.
// endTicks omitted = the template clip's own length. keys: copy the keyframes too.
LPFN.copyClip = function (a) {
    var seq = lpSeqById(a.seqId), tpl = lpSeqByName(a.tplName), src = tpl.videoTracks[a.tplTrack].clips[a.tplIndex];
    if (!src || !src.projectItem) throw new Error('template clip not found on V' + (a.tplTrack + 1));
    var track = seq.videoTracks[a.track], notes = [], added = [], i, k, tr, dst, q, qc, own, s0, pieces = 0, got;
    var start = Number(a.startTicks), cursor = start;
    var want = a.endTicks ? Number(a.endTicks) : start + Number(src.end.ticks) - Number(src.start.ticks);
    // a source shorter than the stretch (a nest, a video) is repeated until the end is reached
    while (cursor < want && pieces < 200) {
        dst = lpPlace(track, src.projectItem, cursor).clip;
        try { dst.end = lpTime(want); } catch (e) { notes.push('end: ' + e); }
        dst = lpFindClipAt(track, cursor);
        got = Number(dst.end.ticks);
        own = lpCopyIntrinsics(src, dst, pieces === 0 && !!a.keys);
        for (i = 0; i < own.length; i++) if (own[i].indexOf('not copied: ') !== 0) notes.push(own[i]);   // effects are copied below
        try {
            q = lpQeSeq(seq); qc = lpQeClipAt(q, a.track, String(cursor));
            if (qc) lpCopyEffects(src, dst, qc, pieces === 0 && !!a.keys, pieces === 0 ? added : [], notes);
            else if (src.components.numItems > 2) notes.push('effects not copied: clip not found in QE');
        } catch (e2) { notes.push('effects: ' + e2); }
        pieces++;
        if (got <= cursor) break;
        cursor = got;
    }
    // sound the clip brought along on the tracks above A1 is removed again (A1 holds the songs: the panel checks it)
    for (i = 1; i < seq.audioTracks.numTracks; i++) {
        tr = seq.audioTracks[i];
        for (k = tr.clips.numItems - 1; k >= 0; k--) {
            s0 = Number(tr.clips[k].start.ticks);
            if (s0 >= start && s0 < want) tr.clips[k].remove(false, false);
        }
    }
    return { start: String(start), end: String(cursor), wantEnd: String(want), pieces: pieces, effects: added, notes: notes };
};

// What lies on an audio track at a time: the song's file and where it starts and ends.
LPFN.audioAt = function (a) {
    var seq = lpSeqById(a.seqId), c = lpFindClipAt(seq.audioTracks[a.track], a.startTicks), mp = '';
    if (!c) return { found: false };
    try { mp = c.projectItem.getMediaPath(); } catch (e) {}
    return { found: true, path: String(mp || ''), start: String(c.start.ticks), end: String(c.end.ticks) };
};

// Removes from an audio track every clip that is not one of the given files (what a logo clip left behind).
LPFN.cleanAudio = function (a) {
    var seq = lpSeqById(a.seqId), tr = seq.audioTracks[a.track], keep = {}, i, mp, n = 0;
    for (i = 0; i < a.keep.length; i++) keep[lpNormPath(a.keep[i])] = true;
    for (i = tr.clips.numItems - 1; i >= 0; i--) {
        mp = '';
        try { mp = tr.clips[i].projectItem.getMediaPath(); } catch (e) {}
        if (!mp || !keep[lpNormPath(mp)]) { tr.clips[i].remove(false, false); n++; }
    }
    return { removed: n };
};

// Fades a clip in over the given number of frames (opacity keyframes from its first frame).
LPFN.fadeIn = function (a) {
    var seq = lpSeqById(a.seqId), c = lpFindClipAt(seq.videoTracks[a.track], a.startTicks), F = Number(seq.timebase) || Number(LP_FRAME_FALLBACK);
    if (!c) return { done: false };
    var j, k, comp, p = null, t0, form;
    for (j = 0; j < c.components.numItems; j++) {
        comp = c.components[j];
        if (comp.matchName === 'AE.ADBE Opacity') {
            for (k = 0; k < comp.properties.numItems; k++) if (comp.properties[k].displayName === 'Opacity') p = comp.properties[k];
            if (!p) p = comp.properties[0];
        }
    }
    if (!p) return { done: false };
    if (!p.isTimeVarying()) p.setTimeVarying(true);
    t0 = Number(c.inPoint.ticks);
    form = lpAddKey(p, t0, 0, -1);
    form = lpAddKey(p, t0 + a.frames * F, 100, form);
    return { done: form >= 0 };
};

// Switches off (or on again) the clips of a track that are on screen at the given time.
LPFN.setDisabled = function (a) {
    var seq = lpSeqById(a.seqId), tr = seq.videoTracks[a.track], i, c, n = 0, notes = [];
    for (i = 0; i < tr.clips.numItems; i++) {
        c = tr.clips[i];
        if (Number(c.start.ticks) <= Number(a.atTicks) && Number(c.end.ticks) > Number(a.atTicks)) {
            try { c.disabled = !!a.disabled; n++; } catch (e) { notes.push(String(e)); }
        }
    }
    return { changed: n, notes: notes };
};

LPFN.removeClipAt = function (a) {
    var seq = lpSeqById(a.seqId), c = lpFindClipAt(seq.videoTracks[a.track], a.startTicks);
    if (c) c.remove(false, false);
    return { removed: !!c };
};

// Asks Premiere to write one frame of the sequence as a picture (QE DOM). The panel checks whether the file appears.
LPFN.grabFrame = function (a) {
    var seq = lpSeqById(a.seqId), q = lpQeSeq(seq), note = '';
    seq.setPlayerPosition(String(a.ticks));
    try {
        if (a.kind === 'jpeg') q.exportFrameJPEG(a.tc, a.path);
        else q.exportFramePNG(a.tc, a.path);
    } catch (e) { note = String(e); }
    return { cti: String(q.CTI.timecode), note: note };
};

// ---------- fades ----------

// Adds one opacity keyframe. Keyframe times are in the clip's source time (its in point is the first frame).
// The time argument differs between builds: form 0 = Time object, form 1 = seconds. Returns the form that worked, -1 if none.
function lpAddKey(p, ticks, value, form) {
    var forms = form >= 0 ? [form] : [0, 1], f, t, before, keys;
    for (f = 0; f < forms.length; f++) {
        t = forms[f] === 0 ? lpTime(ticks) : Number(ticks) / 254016000000;
        keys = p.getKeys(); before = keys ? keys.length : 0;
        try { p.addKey(t); } catch (e) {}
        keys = p.getKeys();
        if (keys && keys.length > before) {
            p.setValueAtKey(t, value, false);
            return forms[f];
        }
    }
    return -1;
}

// Writes a fade in and a fade out (a.frames each) on the lyrics of the sequence: clips a.from .. a.from + a.count - 1
// of the video track that holds the most clips. Existing opacity keyframes on those clips are replaced.
LPFN.addFades = function (a) {
    var seq = lpSeqById(a.seqId), F = Number(seq.timebase) || Number(LP_FRAME_FALLBACK);
    var tr = null, best = -1, t, i, j, k, c, comp, p, keys, n, dur, t0, pts, form = -1, done = 0, skipped = 0, notes = [];
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        if (seq.videoTracks[t].clips.numItems > best) { best = seq.videoTracks[t].clips.numItems; tr = seq.videoTracks[t]; }
    }
    var last = Math.min(tr.clips.numItems, a.from + a.count);
    for (i = a.from; i < last; i++) {
        c = tr.clips[i]; p = null;
        for (j = 0; j < c.components.numItems; j++) {
            comp = c.components[j];
            if (comp.matchName === 'AE.ADBE Opacity') {
                for (k = 0; k < comp.properties.numItems; k++) if (comp.properties[k].displayName === 'Opacity') p = comp.properties[k];
                if (!p) p = comp.properties[0];
            }
        }
        dur = Number(c.end.ticks) - Number(c.start.ticks);
        n = Math.min(a.frames, Math.floor(dur / F / 2) - 1);
        if (!p || n < 1) { skipped++; continue; }
        try {
            if (p.isTimeVarying()) {
                keys = p.getKeys();
                for (k = (keys ? keys.length : 0) - 1; k >= 0; k--) p.removeKey(keys[k]);
            } else {
                p.setTimeVarying(true);
            }
            t0 = Number(c.inPoint.ticks);
            pts = [[t0, 0], [t0 + n * F, 100], [t0 + dur - n * F, 100], [t0 + dur, 0]];
            for (k = 0; k < 4; k++) form = lpAddKey(p, pts[k][0], pts[k][1], form);
            keys = p.getKeys();
            if (keys && keys.length === 4) done++;
            else if (notes.length < 3) notes.push('lyric ' + (i + 1) + ': ' + (keys ? keys.length : 0) + ' keyframes');
        } catch (e) { if (notes.length < 3) notes.push('lyric ' + (i + 1) + ': ' + e); }
    }
    return { total: tr.clips.numItems, done: done, skipped: skipped, form: form, notes: notes };
};

// Saves the project so the file on disk matches the timeline (the panel reads lyric text from that file).
LPFN.saveProject = function () {
    app.project.save();
    return { path: String(app.project.path) };
};

// Removes what the panel added to the project: the sequences with the given names and, from the root bin a.bin, the
// song audio and the combined SRTs (a.dataDir). Anything else found in that bin stays, and then so does the bin.
LPFN.clearBatch = function (a) {
    var root = app.project.rootItem, seqs = app.project.sequences, hit = [], ours = [], srts = [], notes = [], left = [];
    var i, k, s, id, item, ch, mp, still, trash = null, removedSeqs = [], kept = 0, bin = lpFindBin(a.bin, false);
    var TRASH = a.bin + ' (deleting)', data = lpNormPath(a.dataDir);
    function exists(seqId) {
        var j;
        for (j = 0; j < app.project.sequences.numSequences; j++) if (app.project.sequences[j].sequenceID === seqId) return true;
        return false;
    }
    for (k = 0; k < a.names.length; k++) {
        for (i = 0; i < seqs.numSequences; i++) if (seqs[i].name === a.names[k]) hit.push(seqs[i]);
    }
    for (i = 0; i < hit.length; i++) {
        s = hit[i]; id = s.sequenceID; item = s.projectItem;
        removedSeqs.push(s.name);
        try { app.project.deleteSequence(s); } catch (e) { notes.push('deleteSequence: ' + e); }
        if (exists(id) && item) {
            if (!trash) trash = root.createBin(TRASH);
            try { item.moveBin(trash); } catch (e2) { notes.push('move sequence: ' + e2); }
        }
    }
    if (bin) {
        for (i = 0; i < bin.children.numItems && i < 20000; i++) {
            ch = bin.children[i];
            mp = '';
            if (ch.type !== 2) { try { mp = lpNormPath(ch.getMediaPath()); } catch (e3) {} }
            if (mp && /[.](srt|png)$/.test(mp) && mp.indexOf(data + '/') === 0) { ours.push(ch); srts.push(mp); }
            else if (mp && /[.](mp3|wav|m4a|flac|aac|ogg|aif|aiff)$/.test(mp)) ours.push(ch);
            else kept++;
        }
        if (!kept) {
            try { bin.deleteBin(); } catch (e4) { notes.push('deleteBin: ' + e4); }
        } else if (ours.length) {
            if (!trash) trash = root.createBin(TRASH);
            for (i = 0; i < ours.length; i++) { try { ours[i].moveBin(trash); } catch (e5) { if (notes.length < 5) notes.push('move: ' + e5); } }
        }
    }
    if (trash) { try { trash.deleteBin(); } catch (e6) { notes.push('deleteBin: ' + e6); } }
    for (k = 0; k < a.names.length; k++) {
        still = false;
        for (i = 0; i < app.project.sequences.numSequences; i++) if (app.project.sequences[i].name === a.names[k]) still = true;
        if (still) left.push(a.names[k]);
    }
    if (lpFindBin(TRASH, false)) left.push(TRASH);
    if (bin && !kept && lpFindBin(a.bin, false)) left.push('bin ' + a.bin);
    return { sequences: removedSeqs, items: bin ? ours.length : 0, kept: kept, hadBin: !!bin, srts: srts, left: left, notes: notes };
};

// Exports the sequence's in-to-out range straight from Premiere (no Media Encoder). Premiere is busy until it ends.
// preset: a full .epr path, or "sys:<file name>" for one of Premiere's own H.264 presets.
LPFN.exportDirect = function (a) {
    var seq = lpSeqById(a.seqId), preset = String(a.preset), f, name, tries, i;
    if (preset.indexOf('sys:') === 0) {
        name = preset.substr(4);
        tries = [String(app.path) + 'MediaIO/systempresets/4E49434B_48323634/' + name,
                 String(app.path) + '/MediaIO/systempresets/4E49434B_48323634/' + name,
                 'C:/Program Files/Adobe/Adobe Premiere Pro 2023/MediaIO/systempresets/4E49434B_48323634/' + name];
        preset = '';
        for (i = 0; i < tries.length && !preset; i++) { f = new File(tries[i]); if (f.exists) preset = f.fsName; }
        if (!preset) throw new Error('Export preset not found: ' + name);
    } else {
        f = new File(preset);
        if (!f.exists) throw new Error('Export preset not found: ' + preset);
        preset = f.fsName;
    }
    app.project.openSequence(seq.sequenceID);
    var r = seq.exportAsMediaDirect(String(a.out), preset, 1);   // 1 = in point to out point
    return { result: String(r), preset: preset };
};
