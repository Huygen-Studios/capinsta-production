import type { MediaFile } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useTimelineStore } from "@/store/timelineStore";

const MEDIA_ACCEPT = "video/*,audio/*,image/png,image/jpeg,image/webp";

function addBaseVideoIfNeeded(mediaFile: MediaFile) {
  if (mediaFile.type !== "video") return;

  const timelineStore = useTimelineStore.getState();
  if (timelineStore.tracks.length === 0) {
    timelineStore.initDefaultTracks();
  }

  const latestTracks = useTimelineStore.getState().tracks;
  const hasVideoClip = latestTracks.some((track) => (track.clips || []).some((clip) => clip.type === "video"));
  const hasLinkedAudioClip = latestTracks.some(
    (track) => track.type === "audio" && (track.clips || []).some((clip) => clip.mediaId === mediaFile.id)
  );

  usePlaybackStore.getState().setDuration(mediaFile.duration);

  if (!hasVideoClip) {
    timelineStore.addClip("v1", {
      type: "video",
      mediaId: mediaFile.id,
      start: 0,
      end: mediaFile.duration || 5,
      transform: { xPercent: 50, yPercent: 50, scale: 1, rotation: 0, opacity: 1 },
    });
  }

  if (!hasLinkedAudioClip && latestTracks.some((track) => track.id === "a1" && !track.locked)) {
    timelineStore.addClip("a1", {
      type: "audio",
      mediaId: mediaFile.id,
      start: 0,
      end: mediaFile.duration || 5,
      visible: true,
      volume: 1,
      muted: false,
    });
  }
}

function finalizeImportedMedia(mediaFile: MediaFile) {
  const editorStore = useEditorStore.getState();
  editorStore.addMedia(mediaFile);
  editorStore.setActiveMedia(mediaFile.id);
  addBaseVideoIfNeeded(mediaFile);
}

function createMediaFile(file: File): MediaFile {
  const type = file.type.startsWith("video") ? "video" : file.type.startsWith("audio") ? "audio" : "image";
  return {
    id: `m_${Date.now()}`,
    name: file.name,
    type: type as MediaFile["type"],
    size: file.size,
    duration: type === "image" ? 5 : 0,
    url: URL.createObjectURL(file),
    file,
  };
}

export function importMediaFile(file: File): Promise<MediaFile> {
  return new Promise((resolve, reject) => {
    try {
      const mediaFile = createMediaFile(file);

      if (mediaFile.type === "image") {
        finalizeImportedMedia(mediaFile);
        resolve(mediaFile);
        return;
      }

      const element = document.createElement(mediaFile.type);
      element.preload = "metadata";
      element.src = mediaFile.url;

      element.onloadedmetadata = () => {
        mediaFile.duration = element.duration || mediaFile.duration;
        if (mediaFile.type === "video") {
          mediaFile.resolution = {
            width: (element as HTMLVideoElement).videoWidth,
            height: (element as HTMLVideoElement).videoHeight,
          };
        }
        finalizeImportedMedia(mediaFile);
        resolve(mediaFile);
      };

      element.onerror = () => {
        finalizeImportedMedia(mediaFile);
        resolve(mediaFile);
      };
    } catch (error) {
      reject(error);
    }
  });
}

export function openMediaPicker() {
  return new Promise<MediaFile | null>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = MEDIA_ACCEPT;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "0";

    const cleanup = () => {
      window.setTimeout(() => input.remove(), 0);
    };

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        cleanup();
        resolve(null);
        return;
      }

      try {
        const mediaFile = await importMediaFile(file);
        cleanup();
        resolve(mediaFile);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    input.oncancel = () => {
      cleanup();
      resolve(null);
    };
    document.body.appendChild(input);
    input.click();
  });
}
