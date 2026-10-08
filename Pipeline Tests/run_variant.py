"""Runs one pipeline variant over the benchmark songs without touching the song folders.

usage: python run_variant.py <variant name> <whisper model> [pipeline script]

Output goes to bench/out/<variant>/<song>/ (vocals.wav is hard-linked in, not copied). Songs that already have
a words.json there are skipped, so an interrupted run can simply be started again. Score with score.py.
"""
import json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
SONGS = r"C:\Users\HP\Downloads\Lyrics\Rock Tunes"
variant, model = sys.argv[1], sys.argv[2]
script = os.path.join(HERE, sys.argv[3]) if len(sys.argv) > 3 else os.path.join(HERE, "pipeline_current.py")   # a copy: the panel's real pipeline is never run or changed from here
env = dict(os.environ, FFMPEG="C:/ffmpeg/bin/ffmpeg", PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
env["PATH"] = env.get("PATH", "") + r";C:\ffmpeg\bin"
songs = sorted(set(k["song"] for k in json.load(open(os.path.join(HERE, "key.json")))))
if os.environ.get("BENCH_SONGS"):                     # "silent|eurythmics|burn": only these, in this order
    songs = [s for f in os.environ["BENCH_SONGS"].split("|") for s in songs if f.lower() in s.lower()]
try:                                                  # keep Windows from idle-sleeping while this process runs (ends with the process)
    import ctypes
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
except Exception:
    pass
for n, s in enumerate(songs, 1):
    src, out = os.path.join(SONGS, s), os.path.join(HERE, "out", variant, s)
    if os.path.exists(os.path.join(out, "words.json")):
        continue
    os.makedirs(out, exist_ok=True)
    # VOCALS_FROM=sep-roformer: take the vocals from out/sep-roformer/<song>/ instead of the song folder's Demucs vocals
    voc = os.path.join(HERE, "out", os.environ["VOCALS_FROM"], s, "vocals.wav") if os.environ.get("VOCALS_FROM") else os.path.join(src, "vocals.wav")
    if not os.path.exists(os.path.join(out, "vocals.wav")):
        try:
            os.link(voc, os.path.join(out, "vocals.wav"))
        except OSError:
            shutil.copyfile(voc, os.path.join(out, "vocals.wav"))
    shutil.copyfile(os.path.join(src, "lyrics.txt"), os.path.join(out, "lyrics.txt"))
    t = time.time()
    try:
        r = subprocess.run([sys.executable, script, ".", "lyrics.txt", model, "en"], cwd=out, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5400)
        open(os.path.join(out, "pipeline.log"), "w", encoding="utf-8").write(r.stdout + "\n" + r.stderr)
        ok = "ok" if r.returncode == 0 else "FAILED"
    except subprocess.TimeoutExpired:
        ok = "TIMED OUT"
    print(f"{n}/{len(songs)} {s[:40]}: {ok} in {time.time() - t:.0f}s", flush=True)
print("finished", flush=True)
