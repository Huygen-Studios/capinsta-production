from __future__ import annotations

from server.clipping_handoff.identity import canonical_hash


def export_spec() -> dict:
    return {
        "schemaVersion": 1,
        "preset": "vertical-mp4-v1",
        "container": "mp4",
        "videoCodec": "h264",
        "audioCodec": "aac",
        "includeCaptions": True,
    }


__all__ = ["canonical_hash", "export_spec"]
