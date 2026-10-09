# Lyric Panel: handoff (rewritten 2026-10-08, v2 added 2026-10-09)

Read this first. It replaces the chats that built the panels and tested the lyric timing.

## Start here: two panels (state at the end of 2026-10-09)

There are now TWO separate panels in Premiere's Window > Extensions menu. Always check which one the user means.

| | **Lyric Panel v1** | **Lyric Panel v2** |
|---|---|---|
| Code | `LyricPanel\` | `LyricPanel2\` |
| Where lyrics and timing come from | the user's lyrics.txt + three Whisper runs on this PC (about 30 min per song) | lrclib.net: text and line times downloaded in seconds |
| Songs folder | one sub-folder per song | flat: mp3 files directly in the folder, SRT next to each |
| Status | confirmed working (2026-10-08) | fetch, build and fades confirmed by the user on 2026-10-09 (TikTok Melody, 3 songs); the last round of changes is untested (see the v2 section) |

The intended workflow: v2 first for a folder of mp3s; whatever LRCLIB does not have is moved to `Not found\` inside that folder and goes through v1. Both panels share the settings and add to the same two sequences. Sections below: shared facts, then "How the panel works" (= v1), then the v2 section.

## Who and what

The user (not a developer, dictates messages by voice) makes lyric videos in Premiere Pro for 5 channels, about 150 songs a month. Projects live in `C:\Users\HP\Documents\01_Projects\` (Rock Tunes, Rock Vivo, Brit Tunes, Dance Pilot, TikTok Melody); each channel's assets are in `C:\Users\HP\Documents\<Channel>\` (Assets, Backgrounds, Videos = finished exports, Thumbnails). Three channels use image backgrounds, two (Rock Vivo, Brit Tunes) use video backgrounds.

Goal: a Premiere panel ("Lyric Panel") where they pick a folder of song folders and it builds everything, so they only scrub, fix, and export. They want to share or sell it later.

## Environment

- Windows 10, Premiere Pro **23.3.0**, Media Encoder 2023 (asks for a login the user does not have: never rely on it), no After Effects. CEP panels only (no UXP in 23.x).
- No Node.js on the PATH. Python 3.14 (`%LOCALAPPDATA%\Python\bin\python.exe`, else `python`). ffmpeg/ffprobe in `C:\ffmpeg\bin`.
- CPU only for the models (Quadro M1000M is not usable): stable-ts 2.19 + openai-whisper, Demucs 4, torch 2.13. Whisper `small.pt` and `medium.pt` are in `~/.cache/whisper`; the Demucs model is in the Hugging Face cache.
- Unsigned panels are allowed (`HKCU\Software\Adobe\CSXS.11\PlayerDebugMode = 1`, set by the user).
- About 27 GB free on C: (2026-10-08).

## Files

```
C:\Users\HP\Downloads\AI\Lyric Test\
  LyricPanel\
    install\            loader + manifest; copied to %APPDATA%\Adobe\CEP\extensions\LyricPanel
    js\main.js          the whole panel (UI + logic), loaded at runtime from this folder
    jsx\host.jsx        ExtendScript functions (LPFN.*), re-evaluated on every call
    bin\menu_tool.ps1   fires Premiere menu commands (dump / id / keys modes)
    pipeline\           lyrics -> SRT. Used by the panel: pipeline_v2.py, pipeline_run.py, combine.py.
                        pipeline.py = the old single-run script, unused, kept as the fallback. The .sh / qa.py files are old helpers.
    _tmp\               args/result json for each host call, panel_log.txt, check.html (browser preview stub),
                        backups main.before-*.js / host.before-*.jsx from 2026-10-08 (safe to delete once things are stable)
  LyricPanel2\          Lyric Panel v2 (see its section): install\, js\main.js, js\lrc.js, jsx\host.jsx, bin\, _tmp\ (own log and check.html)
  .git, .gitignore      version history; pushed to the private GitHub repo https://github.com/Miujiza/lyric-panel (see "Working notes")
