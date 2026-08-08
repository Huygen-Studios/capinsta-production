import numpy as np
import logging
import soundfile as sf
from .config import (
    DUAL_SCORE_THRESHOLD, ALIGN_AVG_THRESHOLD, CONFIDENCE_REPROCESS,
    NOISY_SNR_THRESHOLD, NOISY_DUAL_DELTA, NOISY_ALIGN_DELTA,
    FAST_SPEECH_THRESHOLD, FAST_SPEECH_ALIGN_DELTA
)

logger = logging.getLogger(__name__)

def measure_audio_quality(audio_path: str) -> dict:
    try:
        y, sr = sf.read(audio_path, dtype="float32", always_2d=False)
        if getattr(y, "ndim", 1) > 1:
            y = np.mean(y, axis=1)

        if len(y) == 0:
            raise ValueError("empty audio")

        duration = len(y) / float(sr or 16000)
        volume_rms = float(np.sqrt(np.mean(np.square(y))))

        # Lightweight SNR estimate for production containers. The optional
        # local AI requirements can install librosa for richer analysis.
        abs_y = np.abs(y)
        noise_floor = float(np.percentile(abs_y, 12)) + 1e-8
        signal_level = float(np.percentile(abs_y, 82)) + 1e-8
        snr_db = float(20 * np.log10(signal_level / noise_floor))

        frame = max(1, int((sr or 16000) * 0.04))
        envelope = np.array([
            float(np.sqrt(np.mean(np.square(y[i:i + frame]))))
            for i in range(0, len(y), frame)
            if len(y[i:i + frame]) > 0
        ])
        threshold = max(noise_floor * 2.5, volume_rms * 0.35)
        active_frames = int(np.sum(envelope > threshold)) if len(envelope) else 0
        speech_rate = active_frames / duration if duration > 0 else 0
        
        return {
            'snr_db': round(snr_db, 2),
            'speech_rate': round(speech_rate, 2),
            'volume_rms': round(volume_rms, 4)
        }
    except Exception as e:
        logger.warning(f"Failed to measure audio quality: {e}")
        return {'snr_db': 20.0, 'speech_rate': 2.5, 'volume_rms': 0.05}

def adaptive_thresholds(snr_db: float, speech_rate: float) -> dict:
    base = {
        'dual_score': DUAL_SCORE_THRESHOLD,
        'align_avg': ALIGN_AVG_THRESHOLD,
        'confidence': CONFIDENCE_REPROCESS
    }
    
    # Apply deltas based on audio conditions
    if snr_db < NOISY_SNR_THRESHOLD:  # noisy audio
        base['dual_score'] += NOISY_DUAL_DELTA
        base['align_avg']  += NOISY_ALIGN_DELTA
        logger.info(f"Noisy audio detected (SNR {snr_db:.1f}dB) - Lowering thresholds.")
        
    if speech_rate > FAST_SPEECH_THRESHOLD:  # fast speech (words/sec)
        base['align_avg']  += FAST_SPEECH_ALIGN_DELTA
        logger.info(f"Fast speech detected ({speech_rate:.1f} w/s) - Lowering align threshold.")
        
    # Ensure thresholds don't drop below reasonable minimums
    base['dual_score'] = max(0.60, round(base['dual_score'], 2))
    base['align_avg'] = max(0.50, round(base['align_avg'], 2))
    
    return base
