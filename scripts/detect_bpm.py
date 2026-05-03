#!/usr/bin/env python3
"""
Detect the BPM of a YouTube video's audio using onset-envelope autocorrelation.
Usage: python3 detect_bpm.py <videoId> <ytdlp_bin> [extra yt-dlp args...]
Prints a JSON object: {"bpm": 120}
"""
import sys, json, subprocess, tempfile, os, math, wave, struct


def read_wav_mono(path):
    with wave.open(path, "rb") as wf:
        n_ch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)
    total = n_frames * n_ch
    if sw == 2:
        samples = list(struct.unpack(f"<{total}h", raw))
        samples = [s / 32768.0 for s in samples]
    elif sw == 4:
        samples = list(struct.unpack(f"<{total}i", raw))
        samples = [s / 2147483648.0 for s in samples]
    else:
        samples = [b / 128.0 - 1.0 for b in raw]
    if n_ch > 1:
        mono = [sum(samples[i::n_ch]) / n_ch for i in range(n_frames)]
    else:
        mono = samples
    return mono, sr


def detect_bpm_numpy(samples, sr):
    import numpy as np
    data = np.array(samples, dtype=np.float32)

    # Downsample to ~11025 Hz for speed
    target_sr = 11025
    if sr > target_sr:
        step = sr // target_sr
        data = data[::step]
        sr = sr // step

    hop = 256
    frame_size = 1024
    n = len(data)

    # Onset strength: RMS energy difference between successive frames
    energies = np.array([
        np.sqrt(np.mean(data[s:s + frame_size] ** 2))
        for s in range(0, n - frame_size, hop)
    ])
    onset = np.maximum(np.diff(energies), 0)

    # Autocorrelation of onset envelope
    N = len(onset)
    acf = np.correlate(onset, onset, mode='full')[N - 1:]

    # Search BPM range 60–210
    min_period = max(1, int(60.0 / 210 * sr / hop))
    max_period = int(60.0 / 60 * sr / hop)

    if max_period >= len(acf):
        max_period = len(acf) - 1

    search = acf[min_period:max_period + 1]
    if len(search) == 0:
        return 120

    best_offset = int(np.argmax(search))
    best_period = best_offset + min_period
    bpm_raw = 60.0 * sr / hop / best_period

    # Try halving/doubling to stay in 70–180 range
    for factor in [1.0, 0.5, 2.0]:
        candidate = bpm_raw * factor
        if 70 <= candidate <= 180:
            bpm_raw = candidate
            break

    return int(round(bpm_raw))


def detect_bpm_pure(samples, sr):
    """Pure-Python fallback (slow)."""
    hop = 512
    frame_size = 2048
    n = len(samples)

    energies = []
    for s in range(0, n - frame_size, hop):
        frame = samples[s:s + frame_size]
        e = math.sqrt(sum(x * x for x in frame) / frame_size)
        energies.append(e)

    onset = [max(0, energies[i] - energies[i - 1]) for i in range(1, len(energies))]
    N = len(onset)

    min_period = max(1, int(60.0 / 200 * sr / hop))
    max_period = int(60.0 / 60 * sr / hop)
    max_period = min(max_period, N - 1)

    best_val = -1
    best_period = min_period
    for period in range(min_period, max_period + 1):
        val = sum(onset[i] * onset[i + period] for i in range(N - period))
        if val > best_val:
            best_val = val
            best_period = period

    bpm_raw = 60.0 * sr / hop / best_period
    for factor in [1.0, 0.5, 2.0]:
        candidate = bpm_raw * factor
        if 70 <= candidate <= 180:
            return int(round(candidate))
    return int(round(bpm_raw))


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: detect_bpm.py <videoId> <ytdlp_bin> [extra_args...]"}))
        sys.exit(1)

    video_id = sys.argv[1]
    ytdlp_bin = sys.argv[2]
    extra_args = sys.argv[3:]
    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        out_template = os.path.join(tmpdir, "audio.%(ext)s")
        cmd = [
            ytdlp_bin,
            "-x", "--audio-format", "wav",
            "--postprocessor-args", "ffmpeg:-t 30",
            "-o", out_template,
            *extra_args,
            url,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=90)
        except subprocess.TimeoutExpired:
            print(json.dumps({"error": "yt-dlp timed out"}))
            sys.exit(1)

        wav_files = [f for f in os.listdir(tmpdir) if f.endswith(".wav")]
        if not wav_files:
            err = result.stderr.decode(errors="replace")[-200:]
            print(json.dumps({"error": f"No audio produced: {err}"}))
            sys.exit(1)

        wav_path = os.path.join(tmpdir, wav_files[0])
        try:
            mono, sr = read_wav_mono(wav_path)
        except Exception as e:
            print(json.dumps({"error": f"WAV read failed: {e}"}))
            sys.exit(1)

        try:
            import numpy as _np  # noqa: F401
            bpm = detect_bpm_numpy(mono, sr)
        except ImportError:
            bpm = detect_bpm_pure(mono, sr)

        bpm = max(60, min(220, bpm))
        print(json.dumps({"bpm": bpm}))


if __name__ == "__main__":
    main()