C:\Users\HP\Downloads\Lyrics\<Channel>\    the song folders (the user moved them here on 2026-10-08):
                        <Song>\<Song>.mp3, <Song>.srt, lyrics.txt, vocals.wav, words.json, runs\, logs
C:\Users\HP\Documents\Lyric Library\       SRTs saved from the timeline after the user's corrections
                        Pipeline Tests\   the timing benchmark, moved here by the user (see "Lyric timing accuracy")
                        LRCLIB Test\      the Python test scripts and SRTs from 2026-10-09 that led to v2 (lrclib_time.py = three runs guided by
                                          LRCLIB, --direct = LRCLIB times as they are, lrclib_scaled.py = sped-up song from the original's entry,
                                          run_three.py, combine_lrclib.py, out\). Not in git (lyric text). Not used by either panel.
```

The installed loaders hard-code `DEV = "C:/Users/HP/Downloads/AI/Lyric Test/LyricPanel"` (v1) and `.../LyricPanel2` (v2). Editing `js/main.js` or `jsx/host.jsx` needs only closing and reopening the panel (Window > Extensions > Lyric Panel); a manifest change needs a Premiere restart.

Panel data: `%APPDATA%\LyricPanel\` (`<Project>.json` settings, `<Project>.batches.json`, temp combined SRTs). `Rock Tunes.json` and `Rock Tunes_1.json` still point at the old songs folder (`Lyric Test\Rock Tunes`, which no longer exists): the user just picks the folder again.

Settings are per project file. A project with no settings file borrows from a same-channel file (`Rock Tunes_1` <-> `Rock Tunes`, trailing `_N` ignored). A channel with none starts with blank lyric font/size (`textSet` false) and Build refuses until they are filled in, so one channel's font is never used to wrap another's lyrics. The Lyric text card is locked once set, with an Edit checkbox to unlock; the font is a dropdown of installed Windows fonts; a small frame preview shows the max row width with a sample line wrapped the way a build would.

## How the panel works (Lyric Panel v1; v2 shares everything from Build step 3 on, and the Settings and Export tabs)

Changes made to v1 on 2026-10-09, none of them tested by the user in Premiere yet: menu name "Lyric Panel v1" (manifest); Build / Add fades / Save SRTs / Export re-read the shared batch file first, and Build re-reads `bgNext` (so v1 and v2 can add to each other's batch); the font dropdown also takes the real family names from Windows (PowerShell `InstalledFontCollection`), because the registry lists some fonts by file label ("BaksoSapi" for "Bakso Sapi"); `LPFN.placeOverlay` handles an overlay that sits inside a nest in the template (see v2 section). `git diff v1.0 -- LyricPanel` shows exactly these.

**Build tab**

1. Scan the songs folder. A song is READY when it has an audio file (`<Folder>.mp3`, else the only audio that is not `song.*`/`vocals.*`) and an SRT (`<Folder>.srt`, else `captions.srt`). Loose audio files are counted too. A notice appears only when something is missing: Sort into folders / Create lyrics files (makes `<Song>\`, moves the mp3 in, creates an empty lyrics.txt); chips say NEEDS LYRICS (click opens lyrics.txt in Notepad), NEEDS SRT, or UNFINISHED.
2. **Create timing** (for ticked NEEDS SRT / UNFINISHED songs), per song: `python -m demucs` (skipped if vocals.wav exists; afterwards the panel deletes its own `sep\` folder and `song.mp3`), then `pipeline\pipeline_v2.py . lyrics.utf8.txt <lang>` with the song folder as cwd, result copied to `<Song>.srt`. `pipeline_v2.py` runs `pipeline_run.py` three times (Whisper small; small with `ALIGN_OPTS` max_word_dur 1.5, word_dur_factor 1.5, nonspeech_skip 2.0; medium) in `<Song>\runs\<tag>\` (vocals hard-linked; a run is redone only if the lyrics changed), then `combine.py` takes, per lyric line, the middle start of the runs after the stretched-first-word rule (a first word longer than 1.0 s starts 0.35 s before its end) and builds captions exactly as pipeline.py does. It prints `STEP n of what`, which the panel shows as the step text. About 30 minutes per song, 50 with Premiere open (measured once). Interruptions: a `timing.busy` marker (with the python pid) sits in the song folder until `<Song>.srt` is renamed into place; vocals.wav and the SRT appear only via rename, finished runs are kept, so a stopped job resumes. The notice button is Stop while running (taskkill of the process tree); closing the panel kills the child. Language is detected per song from the lyrics (`detectLang`); there is no language setting.
3. **Build**: find sequences named **`Lyric Panel Lyrics`** and **`Lyric Panel Main`**. Both exist: add the ticked songs after the last one. Neither: clone the Lyrics template and Main template and empty both clones. Only one: stop with a message. Songs already in the batch are skipped.
4. Lyrics sequence: song audio on A1, back to back with the gap (default 20 s).
5. One combined SRT for the new songs: times offset to each song's slot, snapped to 23.976 frames, shifted **+1 frame** (Premiere 23.3 places SRT cues one frame early), rows re-wrapped by real pixel width of the channel font (canvas `measureText`), lyrics needing more than 2 rows split into two screens (time shared by text length).
6. `createCaptionTrack`, then the upgrade: switch to another open timeline and back (gives the timeline keyboard focus), `Edit > Select All`, confirm via `isSelected()`, fire `Graphics and Titles > Upgrade Caption to Graphic`. Retries up to 3 times. Then remove empty video tracks (QE), hide caption tracks.
7. Verify every graphic start/end against the expected frame; set an approximate vertical position (Vector Motion).
8. Main sequence: overlay per song (optional, look copied from a template clip of the same file), one background per song from the Backgrounds bin (natural sort, cycle continues across batches via `bgNext`), then clear the lyric track and all audio and place the Lyrics sequence as a nest with its audio on A1.
9. Leave the new lyric graphics selected. **The user then applies their text style by hand**, and adjusts lyric timing by hand.

**Settings tab**: Lyrics template, Main template (auto-picked), main-sequence tracks for backgrounds / lyrics / overlay, backgrounds bin, next background, overlay video, gap, font, size, all caps, max row width.

**Export tab**
- **Add fades** (`addFades`, `LPFN.addFades` / `lpAddKey`): writes 4 keyframes on each lyric's own Opacity (0 at start, 100 after 6 frames, 100 at 6 frames before the end, 0 at the end; `FADE_FRAMES = 6`) on the video track of `Lyric Panel Lyrics` with the most clips, 40 clips per host call, replacing any opacity keyframes already there, so it is re-run after trimming. No selection needed. Keyframe times are the clip's in point + offset (source time); `addKey` takes a Time object (form 0). Confirmed by the user in Premiere 2026-10-08 (fade in and fade out both fine).
- **Save SRTs** (`saveSrts`, `readProjectLyrics`, `LPFN.saveProject`): saves the project, reads lyric text and times from the `.prproj`, writes one SRT per song (times from the song start) to the folder in "Save SRTs to" (`settings.srtDir`, default `Documents\Lyric Library`). Song folders are never touched. Confirmed working 2026-10-07 and 2026-10-08.
- **Export**: `sequence.exportAsMediaDirect(out, preset, 1)` straight from Premiere, one ticked song after another, written as `<Song>.part.mp4` and renamed when done; songs whose mp4 exists show EXPORTED. Save folder defaults to `Documents\<Channel>\Videos`. One song confirmed by the user on 2026-10-07.

Unwired code still in the files: `centerLyrics` / `LPFN.exportFrame` (failed in Premiere: "Premiere did not write the test frame"), `LPFN.playhead`, `setPlayhead`, `addMarkers`, `moveLyricStart` (from the removed review tools; all four worked in Premiere).

## Lyric Panel v2 (LRCLIB), built 2026-10-09

A second panel in `LyricPanel2\` (own `install\`, `js\main.js`, `js\lrc.js`; `jsx\host.jsx` and `bin\` are copies of v1's and must be kept identical to v1's), installed as `%APPDATA%\Adobe\CEP\extensions\LyricPanel2` (bundle id `com.lyric.panel2`, menu "Lyric Panel v2"). It was generated from v1's main.js with the whole "song folder" part (tidy, Demucs, Whisper, lyrics.txt, language detection) replaced by an LRCLIB block; from Build step 3 onward, and on the Settings and Export tabs, the code is v1's. It needs no Python. git tag `v1.0` = v1 before v2 existed.

**Why it exists (measured 2026-10-09):** lrclib.net is a free, key-less, volunteer-made database of line-timed lyrics. All 25 songs of Rock Tunes and Rock Vivo were on it with the right length. On the 16-song answer key, LRCLIB line times used as they are gave 3 lyrics more than 1 s off (v1's three runs: 15) and 69 of the 81 moved lyrics within 0.3 s (v1: 54); the run candidate nearest to the LRCLIB time gave 1 and 64. The user then approved three test SRTs in Premiere (English guided, Spanish direct, sped-up scaled from the original) and asked for the plugin. Coverage is thinner for Spanish rock and for sped-up / slowed / live versions: each version is just a separate upload, present only if someone made it.

**Shared with v1 (user's decision):** the data folder `%APPDATA%\LyricPanel` (same per-project settings file; v2 keeps its own folder in `songsDir2`) and the two sequences `Lyric Panel Lyrics` / `Lyric Panel Main`. Both panels re-read the batch file before Build / Add fades / Save SRTs / Export and `bgNext` before Build.

**Build tab flow**
1. Folder layout is flat: `<Artist - Title>.mp3` directly in the picked folder, `<same name>.srt` beside it once fetched. Sub-folders are ignored. A file with no " - " in its name gets a red chip and is left alone.
2. Scan, then every mp3 without an SRT is looked up, one after another (`lookup`): the mp3's length is measured by decoding it in the panel (`decodeAudioData`; ffprobe only as fallback), then three searches (`/api/search` by track + first artist, by full title, by free text); if nothing matches, the name is tried as `Title - Artist`. LRCLIB answers 503 now and then: each request retries after 1.5 / 3 / 6 s. Results are cached while the panel is open; the refresh button clears the cache and asks again.
3. Chips: ON LRCLIB, ON LRCLIB (STRETCHED), LYRICS ONLY, NOT FOUND (hover shows why, e.g. the lengths LRCLIB has), NO CONNECTION, READY, IN BATCH, CHECKING.
4. ONE main button, bottom right (`nextStep`): "Checking LRCLIB" (disabled) -> "Fetch SRTs" when a found song is ticked -> `Move to "Not found"` when nothing is fetchable but something is missing -> "Build". The yellow notice above the list only informs. Found songs are ticked automatically; only ticked ones are fetched.
5. Fetch (`fetchSrts`): writes the SRT next to each ticked found song (flag `wx`, never overwrites) and moves every NOT FOUND / LYRICS ONLY mp3 into `Not found\`; a LYRICS ONLY song also gets its untimed lyrics as `<name>.txt` there, which v1's "Sort into folders" turns into lyrics.txt. Songs with NO CONNECTION are never moved.
6. Build: v1's code unchanged.

**Match rule (`LRC.decide` in lrc.js):** same artist (any one artist in common after splitting on , & x feat y con and), same title, same version words, length within 2 s of the mp3, at least 3 timed lines; the nearest length wins. Titles are compared without capitals, accents and punctuation (`analyse`): version words (live / en vivo / directo, remix, sped up / nightcore, slowed / reverb, acoustic, instrumental, demo, cover) are read only from brackets or a " - " tail (so "Live Fast Die Numb" is not a live song) and must agree on both sides; remaster, feat, year, version, edit and similar are ignored; other bracket text is part of the title but a title also matches without it. A live mp3 also accepts an entry whose ALBUM says live. A sped-up or slowed mp3 with no entry of its own uses the normal version: times x (mp3 length / original length), original length = the most common length among the uploads, preferring lengths that are not whole seconds (those were read from real files). Same-title entries of another length are never used: that is what keeps same-named different songs out (the user's example: several "Lentas Nubes de Fuego" entries of different lengths).

**LRC -> SRT (`LRC.toCues`):** v1's caption rules (start 6 frames before the line, two lines of at most 46 characters share a screen if the gap is 2 s or less, a lyric ends 11 frames before the next, holds at most 4 s into a break, last one +1.4 s). LRCLIB has only line starts, so a line's sung end is LRCLIB's own empty end mark when there is one (then the lyric goes 0.5 s later), else a guess: words x the song's own seconds-per-word (the quicker third of "seconds to next line / words", 0.25 to 1.5), capped at the next line. With that guess the Spanish test song came out as 13 two-row screens like the approved SRT; with a fixed rate it was 24 single rows. Lines are cleaned like v1's lyrics (one-word ad-libs in brackets dropped, an ad-lib-only line dropped). Output is frame-snapped like v1's captions.srt.

**Export tab additions (v2 only):** after a successful run Add fades / Save SRTs turn green and read "Fades added" / "SRTs saved" (`renderActions`); the state is stored in the batch record (`fadesFor` / `srtsFor` = song count:lyric count) so a build that adds songs resets it. They stay clickable (fades must be redone after a trim). All action buttons are disabled while anything runs.

**Overlay inside a nest (both panels' host.jsx, `lpFindNestOfItem`):** if the chosen overlay video is not directly in a template but a nest in the template contains it (the user's TikTok Melody template has "Dust (Nest)"), that nest is placed over each song with the nest clip's motion, opacity and blend mode. Before this the build said the overlay was not in the templates and used normal blending.

**What the user has confirmed in Premiere (2026-10-09, TikTok Melody, 3 songs):** scan and chips, Fetch SRTs, the move to Not found, Build (93 lyrics, all on the exact frame), Add fades. **Written after that test and NOT yet seen by the user:** the single main button and automatic ticks, the green done-state, the overlay-nest fix, the Bakso Sapi font fix (Windows does report "Bakso Sapi"; the dropdown was not seen).

**Known weak spots:** LRCLIB text is volunteers' (typos, extra intro or ad-lib lines, other line breaks than the user's own lyrics; the "i'm yours" entries have a line at about 1 s the user's lyrics lack); a well-formed entry with wrong times cannot be detected (one Rock Tunes entry ran 0.4 s early throughout); the mp3 must be the released cut (a rip with a longer intro fails the length check, which is the wanted behaviour); "Megara - Truco o trato" has entries of 4:00 and 4:03 although the user did not find it on the site.

## Verified facts about Premiere 23.3 scripting

- Captions to graphics has no API. It works by posting `WM_COMMAND` with the native menu item id (looked up by name each time). It crashes Premiere if fired while the Program Monitor has focus, and silently does nothing if the CEP panel has focus.
- `Window > Timelines > <seq>` does not move focus when that sequence is already frontmost; switching to another timeline first does. Shift+3 via SendKeys did not work.
- Upgraded graphics always land on a **new top video track**. Hence the lyrics-only sequence nested into the main sequence. When adding to an existing batch they landed on the existing V1.
- Graphic/MOGRT **text cannot be read or written** by script. It is readable from the saved `.prproj` (gzip XML): Sequence -> track groups -> tracks -> track items -> component chain -> `AE.ADBE Text` component -> param 0 `StartKeyframeValue` (base64 flatbuffer: root -> field 0 -> field 0 = layer list, layer field 0 = string, rows separated by `\r`); a repeated value is stored once and referenced by `BinaryHash`.
- A **text style cannot be applied by script**. Untested ideas: caption Track Style inheritance, a styled caption track in the template, TTML import with styling.
- A graphic made from a caption has a source length of about 5 s (119 frames, in point at 1:00:00 source time) whatever its timeline length; trimming an edge moves the source point by the trimmed amount only. So an effect preset saved with "Anchor to Out Point" puts its keyframes in the wrong place (this is why the user's Opacity Out preset failed and "clipped to five seconds"); "Anchor to In Point" works.
- Opacity keyframes can be written: `prop.setTimeVarying(true)`, `prop.addKey(Time)`, `prop.setValueAtKey(Time, value, updateUI)`, `getKeys()`, `removeKey()`, with times in source time (clip in point + offset).
- `clip.start` and `clip.end` can be set (setting start keeps the end if it is put back afterwards). Sequence markers: `seq.markers.createMarker(seconds)`, `.name`. `getPlayerPosition()` / `setPlayerPosition(ticks string)` work.
- Caption tracks can't be read or deleted by script (`captionTracks` undefined); only hidden via the menu.
- QE works: `addTracks(n, afterIndex, 0)`, `removeEmptyVideoTracks()`.
- `track.overwriteClip(item, TimeObject)` works. A video placed on V(n) brings its audio to A(n); `sequence.overwriteClip(item, time, vIdx, aIdx)` controls the audio track (used for the nest).
- Motion/Opacity/blend-mode copy via `component.properties[i].setValue`, Vector Motion position (normalised 0..1), `setSelected`, `isSelected`, `sequence.clone()`, `setInPoint`/`setOutPoint` are all usable.
- A stuck ExtendScript (infinite loop) blocks every later call until Premiere restarts. Keep loops bounded and calls short.
- ExtendScript has no JSON: host.jsx has its own stringify and uses `eval` to parse the args file. Arguments and results travel as UTF-8 files, never as strings built into the script (names contain `'`, `&`, accents).

