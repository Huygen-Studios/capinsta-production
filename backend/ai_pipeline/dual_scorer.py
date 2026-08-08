import hashlib
import logging
from typing import Any

from .config import EMBED_BATCH_SIZE, KEYWORD_WEIGHT, SEMANTIC_WEIGHT
from .normalizer import normalize_for_scoring

logger = logging.getLogger(__name__)

_embed_model: Any | None = None
_torch_functional: Any | None = None
_embedding_unavailable_error: str | None = None
EMBED_CACHE = {}


def _load_embedding_deps() -> bool:
    global _embed_model, _torch_functional, _embedding_unavailable_error
    if _embed_model is not None and _torch_functional is not None:
        return True
    if _embedding_unavailable_error is not None:
        return False

    try:
        from sentence_transformers import SentenceTransformer
        import torch.nn.functional as torch_functional

        _embed_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
        _torch_functional = torch_functional
        return True
    except Exception as exc:
        _embedding_unavailable_error = str(exc)
        logger.warning(
            "Semantic scorer unavailable; falling back to keyword retention. "
            f"Reason: {_embedding_unavailable_error}"
        )
        return False


def get_embedding(text: str):
    """Hash-based embedding cache loaded lazily to keep FastAPI startup light."""
    if not _load_embedding_deps():
        return None

    key = hashlib.md5(text.encode("utf-8")).hexdigest()
    if key in EMBED_CACHE:
        return EMBED_CACHE[key]

    emb = _embed_model.encode(text, convert_to_tensor=True)
    EMBED_CACHE[key] = emb
    return emb


def batch_encode(texts: list[str], batch_size: int = EMBED_BATCH_SIZE) -> list:
    """Batch encoding for performance."""
    if not texts or not _load_embedding_deps():
        return []
    return _embed_model.encode(texts, batch_size=batch_size, convert_to_tensor=True)


def semantic_similarity(raw: str, corrected: str) -> float:
    """Compute cosine similarity, or return keyword-only fallback when unavailable."""
    emb1 = get_embedding(raw)
    emb2 = get_embedding(corrected)
    if emb1 is None or emb2 is None or _torch_functional is None:
        return keyword_retention(raw, corrected)

    cos_sim = _torch_functional.cosine_similarity(emb1.unsqueeze(0), emb2.unsqueeze(0)).item()
    return max(0.0, cos_sim)


def keyword_retention(raw: str, corrected: str) -> float:
    """Measure keyword preservation via simple Jaccard index."""
    raw_words = set(raw.split())
    corr_words = set(corrected.split())

    if not raw_words or not corr_words:
        return 0.0

    intersection = raw_words.intersection(corr_words)
    union = raw_words.union(corr_words)
    return len(intersection) / len(union)


def compute_dual_score(raw: str, corrected: str) -> float:
    """Compute combined semantic + keyword score using normalized text."""
    norm_raw = normalize_for_scoring(raw)
    norm_corr = normalize_for_scoring(corrected)

    if not norm_raw or not norm_corr:
        return 0.0

    keyword = keyword_retention(norm_raw, norm_corr)
    if not _load_embedding_deps():
        return keyword

    semantic = semantic_similarity(norm_raw, norm_corr)
    return (semantic * SEMANTIC_WEIGHT) + (keyword * KEYWORD_WEIGHT)

