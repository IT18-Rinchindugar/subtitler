import tempfile
import os
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from pydantic import BaseModel

from app import config
from app.s3 import download_to_file
from app.whisper import extract_audio, load_model, transcribe


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model()
    yield


app = FastAPI(title="Subtitle Transcriber", lifespan=lifespan)


class TranscribeRequest(BaseModel):
    project_id: str
    s3_key: str
    language: str = "en"
    callback_url: str
    internal_secret: str


async def _run_transcription(job: TranscribeRequest) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        video_path = os.path.join(tmp, "video")
        audio_path = os.path.join(tmp, "audio.wav")

        try:
            download_to_file(job.s3_key, video_path)
            extract_audio(video_path, audio_path)
            word_chunks, cues = transcribe(audio_path, job.language)

            payload: dict[str, Any] = {
                "projectId": job.project_id,
                "status": "ready",
                "cues": cues,
                "wordChunks": word_chunks,
            }
        except Exception as exc:
            payload = {
                "projectId": job.project_id,
                "status": "error",
                "errorMessage": str(exc),
            }

        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(
                job.callback_url,
                json=payload,
                headers={"x-internal-secret": job.internal_secret},
            )


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/transcribe", status_code=202)
async def transcribe_endpoint(
    job: TranscribeRequest,
    background_tasks: BackgroundTasks,
    request: Request,
):
    # Validate internal secret
    if job.internal_secret != config.INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")

    background_tasks.add_task(_run_transcription, job)
    return {"message": "accepted", "project_id": job.project_id}