## Decisions the user made

- One batch per project, always the two fixed sequence names; no batch dropdown. To start over they delete or rename the two sequences.
- Main sequence gets only backgrounds, the lyrics nest, the overlay, and audio on A1. Logo, intro and title are added by the user. Templates are guides only and are never modified.
- No per-song intro/title. No lyric position sliders: lyrics must always be centered automatically.
- Fades: the panel's **Add fades** button, 6 frames in and 6 out (2026-10-08; replaces the earlier "I apply my own presets").
- Lyric timing: the three-run timing is in the plugin (2026-10-08). The user adjusts wrong lyrics by hand. They had markers on unsure lyrics, a "Next marked lyric" button and a "Try other start" button built, tried them once, and asked for all three to be removed ("most of them were fine", "I'll just adjust everything myself"). Do not bring review tools back unless asked.
- Save SRTs goes to a folder they pick; the SRTs in the song folders must stay untouched.
- Export: one click exports every ticked song straight from Premiere.
- UI: dark, compact, tabbed; fields are browse buttons and dropdowns, not typed paths.
- Two panels (2026-10-09): the old one is "Lyric Panel v1", the LRCLIB one "Lyric Panel v2"; they share settings and the two sequences. In v2, songs LRCLIB does not have are moved automatically to a `Not found` sub-folder; the main folder holds only mp3 + SRT pairs. Live songs need a live entry or go to Not found. Sped-up / slowed songs without their own entry use the original's timing, stretched.
- Buttons (2026-10-09): one main button per tab that is "whatever has to be done next", not two buttons for two steps; a button that has done its job must look done and not invite a second click.
- When testing something new and slow, try it on ONE song first and review it with them before running more. Do not edit the panel files when they asked for a test version elsewhere (they stopped an edit once for this).

