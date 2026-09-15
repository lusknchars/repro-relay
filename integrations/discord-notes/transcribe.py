"""Local, bounded speech recognition. No provider upload or model-generated actions."""
import json
from pathlib import Path
import sys


def transcribe(directory, model):
    directory = Path(directory)
    manifest = json.loads((directory / 'manifest.json').read_text())
    if not 1 <= len(manifest) <= 5: raise ValueError('Invalid speaker count')
    result = []
    total = 0
    for speaker in manifest:
        if not isinstance(speaker, str) or not speaker.isdigit() or not 16 <= len(speaker) <= 20:
            raise ValueError('Invalid speaker')
        path = directory / (speaker + '.wav')
        if path.is_symlink() or path.stat().st_size > 19_200_044:
            raise ValueError('Audio exceeds the ten-minute limit')
        segments, _ = model.transcribe(str(path), beam_size=1, vad_filter=True,
            condition_on_previous_text=False, hallucination_silence_threshold=2)
        for segment in segments:
            text = segment.text.strip()
            if not text: continue
            total += len(text)
            if total > 24_000 or len(text)>2000 or len(result)>=500:
                raise ValueError('Transcript exceeds the limit; refusing partial publication')
            result.append({'speaker': speaker, 'start_ms': round(segment.start * 1000), 'text': text})
    return sorted(result, key=lambda row: row['start_ms'])


if __name__ == '__main__':
    try:
        import onnxruntime
        onnxruntime.disable_telemetry_events()
        from faster_whisper import WhisperModel
        model = WhisperModel('/opt/whisper-tiny', device='cpu', compute_type='int8', cpu_threads=2, local_files_only=True)
        print(json.dumps(transcribe(sys.argv[1], model), ensure_ascii=False))
    except Exception:
        print('Local transcription failed. No partial transcript was published.', file=sys.stderr)
        sys.exit(1)
