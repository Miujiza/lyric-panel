"""Lyric timing, three runs combined: vocals.wav + lyrics -> captions.srt, words.json, review.json.

usage: python pipeline_v2.py <song_dir> <lyrics.txt> [lang]

Runs pipeline_run.py three times (Whisper small, small with tighter alignment settings, medium), each in its own
folder under <song_dir>/runs/, then combine.py takes the middle start for every lyric line and writes the result
into <song_dir>. A run whose words.json already exists is not repeated, so a stopped job carries on where it was.
Prints "STEP <n> <of> <what>" lines for the panel's progress display.
"""
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
song, lyr = os.path.abspath(sys.argv[1]), sys.argv[2]
LANG = sys.argv[3] if len(sys.argv) > 3 else "en"
OPTS = json.dumps({"max_word_dur": 1.5, "word_dur_factor": 1.5, "nonspeech_skip": 2.0})
RUNS = [("small", "small", {}), ("small_opts", "small", {"ALIGN_OPTS": OPTS}), ("medium", "medium", {})]
lyr = lyr if os.path.isabs(lyr) else os.path.join(song, lyr)
voc = os.path.join(song, "vocals.wav")
if not os.path.exists(voc):
    raise SystemExit("vocals.wav is missing")

dirs = []
for n, (tag, model, extra) in enumerate(RUNS, 1):
    print(f"STEP {n} {len(RUNS) + 1} timing run {n} of {len(RUNS)}", flush=True)
    d = os.path.join(song, "runs", tag)
    os.makedirs(d, exist_ok=True)
    # a run belongs to the lyrics it was made from: changed lyrics mean the run is done again
    same = os.path.exists(os.path.join(d, "lyrics.txt")) and open(os.path.join(d, "lyrics.txt"), "rb").read() == open(lyr, "rb").read()
    if not (same and os.path.exists(os.path.join(d, "words.json"))):
        for f in ("words.json", "free.json", "captions.srt"):
            if os.path.exists(os.path.join(d, f)):
                os.remove(os.path.join(d, f))
        if not os.path.exists(os.path.join(d, "vocals.wav")):
            try:
                os.link(voc, os.path.join(d, "vocals.wav"))        # a link, not a copy: takes no extra space
            except OSError:
                shutil.copyfile(voc, os.path.join(d, "vocals.wav"))
        shutil.copyfile(lyr, os.path.join(d, "lyrics.txt"))
        with open(os.path.join(d, "pipeline.log"), "w", encoding="utf-8") as log:
            r = subprocess.run([sys.executable, os.path.join(HERE, "pipeline_run.py"), ".", "lyrics.txt", model, LANG],
                               cwd=d, env=dict(os.environ, **extra), stdout=log, stderr=subprocess.STDOUT)
        if r.returncode != 0 or not os.path.exists(os.path.join(d, "words.json")):
            print(f"run {tag} failed (see runs/{tag}/pipeline.log); carrying on without it", flush=True)
            continue
    dirs.append(d)
if not dirs:
    raise SystemExit("every timing run failed")
print(f"STEP {len(RUNS) + 1} {len(RUNS) + 1} combining the runs", flush=True)
for f in ("captions.srt", "review.json"):
    if os.path.exists(os.path.join(song, f)):
        os.remove(os.path.join(song, f))
r = subprocess.run([sys.executable, os.path.join(HERE, "combine.py"), song, lyr] + dirs)
sys.exit(r.returncode)