## Lyric timing accuracy (work of 2026-10-07 and 2026-10-08, finished for now)

The user corrected all 16 Rock Tunes songs by hand and saved them to the Lyric Library; that is the answer key (406 lyric starts, 81 of them moved by the user). The user moved the `Pipeline Tests\` folder out of the project on 2026-10-08 (testing is finished, they want the project clean); it now lives, complete with its `out\` results, at `C:\Users\HP\Documents\Lyric Library\Pipeline Tests\` and runs from there (the scripts find their own folder via `__file__`). The scripts and `key.json` are also in git commit `6f12602`; the `out\` results are not in git (lyric text) and would need about a day of computing to recreate. Do not move it back into the project. What the benchmark is: `key.json` (first-word index + corrected start per lyric; made by `make_key.py`), `run_variant.py <name> <model> [script]` (writes to `out\<name>\`, never touches song folders, resumable, `BENCH_SONGS` to limit songs, `VOCALS_FROM` for other vocals), `score.py`, `score_rule.py` (with and without the rule), `ensemble_test.py` (combining variants), `pipeline_current.py` (copy of the old pipeline), `pipeline_opts.py` (= the plugin's `pipeline_run.py`), `combine.py` / `v2_time.py` / `v2_bench.py` (the test version of what is now in the plugin), `out\small-opts`, `out\medium`, `out\v2`, `out\rms`. The scripts point at `C:\Users\HP\Downloads\Lyrics\Rock Tunes` and still run (checked 2026-10-08).

Only two measures are trustworthy: lyrics more than 1 s off, and how many of the 81 moved lyrics land within 0.3 s. For the 325 untouched lyrics the key only says the old position was acceptable (the user tolerates a lyric a little early and corrects one 0.1 s+ late), so any other method looks worse there than it is. One-song results are noise.

| Method (16 songs) | More than 1 s off | Of 81 moved, within 0.3 s |
|---|---|---|
| Old pipeline (Whisper small, one run) | 32 | 22 |
| + stretched-first-word rule | 22 | 43 |
| Whisper medium + rule (4x slower) | 17 | 47 |
| Whisper small with tuned align options + rule | 19 | 51 |
| **Three runs (small, small tuned, medium), middle start + rule = now in the plugin** | **15** | **54** |
| Always the nearest of the runs' candidate starts (not achievable automatically) | 0 | 68 |

Tried and dropped (all removed from disk): Whisper large-v3 (about 50 min/song, marginal gain), stable-ts refine (no gain, 33 min/song), torchaudio MMS_FA CTC aligner whole-song and windowed (reads singing poorly, 59% within 0.3 s), HubertFA singing aligner (Apache-2.0, fast, but worse than Whisper alone and no help in the mix), SingAlign (code repo does not exist), MDX Kim_Vocal_2 separation (no change), BS-RoFormer separation (2 h/song on this CPU), loudness onsets, and judges / a trained chooser to pick among the candidate starts (none beat the middle value).

What the remaining misses are: mostly line starts inside unbroken singing, 0.3-0.7 s late or early; not lyrics that differ from what is sung. The stretched-first-word rule is two-sided (of 113 stretched first words the real start is near the end in 47, at the beginning in 37). The right start is among the runs' candidates for 97% of lyrics, but nothing was found that picks it. Other findings from the user's corrections that were never acted on: the panel splits a long lyric into two screens by text length and the user moved 35 of 68 split points (use `words.json` word times instead); the user extended 44 lyric ends to touch the next lyric and cut 37 shorter (the 11-frame gap / 4 s hold rule in the pipeline does not match what they do).

On the first fresh song timed with the three-run method (Dance Pilot, 2026-10-08) the user left 13 of 16 starts untouched and changed the text of the other 3; it is not known whether they reviewed every lyric.

## Not done yet (rough priority)

v2 first (the user is actively testing it):
- a. Get the user's verdict on the 2026-10-09 last round (single main button, green done-state on Add fades / Save SRTs, overlay nest). Open question put to the user: should the green buttons lock completely with a "Redo" tick box.
- b. v2 lyric END times are estimated and were not reviewed by the user on their own; ask how lyrics disappear before instrumental breaks.
- c. Stretched (sped-up / slowed) songs in the panel use the length ratio only; the Python test fitted the speed against a Whisper run and was approved on one song. Not verified in the panel.
- d. A line where LRCLIB has an extra first word, extra intro / ad-lib lines in LRCLIB text, and wrong-but-plausible entries are not handled.
- e. Not tested at all in v2: Save SRTs, Export, a second build added to an existing batch, v1 and v2 building into the same batch, Rock Vivo / Brit Tunes (video backgrounds).
- f. Commit: everything up to the end of 2026-10-09 is committed and pushed (see git log); commit again after the next confirmed round.

v1 and general:

0. Set up and test the other channels: Dance Pilot was built once on 2026-10-08 (font Titan One); a video-background channel (Rock Vivo, Brit Tunes) has not been built with the panel yet.
1. Automatic centering needs a new approach (frame export failed).
2. Written but never confirmed by the user: Stop / Continue timing after an interruption with the three-run script, UNFINISHED state, language detection on a mixed-language song, export interruption recovery, exporting more than one song in a row.
3. Reuse SRTs from the Lyric Library on scan (match name plus audio length within 1 s).
4. Split long lyrics by word timings; review the 72% row-width default; revisit the lyric-end rule (see above).
5. Automate the text style if any route works.
6. Packaging: remove the hard-coded DEV path, bundle the pipeline runtime, sign the panel, Windows-only menu trigger, menu names differ by Premiere version/language.
7. Space: `vocals.wav` (about 40 MB per song) stays in every song folder; it is only needed to re-time a song.

## Working notes for the next session

- Git (set up 2026-10-08): the project folder is a git repo, branch `main`, remote `origin` = the user's private GitHub repo `Miujiza/lyric-panel`; sign-in is stored by Git Credential Manager, `gh` is not installed. The user does not run git: commit and push at the end of a session once something is confirmed working, instead of making `*.before-*` copies. `core.autocrlf` is off so files are never altered. Never add audio, song folders, anything containing lyric text, or `_tmp` logs (see `.gitignore`).

- No Node: to check `main.js`, serve `LyricPanel\` (or `LyricPanel2\`) with `python -m http.server` through a temporary `.claude\launch.json` (`runtimeExecutable` = the python.exe path, args `-m http.server <port> --directory LyricPanel2`) + the Browser pane's preview_start, open `/_tmp/check.html` (fake `req`, `cep`, `__adobe_cep__`) and read `window.__errors`; delete the launch.json afterwards. The v2 stub makes real LRCLIB requests (about 40 s for its 12 fake songs) and its fake file system records moves in `window.__moved`; `LRC.toSrt(...)` can be called directly from the page to test a conversion. Opening the file directly only gives a static snapshot.
- Bash heredocs on this machine eat backslashes. For multi-line patches, write a `.py` file with the Write tool and run it.
- Read `LyricPanel\_tmp\panel_log.txt` (v1) or `LyricPanel2\_tmp\panel_log.txt` (v2; read it as UTF-8) after each user test instead of asking them to paste logs. To check what really happened on the timeline, read the saved `.prproj` (the user must have saved after the action; compare file time with the log time).
- The user tests by hand in Premiere: one change set per round, tell them exactly what to click, ask for a screenshot. They must not touch Premiere during a build.
- Long runs: start them in the background; a foreground `sleep` is blocked. Stopping a background task does not always kill its python children: check with `Get-CimInstance Win32_Process` and stop leftovers.
- Do not print song lyrics in chat (earlier sessions were flagged for it).
- Registry edits are theirs to run; don't make them.
