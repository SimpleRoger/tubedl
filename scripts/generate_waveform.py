#!/usr/bin/env python3
"""
Generate waveform peak data from a YouTube video's audio.
Usage: python3 generate_waveform.py <videoId> <ytdlp_bin> [extra yt-dlp args...]
Prints JSON: {"peaks": [0..1, ...], "durationSec": X}
peaks array has ~2 values per second of audio (0.5s resolution).
"""
import sys, json, subprocess, tempfile, os, wave, struct, math


def read_wav_mono(path):
    with wave.open(path, "rb") as wf:
        n_ch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    try:
        import numpy as np
        if sw == 2:
            data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        elif sw == 4:
            data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
        else:
            data = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0
        if n_ch > 1:
            data = data.reshape(-1, n_ch).mean(axis=1)
        return data, sr, n_frames / sr
    except ImportError:
        pass

    total = n_frames * n_ch
    if sw == 2:
        flat = list(struct.unpack(f"<{total}h", raw))
        scale = 32768.0
    elif sw == 4:
        flat = list(struct.unpack(f"<{total}i", raw))
        scale = 2147483648.0
    else:
        flat = [b - 128 for b in raw]
        scale = 128.0
    flat_f = [s / scale for s in flat]
    if n_ch > 1:
        mono = [sum(flat_f[i * n_ch:(i + 1) * n_ch]) / n_ch for i in range(n_frames)]
    else:
        mono = flat_f
    import array as arr
    a = arr.array("f", mono)
    return a, sr, n_frames / sr


def compute_peaks(samples, sr, duration_sec, target_peaks=600):
    """Compute RMS amplitude peaks. Returns list of floats in [0, 1]."""
    try:
        import numpy as np
        data = np.asarray(samples, dtype=np.float32)
        n = len(data)
        n_peaks = max(2, min(target_peaks, int(duration_sec * 2)))
        block = max(1, n // n_peaks)
        # Pad to multiple of block
        pad = (n_peaks * block) - n
        if pad > 0:
            data = np.concatenate([data, np.zeros(pad, dtype=np.float32)])
        blocks = data[:n_peaks * block].reshape(n_peaks, block)
        rms = np.sqrt(np.mean(blocks ** 2, axis=1))
        peak = float(rms.max()) if rms.max() > 0 else 1.0
        peaks = (rms / peak).tolist()
        return peaks
    except ImportError:
        pass

    # Pure Python fallback
    n = len(samples)
    n_peaks = max(2, min(target_peaks, int(duration_sec * 2)))
    block = max(1, n // n_peaks)
    peaks = []
    for i in range(n_peaks):
        start = i * block
        end = min(n, start + block)
        chunk = [samples[j] for j in range(start, end)]
        rms = math.sqrt(sum(x * x for x in chunk) / max(1, len(chunk)))
        peaks.append(rms)
    mx = max(peaks) if peaks else 1.0
    if mx > 0:
        peaks = [p / mx for p in peaks]
    return peaks


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: generate_waveform.py <videoId> <ytdlp_bin> [extra_args...]"}))
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
            "--postprocessor-args", "ffmpeg:-t 360",  # up to 6 min
            "-o", out_template,
            *extra_args,
            url,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=180)
        except subprocess.TimeoutExpired:
            print(json.dumps({"error": "yt-dlp timed out"}))
            sys.exit(1)

        wav_files = [f for f in os.listdir(tmpdir) if f.endswith(".wav")]
        if not wav_files:
            err = result.stderr.decode(errors="replace")[-300:]
            print(json.dumps({"error": f"No audio produced: {err}"}))
            sys.exit(1)

        wav_path = os.path.join(tmpdir, wav_files[0])
        try:
            samples, sr, duration_sec = read_wav_mono(wav_path)
        except Exception as e:
            print(json.dumps({"error": f"WAV read failed: {e}"}))
            sys.exit(1)

        peaks = compute_peaks(samples, sr, duration_sec)
        print(json.dumps({"peaks": peaks, "durationSec": round(duration_sec, 2)}))


if __name__ == "__main__":
    main()
