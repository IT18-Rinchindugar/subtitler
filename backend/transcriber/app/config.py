import os
from dotenv import load_dotenv

load_dotenv()


def _required(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


S3_ENDPOINT = _required("S3_ENDPOINT")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
S3_BUCKET = _required("S3_BUCKET")
S3_ACCESS_KEY = _required("S3_ACCESS_KEY")
S3_SECRET_KEY = _required("S3_SECRET_KEY")

API_CALLBACK_URL = _required("API_CALLBACK_URL")
INTERNAL_SECRET = _required("INTERNAL_SECRET")

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3-turbo")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

PAUSE_GAP_SECONDS = float(os.getenv("PAUSE_GAP_SECONDS", "0.2"))
MAX_CUE_CHARS = int(os.getenv("MAX_CUE_CHARS", "65"))
