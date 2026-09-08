import { describe, expect, test } from "bun:test";
import { seekVideo } from "../packages/viewer-react/src/seek-video";

function media(paused: boolean, ended = false, duration = 10) {
  let playCalls = 0;
  const video = {
    paused, ended, duration, currentTime: 0,
    play: async () => { playCalls++; video.paused = false; }
  };
  return { video: video as unknown as HTMLVideoElement, calls: () => playCalls };
}

describe("video seeking", () => {
  test("continues playback when jumping backward to a previously played action", async () => {
    const { video, calls } = media(false);
    video.currentTime = 8;
    await seekVideo(video, 2);
    expect(video.currentTime).toBe(2);
    expect(calls()).toBe(1);
    expect(video.paused).toBe(false);
  });
  test("replays an ended video but preserves an intentional pause", async () => {
    const ended = media(true, true);
    await seekVideo(ended.video, 2);
    expect(ended.calls()).toBe(1);
    const paused = media(true);
    await seekVideo(paused.video, 2);
    expect(paused.calls()).toBe(0);
  });
  test("keeps action offsets beyond the encoded duration before the end", async () => {
    const { video } = media(false);
    await seekVideo(video, 12);
    expect(video.currentTime).toBeCloseTo(9.95);
    await seekVideo(video, -1);
    expect(video.currentTime).toBe(0);
  });
  test("supports recordings without duration metadata and ignores invalid offsets", async () => {
    const { video, calls } = media(false, false, Infinity);
    await seekVideo(video, 20);
    expect(video.currentTime).toBe(20);
    await seekVideo(video, NaN);
    expect(calls()).toBe(1);
  });
  test("ignores interrupted play requests but reports actual playback failures", async () => {
    const { video } = media(false);
    video.play = async () => { throw new DOMException("Interrupted", "AbortError"); };
    await expect(seekVideo(video, 2)).resolves.toBeUndefined();
    video.play = async () => { throw new Error("Decoder failed"); };
    await expect(seekVideo(video, 2)).rejects.toThrow("Decoder failed");
  });
});
