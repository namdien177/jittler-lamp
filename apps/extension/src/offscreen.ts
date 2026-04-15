import { offscreenRequestSchema, type SessionBundle } from "@jittle-lamp/shared";

const companionServerOrigin = "http://127.0.0.1:48115";

type ChromeTabCaptureTrackConstraints = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: "tab";
    chromeMediaSourceId: string;
    maxFrameRate?: number;
  };
};

type ActiveRecorderState = {
  sessionId: string;
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  stopPromise: Promise<Blob>;
};

type CompanionWriteResult =
  | {
      saved: true;
      outputDir: string;
    }
  | {
      saved: false;
    };

type CompanionHealthPayload = {
  ok?: boolean;
  origin?: string;
  outputDir?: string;
};

let activeRecorderState: ActiveRecorderState | null = null;

chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  const parsed = offscreenRequestSchema.safeParse(rawMessage);

  if (!parsed.success) {
    return false;
  }

  void handleRequest(parsed.data)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: errorMessage(error)
      });
    });

  return true;
});

async function handleRequest(
  request: ReturnType<typeof offscreenRequestSchema.parse>
): Promise<{
  ok: boolean;
  recordingBytes?: number;
  eventBytes?: number;
  destination?: "companion" | "downloads";
  outputDir?: string;
  error?: string;
}> {
  switch (request.type) {
    case "jl/offscreen-start-recording":
      await startRecorder(request.sessionId, request.streamId);
      return { ok: true };

    case "jl/offscreen-stop-and-export": {
      const recordingBlob = await stopRecorder(request.sessionId);
      const finalized = finalizeBundleForExport(request.bundle, recordingBlob.size);

      const companionResult = await tryWriteArtifactsToCompanion(
        finalized.bundle,
        recordingBlob,
        finalized.jsonBlob
      );

      if (!companionResult.saved) {
        await Promise.all([
          downloadBlob(
            recordingBlob,
            artifactPath(finalized.bundle, "recording.webm"),
            "video/webm"
          ),
          downloadBlob(
            finalized.jsonBlob,
            artifactPath(finalized.bundle, "session.events.json"),
            "application/json"
          )
        ]);
      }

      return {
        ok: true,
        recordingBytes: recordingBlob.size,
        eventBytes: finalized.jsonBlob.size,
        destination: companionResult.saved ? "companion" : "downloads",
        ...(companionResult.saved ? { outputDir: companionResult.outputDir } : {})
      };
    }
  }
}

async function tryWriteArtifactsToCompanion(
  bundle: SessionBundle,
  recordingBlob: Blob,
  jsonBlob: Blob
): Promise<CompanionWriteResult> {
  try {
    const healthResponse = await fetch(`${companionServerOrigin}/health`);

    if (!healthResponse.ok) {
      return { saved: false };
    }

    const companionHealth = await readCompanionHealth(healthResponse);

    await Promise.all([
      uploadArtifactToCompanion(bundle.sessionId, "recording.webm", recordingBlob, "video/webm"),
      uploadArtifactToCompanion(bundle.sessionId, "session.events.json", jsonBlob, "application/json")
    ]);

    return {
      saved: true,
      outputDir: companionHealth.outputDir
    };
  } catch {
    return { saved: false };
  }
}

async function readCompanionHealth(response: Response): Promise<{ outputDir: string }> {
  const payload = (await response.json()) as CompanionHealthPayload;

  if (typeof payload.outputDir !== "string" || payload.outputDir.trim().length === 0) {
    throw new Error("Companion health response did not include a writable output directory.");
  }

  return {
    outputDir: payload.outputDir
  };
}

async function uploadArtifactToCompanion(
  sessionId: string,
  artifactName: "recording.webm" | "session.events.json",
  blob: Blob,
  contentType: string
): Promise<void> {
  const response = await fetch(
    `${companionServerOrigin}/api/sessions/${encodeURIComponent(sessionId)}/${artifactName}`,
    {
      method: "PUT",
      headers: {
        "content-type": contentType
      },
      body: blob
    }
  );

  if (!response.ok) {
    throw new Error(`Companion server rejected ${artifactName} with ${response.status}.`);
  }
}

