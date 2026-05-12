#!/usr/bin/env python3
"""
Detect the musical key of a YouTube video's audio using Essentia KeyExtractor.
Usage: python3 detect_key.py <videoId> <ytdlp_bin> [extra yt-dlp args...]
Prints a JSON object: {"note": "C", "mode": "Major"}
"""
import sys, json, subprocess, tempfile, os

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: detect_key.py <videoId> <ytdlp_bin> [extra_args...]"}))
        sys.exit(1)

    video_id = sys.argv[1]
    ytdlp_bin = sys.argv[2]
    extra_args = sys.argv[3:]

    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        out_template = os.path.join(tmpdir, "audio.%(ext)s")
        # Download first 60s as mp3 — Essentia's MonoLoader handles mp3 natively
        cmd = [
            ytdlp_bin,
            "-x", "--audio-format", "mp3",
            "--postprocessor-args", "ffmpeg:-t 60",
            "-o", out_template,
            *extra_args,
            url,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=120)
        except subprocess.TimeoutExpired:
            print(json.dumps({"error": "yt-dlp timed out"}))
            sys.exit(1)

        mp3_files = [f for f in os.listdir(tmpdir) if f.endswith(".mp3")]
        if not mp3_files:
            err = result.stderr.decode(errors="replace")[-300:]
            print(json.dumps({"error": f"No audio produced: {err}"}))
            sys.exit(1)

        mp3_path = os.path.join(tmpdir, mp3_files[0])

        try:
            import essentia.standard as es
        except ImportError:
            print(json.dumps({"error": "essentia not installed"}))
            sys.exit(1)

        # Load audio as mono at 44100 Hz
        loader = es.MonoLoader(filename=mp3_path, sampleRate=44100)
        audio = loader()

        # KeyExtractor with bgate profile — tuned for electronic/beat music
        extractor = es.KeyExtractor(
            sampleRate=44100,
            profileType="bgate",
        )
        key, scale, strength = extractor(audio)

        # Normalise output: capitalise scale ("major" -> "Major")
        print(json.dumps({
            "note": key,
            "mode": scale.capitalize(),
            "strength": round(float(strength), 3),
        }))


if __name__ == "__main__":
    main()
