from pydantic import BaseModel
from typing import Any, Optional, List

class AlignedWord(BaseModel):
    word: str
    start: float
    end: float
    score: float = 0.0
    confidence: Optional[float] = None
    provider: Optional[str] = None
    timing_source: Optional[str] = None
    originalWord: Optional[str] = None
    languageHint: Optional[str] = None
    timing_repair: Optional[str] = None

class AlignedSegment(BaseModel):
    id: Optional[str] = None
    start: float
    end: float
    text: str
    words: Optional[List[AlignedWord]] = None

class JobResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    filename: str
    target_lang: str
    languageMode: str
    video_url: Optional[str] = None

class JobDetailResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    filename: str
    target_lang: str
    languageMode: str
    error: Optional[str] = None
    srt: Optional[str] = None
    vtt: Optional[str] = None
    segments: Optional[List[AlignedSegment]] = None
    transcript: Optional[dict[str, Any]] = None
    output_video_url: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None