async function startRecorder(sessionId: string, streamId: string): Promise<void> {
  if (activeRecorderState?.sessionId === sessionId) {
    return;
  }

  if (activeRecorderState) {
    throw new Error("An offscreen recording is already active.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxFrameRate: 30
      }
    } as ChromeTabCaptureTrackConstraints,
    audio: false
  });

  const mimeType = preferredMimeType();
  const chunks: Blob[] = [];
  let resolveStop: ((blob: Blob) => void) | null = null;
  let rejectStop: ((error: Error) => void) | null = null;

  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    resolveStop = resolve;
    rejectStop = reject;
  });

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", () => {
    resolveStop?.(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  });

  recorder.addEventListener("error", (event) => {
    const message = event.error?.message || "MediaRecorder failed in the offscreen document.";
    rejectStop?.(new Error(message));
  });

  recorder.start(1000);

  activeRecorderState = {
    sessionId,
    stream,
    recorder,
    chunks,
    stopPromise
  };
}

async function stopRecorder(sessionId: string): Promise<Blob> {
  const recorderState = activeRecorderState;

  if (!recorderState || recorderState.sessionId !== sessionId) {
    throw new Error("No matching offscreen recording session is active.");
  }

  activeRecorderState = null;

  try {
    if (recorderState.recorder.state !== "inactive") {
      recorderState.recorder.stop();
    }

    return await recorderState.stopPromise;
  } finally {
    recorderState.stream.getTracks().forEach((track) => {
      track.stop();
    });
  }
}

function preferredMimeType(): string | undefined {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function finalizeBundleForExport(
  bundle: SessionBundle,
  recordingBytes: number
): { bundle: SessionBundle; jsonBlob: Blob } {
  let nextBundle = withArtifactBytes(bundle, "recording.webm", recordingBytes);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const jsonText = stringifyBundle(nextBundle);
    const jsonBlob = new Blob([jsonText], { type: "application/json" });
    const updatedBundle = withArtifactBytes(nextBundle, "session.events.json", jsonBlob.size);

    if (artifactBytes(updatedBundle, "session.events.json") === artifactBytes(nextBundle, "session.events.json")) {
      return {
        bundle: updatedBundle,
        jsonBlob: new Blob([stringifyBundle(updatedBundle)], { type: "application/json" })
      };
    }

    nextBundle = updatedBundle;
  }

  return {
    bundle: nextBundle,
    jsonBlob: new Blob([stringifyBundle(nextBundle)], { type: "application/json" })
  };
}

function withArtifactBytes(
  bundle: SessionBundle,
  kind: "recording.webm" | "session.events.json",
  bytes: number
): SessionBundle {
  return {
    ...bundle,
    artifacts: bundle.artifacts.map((artifact) => {
      if (artifact.kind !== kind) {
        return artifact;
      }

      return {
        ...artifact,
        bytes
      };
    })
  };
}

function artifactBytes(
  bundle: SessionBundle,
  kind: "recording.webm" | "session.events.json"
): number | undefined {
  return bundle.artifacts.find((artifact) => artifact.kind === kind)?.bytes;
}

function artifactPath(
  bundle: SessionBundle,
  kind: "recording.webm" | "session.events.json"
): string {
  const artifact = bundle.artifacts.find((entry) => entry.kind === kind);

  if (artifact) {
    return artifact.relativePath;
  }

  return `${bundle.sessionId}/${kind}`;
}

function stringifyBundle(bundle: SessionBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

async function downloadBlob(blob: Blob, filename: string, mimeType: string): Promise<void> {
  const typedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  const objectUrl = URL.createObjectURL(typedBlob);

  try {
    const downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename,
      saveAs: true,
      conflictAction: "uniquify"
    });

    if (typeof downloadId !== "number") {
      throw new Error(`Failed to create a browser download for ${filename}.`);
    }

    await waitForDownload(downloadId);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function waitForDownload(downloadId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const listener = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== downloadId || !delta.state?.current) {
        return;
      }

      if (delta.state.current === "complete") {
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
        return;
      }

      if (delta.state.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error("A local recorder download was interrupted."));
      }
    };

    chrome.downloads.onChanged.addListener(listener);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
