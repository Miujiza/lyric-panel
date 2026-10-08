"""Test pipeline v2: lyrics -> timed SRT using three alignment runs combined.

usage: python v2_time.py <song folder, or a folder of song folders> [song folder ...]

A song folder needs lyrics.txt and its audio (<Folder>.mp3, or vocals.wav if the vocals were already separated).
Nothing is written into the song folders. Work files go to "Pipeline Tests/out/v2_work/<song>/" and the results to
"Pipeline Tests/v2 results/": <Song>.srt and <Song>.review.json (which lyrics to check and their alternative starts).
A run that was interrupted carries on from the last finished step when started again.
"""
import json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "v2 results")
OPTS = json.dumps({"max_word_dur": 1.5, "word_dur_factor": 1.5, "nonspeech_skip": 2.0})
RUNS = [("small", "small", {}), ("small_opts", "small", {"ALIGN_OPTS": OPTS}), ("medium", "medium", {})]
AUDIO = (".mp3", ".wav", ".m4a", ".flac", ".aac")
env0 = dict(os.environ, FFMPEG="C:/ffmpeg/bin/ffmpeg", PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
env0["PATH"] = env0.get("PATH", "") + r";C:\ffmpeg\bin"
try:                                                  # no idle sleep while this runs
    import ctypes
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
except Exception:
    pass


def song_folders(args):
    out = []
    for a in args:
        a = os.path.abspath(a)
        if os.path.exists(os.path.join(a, "lyrics.txt")):
            out.append(a)
        else:
            out += [os.path.join(a, d) for d in sorted(os.listdir(a)) if os.path.exists(os.path.join(a, d, "lyrics.txt"))]
    return out


def read_lyrics(p):                                   # Notepad may have saved UTF-16 or ANSI
    raw = open(p, "rb").read()
    if raw[:2] == b"\xff\xfe":
        return raw.decode("utf-16-le").lstrip("\ufeff")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def run(cmd, cwd, log, extra=None):
    r = subprocess.run(cmd, cwd=cwd, env=dict(env0, **(extra or {})), capture_output=True, text=True, encoding="utf-8", errors="replace")
    open(log, "w", encoding="utf-8").write(r.stdout + "\n" + r.stderr)
    return r.returncode == 0


os.makedirs(RESULTS, exist_ok=True)
folders = song_folders(sys.argv[1:])
print(f"{len(folders)} songs", flush=True)
for n, src in enumerate(folders, 1):
    name, t0 = os.path.basename(src), time.time()
    work = os.path.join(HERE, "out", "v2_work", name)
    os.makedirs(work, exist_ok=True)
    if not read_lyrics(os.path.join(src, "lyrics.txt")).strip():
        print(f"{n}/{len(folders)} {name}: lyrics.txt is empty, skipped", flush=True)
        continue
    open(os.path.join(work, "lyrics.txt"), "w", encoding="utf-8").write(read_lyrics(os.path.join(src, "lyrics.txt")))
    voc = os.path.join(work, "vocals.wav")
    if not os.path.exists(voc):
        if os.path.exists(os.path.join(src, "vocals.wav")):
            try:
                os.link(os.path.join(src, "vocals.wav"), voc)
            except OSError:
                shutil.copyfile(os.path.join(src, "vocals.wav"), voc)
        else:
            audio = [f for f in os.listdir(src) if f.lower().endswith(AUDIO) and os.path.splitext(f)[0].lower() == name.lower()] or \
                    [f for f in os.listdir(src) if f.lower().endswith(AUDIO) and not f.lower().startswith(("song.", "vocals.", "no_vocals."))]
            if not audio:
                print(f"{n}/{len(folders)} {name}: no audio file, skipped", flush=True)
                continue
            shutil.copyfile(os.path.join(src, audio[0]), os.path.join(work, "song" + os.path.splitext(audio[0])[1]))
            ok = run([sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", "sep", "song" + os.path.splitext(audio[0])[1]], work, os.path.join(work, "demucs.log"))
            sep = os.path.join(work, "sep", "htdemucs", "song", "vocals.wav")
            if not ok or not os.path.exists(sep):
                print(f"{n}/{len(folders)} {name}: vocal separation failed (see demucs.log), skipped", flush=True)
                continue
            shutil.copyfile(sep, voc + ".part"); os.replace(voc + ".part", voc)
    dirs = []
    for tag, model, extra in RUNS:
        d = os.path.join(work, "run_" + tag)
        os.makedirs(d, exist_ok=True)
        if not os.path.exists(os.path.join(d, "words.json")):
            if not os.path.exists(os.path.join(d, "vocals.wav")):
                try:
                    os.link(voc, os.path.join(d, "vocals.wav"))
                except OSError:
                    shutil.copyfile(voc, os.path.join(d, "vocals.wav"))
            shutil.copyfile(os.path.join(work, "lyrics.txt"), os.path.join(d, "lyrics.txt"))
            if not run([sys.executable, os.path.join(HERE, "pipeline_opts.py"), ".", "lyrics.txt", model, os.environ.get("V2_LANG", "en")], d, os.path.join(d, "pipeline.log"), extra):
                print(f"   run {tag} failed (see its pipeline.log); carrying on without it", flush=True)
                continue
        dirs.append(d)
    if not dirs:
        print(f"{n}/{len(folders)} {name}: every run failed, skipped", flush=True)
        continue
    r = subprocess.run([sys.executable, os.path.join(HERE, "combine.py"), work, os.path.join(work, "lyrics.txt")] + dirs, env=env0, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(f"{n}/{len(folders)} {name}: combining failed: {r.stderr.strip()[-200:]}", flush=True)
        continue
    shutil.copyfile(os.path.join(work, "captions.srt"), os.path.join(RESULTS, name + ".srt"))
    shutil.copyfile(os.path.join(work, "review.json"), os.path.join(RESULTS, name + ".review.json"))
    print(f"{n}/{len(folders)} {name}: {r.stdout.strip().splitlines()[-1]} ({(time.time() - t0) / 60:.0f} min)", flush=True)
print("finished", flush=True)
