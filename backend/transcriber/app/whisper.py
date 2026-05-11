"""Transcription logic: faster-whisper → word chunks → subtitle cues."""
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from faster_whisper import WhisperModel

from app import config

# Module-level model singleton (loaded once at app startup)
_model: WhisperModel | None = None


def load_model() -> None:
    global _model
    _model = WhisperModel(
        config.WHISPER_MODEL,
        device=config.WHISPER_DEVICE,
        compute_type=config.WHISPER_COMPUTE_TYPE,
    )
    print(f"Whisper model '{config.WHISPER_MODEL}' loaded.")


def get_model() -> WhisperModel:
    if _model is None:
        raise RuntimeError("Whisper model not loaded")
    return _model


def extract_audio(video_path: str, audio_path: str) -> None:
    """Extract 16kHz mono WAV from video using ffmpeg."""
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", video_path,
            "-ac", "1",
            "-ar", "16000",
            "-vn",
            audio_path,
        ],
        check=True,
        capture_output=True,
    )


def transcribe(audio_path: str, language: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Returns (word_chunks, cues).

    word_chunks: [{ text, timestamp: [start, end] }, ...]
    cues:        [{ text, timestamp: [start, end], wordChunks: [...] }, ...]
    """
    model = get_model()
    segments, _ = model.transcribe(
        audio_path,
        language=language if language != "auto" else None,
        word_timestamps=True,
    )

    # Flatten all words to a single list
    word_chunks: list[dict[str, Any]] = []
    for segment in segments:
        if segment.words:
            for word in segment.words:
                word_chunks.append({
                    "text": word.word,
                    "timestamp": [round(word.start, 3), round(word.end, 3)],
                })

    cues = _group_into_cues(word_chunks)
    return word_chunks, cues


def _group_into_cues(
    words: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Group words into subtitle cues using the same rules as the frontend:
    - Pause > PAUSE_GAP_SECONDS between words → new cue
    - Accumulated text > MAX_CUE_CHARS → new cue
    """
    if not words:
        return []

    cues: list[dict[str, Any]] = []
    current_words: list[dict[str, Any]] = []
    current_text = ""

    def flush():
        if not current_words:
            return
        start = current_words[0]["timestamp"][0]
        end = current_words[-1]["timestamp"][1]
        cues.append({
            "text": current_text.strip(),
            "timestamp": [start, end],
            "wordChunks": list(current_words),
        })

    for i, word in enumerate(words):
        word_text = word["text"]
        is_pause = False

        if i > 0:
            prev_end = words[i - 1]["timestamp"][1]
            curr_start = word["timestamp"][0]
            if curr_start - prev_end >= config.PAUSE_GAP_SECONDS:
                is_pause = True

        tentative = (current_text + word_text).strip()
        over_limit = len(tentative) > config.MAX_CUE_CHARS and current_words

        if is_pause or over_limit:
            flush()
            current_words = []
            current_text = ""

        current_words.append(word)
        current_text += word_text

    flush()
    return cues
