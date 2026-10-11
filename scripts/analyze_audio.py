#!/usr/bin/env python3
"""
Detect BPM + musical key of a LOCAL audio/video file (no download — the
caller already has the file on disk, e.g. right after a yt-dlp download).

Usage: python3 analyze_audio.py <input_file> <ffmpeg_bin>
Prints a JSON object: {"bpm": 120, "key": {"note": "C", "mode": "Major"}}

BPM: onset-envelope autocorrelation (same approach as detect_bpm.py).
Key: a chromagram (FFT bins folded into 12 pitch classes) correlated
against the Krumhansl-Kessler major/minor key profiles. This avoids a
dependency on essentia, which isn't installed in the production image.
"""
import sys, json, subprocess, tempfile, os, math, wave


def extract_wav(input_file, ffmpeg_bin, out_path, seconds=45):
    """Extract the first `seconds` of audio as mono 22050Hz PCM wav."""
    cmd = [
        ffmpeg_bin, "-y", "-i", input_file,
        "-t", str(seconds),
        "-ac", "1", "-ar", "22050",
        "-vn", out_path,
    ]
    subprocess.run(cmd, capture_output=True, timeout=60, check=True)


def read_wav_mono(path):
    with wave.open(path, "rb") as wf:
        n_ch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    import numpy as np
    if sw == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sw == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        data = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0
    if n_ch > 1:
        data = data.reshape(-1, n_ch).mean(axis=1)
    return data, sr


def detect_bpm(samples, sr):
    import numpy as np
    data = samples

    target_sr = 11025
    if sr > target_sr:
        step = sr // target_sr
        data = data[::step]
        sr = sr // step

    hop = 256
    frame_size = 1024
    n = len(data)

    energies = np.array([
        np.sqrt(np.mean(data[s:s + frame_size] ** 2))
        for s in range(0, max(0, n - frame_size), hop)
    ])
    if len(energies) < 2:
        return 120
    onset = np.maximum(np.diff(energies), 0)

    N = len(onset)
    acf = np.correlate(onset, onset, mode="full")[N - 1:]

    min_period = max(1, int(60.0 / 210 * sr / hop))
    max_period = int(60.0 / 60 * sr / hop)
    if max_period >= len(acf):
        max_period = len(acf) - 1
    if max_period <= min_period:
        return 120

    search = acf[min_period:max_period + 1]
    if len(search) == 0:
        return 120

    best_offset = int(np.argmax(search))
    best_period = best_offset + min_period
    bpm_raw = 60.0 * sr / hop / best_period

    for factor in [1.0, 0.5, 2.0]:
        candidate = bpm_raw * factor
        if 70 <= candidate <= 180:
            bpm_raw = candidate
            break

    return int(round(max(60, min(220, bpm_raw))))


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def chromagram(samples, sr):
    import numpy as np

    frame_size = 4096
    hop = 2048
    n = len(samples)
    window = np.hanning(frame_size)

    chroma = np.zeros(12)
    freqs = np.fft.rfftfreq(frame_size, d=1.0 / sr)
    # Map each FFT bin to a pitch class once (frame size + sr are fixed)
    with np.errstate(divide="ignore"):
        midi = 69 + 12 * np.log2(np.maximum(freqs, 1e-6) / 440.0)
    pitch_class = np.round(midi).astype(int) % 12
    valid = (freqs >= 60) & (freqs <= 5000)

    n_frames = 0
    for s in range(0, max(0, n - frame_size), hop):
        frame = samples[s:s + frame_size] * window
        mag = np.abs(np.fft.rfft(frame))
        for pc in range(12):
            mask = valid & (pitch_class == pc)
            if mask.any():
                chroma[pc] += mag[mask].sum()
        n_frames += 1

    if n_frames == 0 or chroma.sum() == 0:
        return None
    return chroma / chroma.sum()


def detect_key(samples, sr):
    import numpy as np

    chroma = chromagram(samples, sr)
    if chroma is None:
        return None

    major = np.array(MAJOR_PROFILE)
    minor = np.array(MINOR_PROFILE)

    def correlate(vec, profile):
        v = vec - vec.mean()
        p = profile - profile.mean()
        denom = np.sqrt((v ** 2).sum() * (p ** 2).sum())
        return float((v * p).sum() / denom) if denom > 0 else 0.0

    best_score = -2.0
    best_note = "C"
    best_mode = "Major"
    for root in range(12):
        rotated = np.roll(chroma, -root)
        maj_score = correlate(rotated, major)
        min_score = correlate(rotated, minor)
        if maj_score > best_score:
            best_score, best_note, best_mode = maj_score, NOTE_NAMES[root], "Major"
        if min_score > best_score:
            best_score, best_note, best_mode = min_score, NOTE_NAMES[root], "Minor"

    return {"note": best_note, "mode": best_mode, "strength": round(best_score, 3)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: analyze_audio.py <input_file> <ffmpeg_bin>"}))
        sys.exit(1)

    input_file = sys.argv[1]
    ffmpeg_bin = sys.argv[2]

    with tempfile.TemporaryDirectory() as tmpdir:
        wav_path = os.path.join(tmpdir, "audio.wav")
        try:
            extract_wav(input_file, ffmpeg_bin, wav_path)
        except Exception as e:
            print(json.dumps({"error": f"ffmpeg extraction failed: {e}"}))
            sys.exit(1)

        try:
            samples, sr = read_wav_mono(wav_path)
        except Exception as e:
            print(json.dumps({"error": f"WAV read failed: {e}"}))
            sys.exit(1)

        try:
            bpm = detect_bpm(samples, sr)
        except Exception:
            bpm = None

        try:
            key = detect_key(samples, sr)
        except Exception:
            key = None

        print(json.dumps({"bpm": bpm, "key": key}))


if __name__ == "__main__":
    main()
