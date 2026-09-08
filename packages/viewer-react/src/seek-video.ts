/** Seek without losing active playback, including replaying an ended recording. */
export async function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (!Number.isFinite(seconds)) return;
  const resume = !video.paused || video.ended;
  // Action timestamps may extend slightly past the final encoded frame.
  const end = Number.isFinite(video.duration) && video.duration > 0
    ? Math.max(0, video.duration - 0.05)
    : Infinity;
  video.currentTime = Math.min(end, Math.max(0, seconds));
  if (!resume) return;
  try {
    // The browser resolves play after the seek has enough data to continue.
    await video.play();
  } catch (error) {
    // A subsequent seek, pause, or source change can interrupt this request.
    if (error instanceof Error && error.name === "AbortError") return;
    throw error;
  }
}
