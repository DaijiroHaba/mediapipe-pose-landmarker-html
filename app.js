import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const MODEL_URL = "./models/pose_landmarker_full.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const VIEWS = [
  { id: "front", label: "前方", inputId: "frontFile" },
  { id: "side", label: "側方", inputId: "sideFile" },
  { id: "back", label: "後方", inputId: "backFile" },
  { id: "other", label: "その他", inputId: "otherFile" },
];
const CSV_BOM = "\uFEFF";
const SUMMARY_JA_HEADERS = [
  "方向",
  "元動画ファイル名",
  "動画長_秒",
  "sample_fps",
  "解析対象フレーム数",
  "ランドマーク検出フレーム数",
  "検出率_%",
  "座標CSV",
  "ランドマーク付き動画",
  "動画出力状態",
  "注意",
];

const LANDMARK_NAMES = [
  "nose",
  "left_eye_inner",
  "left_eye",
  "left_eye_outer",
  "right_eye_inner",
  "right_eye",
  "right_eye_outer",
  "left_ear",
  "right_ear",
  "mouth_left",
  "mouth_right",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_pinky",
  "right_pinky",
  "left_index",
  "right_index",
  "left_thumb",
  "right_thumb",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_heel",
  "right_heel",
  "left_foot_index",
  "right_foot_index",
];

const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

const COORDINATE_HEADERS = [
  "view",
  "source_file",
  "sample_index",
  "timestamp_ms",
  "timestamp_sec",
  "pose_detected",
  "landmark_index",
  "landmark_name",
  "x_norm",
  "y_norm",
  "z_norm",
  "visibility",
  "presence",
  "x_px",
  "y_px",
  "x_world",
  "y_world",
  "z_world",
];

const elements = {
  modelFile: document.querySelector("#modelFile"),
  sampleFps: document.querySelector("#sampleFps"),
  writeOverlay: document.querySelector("#writeOverlay"),
  startBtn: document.querySelector("#startBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  statusText: document.querySelector("#statusText"),
  progressPercent: document.querySelector("#progressPercent"),
  progressBar: document.querySelector("#progressBar"),
  logBox: document.querySelector("#logBox"),
  overlayCanvas: document.querySelector("#overlayCanvas"),
  sourceVideo: document.querySelector("#sourceVideo"),
  csvLink: document.querySelector("#csvLink"),
  summaryJsonLink: document.querySelector("#summaryJsonLink"),
  summaryCsvLink: document.querySelector("#summaryCsvLink"),
  overlayLink: document.querySelector("#overlayLink"),
  zipLink: document.querySelector("#zipLink"),
  viewInputs: Object.fromEntries(
    VIEWS.map((view) => [view.id, document.querySelector(`#${view.inputId}`)]),
  ),
};

const state = {
  busy: false,
  poseLandmarker: null,
  modelSourceLabel: "",
  objectUrls: [],
};

elements.startBtn.addEventListener("click", () => startAnalysis().catch(handleFatalError));
elements.resetBtn.addEventListener("click", resetOutputs);

function log(message) {
  const time = new Date().toLocaleTimeString();
  elements.logBox.textContent += `[${time}] ${message}\n`;
  elements.logBox.scrollTop = elements.logBox.scrollHeight;
}

function setStatus(message, percent = null) {
  elements.statusText.textContent = message;
  if (percent !== null) {
    const safePercent = Math.max(0, Math.min(100, percent));
    elements.progressBar.value = safePercent;
    elements.progressPercent.textContent = `${Math.round(safePercent)}%`;
  }
}

function setBusy(isBusy) {
  state.busy = isBusy;
  elements.startBtn.disabled = isBusy;
  elements.resetBtn.disabled = isBusy;
  elements.modelFile.disabled = isBusy;
  elements.sampleFps.disabled = isBusy;
  elements.writeOverlay.disabled = isBusy;
  for (const input of Object.values(elements.viewInputs)) {
    input.disabled = isBusy;
  }
}

function resetOutputs() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
  for (const link of [
    elements.csvLink,
    elements.summaryJsonLink,
    elements.summaryCsvLink,
    elements.overlayLink,
    elements.zipLink,
  ]) {
    link.removeAttribute("href");
    link.removeAttribute("download");
    link.classList.add("disabled");
    link.setAttribute("aria-disabled", "true");
  }
  const ctx = elements.overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);
  elements.logBox.textContent = "";
  setStatus("1つ以上の動画を選択してください。", 0);
}

function handleFatalError(error) {
  console.error(error);
  log(`ERROR: ${error.message || error}`);
  setStatus(`エラー: ${error.message || error}`);
  setBusy(false);
}

async function startAnalysis() {
  if (state.busy) {
    return;
  }
  resetOutputs();
  setBusy(true);

  const selectedVideos = collectSelectedVideos();
  if (selectedVideos.length === 0) {
    throw new Error("前方・側方・後方・その他のいずれか1つ以上の動画を選択してください。");
  }

  const sampleFps = Number.parseFloat(elements.sampleFps.value);
  if (!Number.isFinite(sampleFps) || sampleFps <= 0) {
    throw new Error("sample fps は 0 より大きい値を指定してください。長時間動画では 0.5〜1 を推奨します。");
  }

  log("動画はブラウザ内で処理します。サーバーへアップロードしません。");
  log(`選択方向: ${selectedVideos.map((item) => item.view.id).join(", ")}`);
  setStatus("MediaPipeモデルを読み込んでいます...", 2);
  const poseLandmarker = await getPoseLandmarker();
  log(`モデル読込: ${state.modelSourceLabel}`);

  const startedAt = new Date();
  const sampleLabel = `${formatNumber(sampleFps)}fps`;
  const perViewOutputs = [];
  const allCoordinateRows = [];

  for (let viewIndex = 0; viewIndex < selectedVideos.length; viewIndex += 1) {
    const item = selectedVideos[viewIndex];
    const viewProgressStart = 5 + (viewIndex / selectedVideos.length) * 88;
    const viewProgressEnd = 5 + ((viewIndex + 1) / selectedVideos.length) * 88;
    const output = await analyzeOneVideo({
      item,
      viewIndex,
      totalViews: selectedVideos.length,
      sampleFps,
      sampleLabel,
      poseLandmarker,
      progressStart: viewProgressStart,
      progressEnd: viewProgressEnd,
    });
    perViewOutputs.push(output);
    allCoordinateRows.push(...output.coordinateRows);
  }

  const finishedAt = new Date();
  const summaryAll = {
    app: "MediaPipe Pose Landmarker Static HTML",
    static_site: true,
    upload_to_server: false,
    views_requested: selectedVideos.map((item) => item.view.id),
    views_processed: perViewOutputs.map((output) => output.summary.view),
    sample_fps: sampleFps,
    total_videos: perViewOutputs.length,
    total_sampled_frames: perViewOutputs.reduce((sum, output) => sum + output.summary.sampled_frames, 0),
    total_detected_frames: perViewOutputs.reduce((sum, output) => sum + output.summary.detected_frames, 0),
    write_overlay: elements.writeOverlay.checked,
    processed_at: finishedAt.toISOString(),
    processing_elapsed_sec: (finishedAt.getTime() - startedAt.getTime()) / 1000,
    privacy: "Videos and derived data were processed in this browser. They were not uploaded by this app.",
    per_view: perViewOutputs.map((output) => output.summary),
  };
  summaryAll.total_detection_rate = summaryAll.total_sampled_frames
    ? summaryAll.total_detected_frames / summaryAll.total_sampled_frames
    : 0;

  const manifest = {
    created_at: finishedAt.toISOString(),
    static_site: true,
    upload_to_server: false,
    model_source: state.modelSourceLabel,
    supported_views: VIEWS.map((view) => view.id),
    selected_views: selectedVideos.map((item) => item.view.id),
    outputs: {
      summary_all_json: "reports/summary_all.json",
      summary_all_csv: "reports/summary_all.csv",
      summary_all_ja_csv: "reports/summary_all_ja.csv",
      summary_report_ja_html: "reports/summary_report_ja.html",
      readme_results_ja_txt: "reports/README_RESULTS_ja.txt",
      manifest_json: "reports/manifest.json",
      views: Object.fromEntries(perViewOutputs.map((output) => [
        output.summary.view,
        {
          coordinates_csv: output.paths.coordinatesCsv,
          summary_json: output.paths.summaryJson,
          summary_csv: output.paths.summaryCsv,
          summary_ja_csv: output.paths.summaryJaCsv,
          overlay_video: output.summary.overlay_video,
        },
      ])),
    },
    summary: summaryAll,
  };

  const allCoordinatesCsv = toCsv(allCoordinateRows, COORDINATE_HEADERS);
  const summaryAllJson = JSON.stringify(summaryAll, null, 2);
  const summaryAllCsv = toCsv(summaryAll.per_view, Object.keys(summaryAll.per_view[0] || {}));
  const summaryAllJaCsv = toCsvWithBom(summaryAll.per_view.map(summaryToJapaneseRow), SUMMARY_JA_HEADERS);
  const summaryReportJaHtml = makeSummaryReportJa(summaryAll);
  const readmeResultsJa = makeReadmeResultsJa();
  const manifestJson = JSON.stringify(manifest, null, 2);

  setDownload(
    elements.csvLink,
    new Blob([allCoordinatesCsv], { type: "text/csv;charset=utf-8" }),
    `all_views_landmarks_${sampleLabel}.csv`,
  );
  setDownload(
    elements.summaryJsonLink,
    new Blob([summaryAllJson], { type: "application/json" }),
    "summary_all.json",
  );
  setDownload(
    elements.summaryCsvLink,
    new Blob([summaryAllCsv], { type: "text/csv;charset=utf-8" }),
    "summary_all.csv",
  );

  if (perViewOutputs.length === 1 && perViewOutputs[0].overlayBlob?.size) {
    setDownload(elements.overlayLink, perViewOutputs[0].overlayBlob, perViewOutputs[0].filenames.overlay);
  }

  if (window.JSZip) {
    setStatus("ZIPを作成しています...", 98);
    const zipBlob = await makeZip({
      perViewOutputs,
      summaryAllJson,
      summaryAllCsv,
      summaryAllJaCsv,
      summaryReportJaHtml,
      readmeResultsJa,
      manifestJson,
    });
    setDownload(
      elements.zipLink,
      zipBlob,
      `pose_landmarker_static_4view_${sampleLabel}_results.zip`,
    );
  } else {
    log("JSZipを読み込めなかったため、ZIP一括ダウンロードは無効です。");
  }

  setStatus(`完了: ${summaryAll.total_detected_frames} / ${summaryAll.total_sampled_frames} フレームで姿勢を検出しました。日本語レポートはZIP内の reports/summary_report_ja.html です。`, 100);
  log("日本語レポート: ZIP内の reports/summary_report_ja.html を開いてください。");
  setBusy(false);
}

function collectSelectedVideos() {
  return VIEWS.flatMap((view) => {
    const file = elements.viewInputs[view.id].files?.[0];
    return file ? [{ view, file }] : [];
  });
}

async function analyzeOneVideo({
  item,
  viewIndex,
  totalViews,
  sampleFps,
  sampleLabel,
  poseLandmarker,
  progressStart,
  progressEnd,
}) {
  const { view, file } = item;
  const sourceUrl = URL.createObjectURL(file);
  state.objectUrls.push(sourceUrl);
  const video = elements.sourceVideo;
  video.src = sourceUrl;
  await waitForEvent(video, "loadedmetadata");
  await ensureVideoReady(video);

  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error(`${view.id}: 動画の長さを読み取れませんでした。別形式の動画で確認してください。`);
  }
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error(`${view.id}: 動画の幅・高さを読み取れませんでした。`);
  }

  const canvas = elements.overlayCanvas;
  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const sampleTimes = buildSampleTimes(video.duration, sampleFps);
  const baseName = safeFileStem(file.name);
  const coordinatesFileName = `${view.id}_${baseName}_landmarks_${sampleLabel}.csv`;
  const summaryJsonFileName = `${view.id}_${baseName}_summary.json`;
  const summaryCsvFileName = `${view.id}_${baseName}_summary.csv`;
  const summaryJaCsvFileName = `${view.id}_${baseName}_summary_ja.csv`;
  const overlayFileName = `${view.id}_${baseName}_landmarked_${sampleLabel}.webm`;
  const coordinateRows = [];
  let detectedFrames = 0;
  let overlayRecorder = null;
  let overlayBlob = null;
  let overlayError = "";

  log(`[${view.id}] 動画: ${file.name}`);
  log(`[${view.id}] 長さ: ${formatNumber(video.duration)}秒 / サイズ: ${video.videoWidth}x${video.videoHeight}`);
  log(`[${view.id}] sample fps: ${sampleFps} / サンプル数: ${sampleTimes.length}`);

  if (elements.writeOverlay.checked) {
    try {
      overlayRecorder = startOverlayRecorder(canvas, sampleFps);
      log(`[${view.id}] ランドマーク付き動画: ${overlayRecorder.mimeType} で生成します。`);
    } catch (error) {
      overlayError = error.message || String(error);
      log(`[${view.id}] ランドマーク付き動画の生成をスキップ: ${overlayError}`);
    }
  }

  for (let i = 0; i < sampleTimes.length; i += 1) {
    const timestampSec = sampleTimes[i];
    await seekVideo(video, timestampSec);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const timestampMs = Math.round(timestampSec * 1000);
    const result = poseLandmarker.detectForVideo(video, timestampMs);
    const landmarks = result.landmarks?.[0] || [];
    const worldLandmarks = result.worldLandmarks?.[0] || [];
    if (landmarks.length > 0) {
      detectedFrames += 1;
      drawLandmarks(ctx, landmarks, canvas.width, canvas.height);
    }

    coordinateRows.push(...makeCoordinateRows({
      viewId: view.id,
      fileName: file.name,
      sampleIndex: i,
      timestampSec,
      timestampMs,
      width: canvas.width,
      height: canvas.height,
      landmarks,
      worldLandmarks,
    }));

    if (overlayRecorder?.track?.requestFrame) {
      overlayRecorder.track.requestFrame();
    }
    if (overlayRecorder) {
      await sleep(50);
    }

    const frameProgress = sampleTimes.length ? (i + 1) / sampleTimes.length : 1;
    const percent = progressStart + frameProgress * (progressEnd - progressStart);
    setStatus(
      `解析中: ${view.label} ${view.id} (${viewIndex + 1}/${totalViews}) ${i + 1} / ${sampleTimes.length} フレーム`,
      percent,
    );
  }

  if (overlayRecorder) {
    setStatus(`ランドマーク付き動画を確定しています: ${view.label} ${view.id}`, progressEnd);
    overlayBlob = await stopOverlayRecorder(overlayRecorder);
  }

  const overlayGenerated = Boolean(overlayBlob?.size);
  const summary = {
    app: "MediaPipe Pose Landmarker Static HTML",
    view: view.id,
    view_label: view.label,
    source_file: file.name,
    source_size_bytes: file.size,
    video_width: video.videoWidth,
    video_height: video.videoHeight,
    duration_sec: video.duration,
    sample_fps: sampleFps,
    sampled_frames: sampleTimes.length,
    detected_frames: detectedFrames,
    detection_rate: sampleTimes.length ? detectedFrames / sampleTimes.length : 0,
    coordinates_csv: `coordinates/${view.id}/${coordinatesFileName}`,
    summary_json: `reports/${summaryJsonFileName}`,
    summary_csv: `reports/${summaryCsvFileName}`,
    write_overlay: elements.writeOverlay.checked,
    overlay_video: overlayGenerated ? `overlays/${view.id}/${overlayFileName}` : "",
    overlay_status: overlayGenerated ? "generated" : (elements.writeOverlay.checked ? "failed" : "not_requested"),
    overlay_error: overlayGenerated ? "" : overlayError,
    overlay_format: overlayGenerated ? "webm" : "",
  };

  const coordinatesCsv = toCsv(coordinateRows, COORDINATE_HEADERS);
  const summaryJson = JSON.stringify(summary, null, 2);
  const summaryCsv = toCsv([summary], Object.keys(summary));
  const summaryJaCsv = toCsvWithBom([summaryToJapaneseRow(summary)], SUMMARY_JA_HEADERS);
  return {
    view,
    coordinateRows,
    coordinatesCsv,
    summary,
    summaryJson,
    summaryCsv,
    summaryJaCsv,
    overlayBlob,
    filenames: {
      coordinates: coordinatesFileName,
      summaryJson: summaryJsonFileName,
      summaryCsv: summaryCsvFileName,
      summaryJaCsv: summaryJaCsvFileName,
      overlay: overlayFileName,
    },
    paths: {
      coordinatesCsv: `coordinates/${view.id}/${coordinatesFileName}`,
      summaryJson: `reports/${summaryJsonFileName}`,
      summaryCsv: `reports/${summaryCsvFileName}`,
      summaryJaCsv: `reports/${summaryJaCsvFileName}`,
      overlay: overlayGenerated ? `overlays/${view.id}/${overlayFileName}` : "",
    },
  };
}

async function getPoseLandmarker() {
  if (state.poseLandmarker) {
    return state.poseLandmarker;
  }
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const modelBuffer = await loadModelBuffer();
  const sharedOptions = {
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  try {
    state.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetBuffer: new Uint8Array(modelBuffer.slice(0)),
        delegate: "GPU",
      },
      ...sharedOptions,
    });
    return state.poseLandmarker;
  } catch (gpuError) {
    log(`GPU初期化に失敗したためCPUで再試行します: ${gpuError.message || gpuError}`);
    state.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetBuffer: new Uint8Array(modelBuffer.slice(0)),
        delegate: "CPU",
      },
      ...sharedOptions,
    });
    return state.poseLandmarker;
  }
}

async function loadModelBuffer() {
  const selectedModel = elements.modelFile.files?.[0];
  if (selectedModel) {
    state.modelSourceLabel = selectedModel.name;
    return selectedModel.arrayBuffer();
  }

  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.modelSourceLabel = MODEL_URL;
    return response.arrayBuffer();
  } catch (error) {
    throw new Error(`モデルを自動読込できませんでした。ローカルで直接開いている場合は models/pose_landmarker_full.task を「モデルファイル」に選択してください。詳細: ${error.message || error}`);
  }
}

function buildSampleTimes(durationSec, sampleFps) {
  const step = 1 / sampleFps;
  const times = [];
  for (let t = 0; t <= durationSec; t += step) {
    times.push(Math.min(t, durationSec));
  }
  if (times.length === 0 || times[times.length - 1] < durationSec) {
    times.push(durationSec);
  }
  return times;
}

function makeCoordinateRows({ viewId, fileName, sampleIndex, timestampSec, timestampMs, width, height, landmarks, worldLandmarks }) {
  if (!landmarks.length) {
    return [{
      view: viewId,
      source_file: fileName,
      sample_index: sampleIndex,
      timestamp_ms: timestampMs,
      timestamp_sec: timestampSec,
      pose_detected: 0,
      landmark_index: "",
      landmark_name: "",
      x_norm: "",
      y_norm: "",
      z_norm: "",
      visibility: "",
      presence: "",
      x_px: "",
      y_px: "",
      x_world: "",
      y_world: "",
      z_world: "",
    }];
  }

  return landmarks.map((landmark, index) => {
    const world = worldLandmarks[index] || {};
    return {
      view: viewId,
      source_file: fileName,
      sample_index: sampleIndex,
      timestamp_ms: timestampMs,
      timestamp_sec: timestampSec,
      pose_detected: 1,
      landmark_index: index,
      landmark_name: LANDMARK_NAMES[index] || `landmark_${index}`,
      x_norm: landmark.x,
      y_norm: landmark.y,
      z_norm: landmark.z,
      visibility: landmark.visibility ?? "",
      presence: landmark.presence ?? "",
      x_px: landmark.x * width,
      y_px: landmark.y * height,
      x_world: world.x ?? "",
      y_world: world.y ?? "",
      z_world: world.z ?? "",
    };
  });
}

function drawLandmarks(ctx, landmarks, width, height) {
  const points = landmarks.map((landmark) => {
    if (landmark.x < -0.1 || landmark.x > 1.1 || landmark.y < -0.1 || landmark.y > 1.1) {
      return null;
    }
    return {
      x: landmark.x * width,
      y: landmark.y * height,
    };
  });

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, Math.round(width / 240));
  ctx.strokeStyle = "#ffd43b";
  for (const [start, end] of POSE_CONNECTIONS) {
    const a = points[start];
    const b = points[end];
    if (!a || !b) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.fillStyle = "#ff4d4f";
  for (const point of points) {
    if (!point) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(3, Math.round(width / 180)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function startOverlayRecorder(canvas, sampleFps) {
  if (!window.MediaRecorder) {
    throw new Error("このブラウザは MediaRecorder に対応していません。");
  }
  const mimeType = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) {
    throw new Error("このブラウザではWebM形式の動画記録に対応していません。");
  }
  const streamFps = Math.max(1, Math.min(30, sampleFps));
  const stream = canvas.captureStream(streamFps);
  const track = stream.getVideoTracks()[0];
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) {
      chunks.push(event.data);
    }
  });
  recorder.start(250);
  return { recorder, chunks, stream, track, mimeType };
}

function stopOverlayRecorder(overlayRecorder) {
  return new Promise((resolve) => {
    overlayRecorder.recorder.addEventListener("stop", () => {
      overlayRecorder.stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(overlayRecorder.chunks, { type: overlayRecorder.mimeType }));
    }, { once: true });
    overlayRecorder.recorder.stop();
  });
}

function summaryToJapaneseRow(summary) {
  const overlayPath = summary.overlay_video || "なし";
  const noteParts = ["MediaPipeによる姿勢ランドマーク推定結果です。医学的診断ではありません。"];
  if (summary.overlay_status === "failed" && summary.overlay_error) {
    noteParts.push(`ランドマーク付き動画の生成エラー: ${summary.overlay_error}`);
  }
  return {
    "方向": `${summary.view_label || viewLabel(summary.view)} (${summary.view})`,
    "元動画ファイル名": summary.source_file,
    "動画長_秒": formatSeconds(summary.duration_sec),
    "sample_fps": summary.sample_fps,
    "解析対象フレーム数": summary.sampled_frames,
    "ランドマーク検出フレーム数": summary.detected_frames,
    "検出率_%": formatPercent(summary.detection_rate),
    "座標CSV": summary.coordinates_csv,
    "ランドマーク付き動画": overlayPath,
    "動画出力状態": overlayStatusJa(summary.overlay_status),
    "注意": noteParts.join(" "),
  };
}

function makeSummaryReportJa(summaryAll) {
  const rowsHtml = summaryAll.per_view.map((summary) => {
    const row = summaryToJapaneseRow(summary);
    return `<tr>
      <td>${escapeHtml(row["方向"])}</td>
      <td>${escapeHtml(row["元動画ファイル名"])}</td>
      <td>${escapeHtml(row["動画長_秒"])}</td>
      <td>${escapeHtml(row["sample_fps"])}</td>
      <td>${escapeHtml(row["解析対象フレーム数"])}</td>
      <td>${escapeHtml(row["ランドマーク検出フレーム数"])}</td>
      <td>${escapeHtml(row["検出率_%"])}</td>
      <td>${escapeHtml(row["座標CSV"])}</td>
      <td>${escapeHtml(row["ランドマーク付き動画"])}</td>
      <td>${escapeHtml(row["動画出力状態"])}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>MediaPipe Pose Landmarker 解析Summary</title>
<style>
body { font-family: Arial, "Yu Gothic", "Meiryo", sans-serif; color: #17202a; margin: 28px; line-height: 1.7; }
h1 { font-size: 24px; margin-bottom: 8px; }
h2 { font-size: 18px; margin-top: 24px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #d7e0e8; padding: 7px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #edf3f7; }
.note { background: #f7fafc; border-left: 4px solid #236192; padding: 10px 12px; }
code { background: #eef3f7; border-radius: 4px; padding: 1px 4px; }
</style>
</head>
<body>
<h1>MediaPipe Pose Landmarker 解析Summary</h1>
<p class="note">これは、ブラウザ上で選択した動画を MediaPipe Pose Landmarker で解析した結果の要約レポートです。動画はアプリ側サーバーへアップロードされず、利用者のブラウザ内で処理されました。</p>

<h2>解析した方向ごとの結果</h2>
<table>
<thead>
<tr>
<th>方向</th>
<th>元動画ファイル名</th>
<th>動画長_秒</th>
<th>sample fps</th>
<th>解析対象フレーム数</th>
<th>ランドマーク検出フレーム数</th>
<th>検出率</th>
<th>座標CSV</th>
<th>ランドマーク付き動画</th>
<th>動画出力状態</th>
</tr>
</thead>
<tbody>
${rowsHtml}
</tbody>
</table>

<h2>検出率の意味</h2>
<p>検出率は、解析対象フレーム数のうち MediaPipe が姿勢ランドマークを検出できたフレームの割合です。例: 99.5% は、解析したフレームのほぼ全てでランドマークが検出されたことを示します。</p>

<h2>sample fps の意味</h2>
<p><code>sample fps</code> は、1秒あたり何フレームを解析対象にするかを示します。値を大きくすると細かく解析できますが、処理時間、CSVサイズ、ZIPサイズ、ブラウザのメモリ使用量が増えます。長時間動画では 0.5〜1 を推奨します。</p>

<h2>ランドマーク付き動画の保存場所</h2>
<p>ランドマーク付き動画は、ZIP内の <code>overlays/front/</code>, <code>overlays/side/</code>, <code>overlays/back/</code>, <code>overlays/other/</code> に方向別で保存されます。動画形式はブラウザ標準の <code>.webm</code> です。</p>

<h2>座標CSVの保存場所</h2>
<p>座標CSVは、ZIP内の <code>coordinates/front/</code>, <code>coordinates/side/</code>, <code>coordinates/back/</code>, <code>coordinates/other/</code> に方向別で保存されます。</p>

<h2>注意</h2>
<p>この結果は医学的診断ではありません。MediaPipeによる姿勢ランドマーク推定結果であり、撮影条件、服装、照明、カメラ角度、遮蔽、ブラウザ性能などの影響を受けます。研究データ・個人情報として適切に管理してください。</p>
</body>
</html>`;
}

function makeReadmeResultsJa() {
  return `MediaPipe Pose Landmarker 解析結果ZIPの見方

最初に見るファイル:
  reports/summary_report_ja.html
    解析結果の日本語HTMLレポートです。どの動画を解析したか、検出率、座標CSV、ランドマーク付き動画の場所を確認できます。

ZIP内の主なフォルダ:
  coordinates/
    方向別のランドマーク座標CSVです。front, side, back, other に分かれます。

  overlays/
    方向別のランドマーク付き動画です。front, side, back, other に分かれます。

  reports/
    要約CSV、要約JSON、HTMLレポート、manifestが入ります。

主なファイル:
  reports/summary_all.csv
    機械処理向けの全体summary CSVです。

  reports/summary_all_ja.csv
    Excelで開きやすいBOM付き日本語summary CSVです。

  reports/summary_all.json
    全体summary JSONです。

  reports/summary_report_ja.html
    利用者向けの日本語HTMLレポートです。

  reports/manifest.json
    解析条件と出力ファイル一覧です。

.webm について:
  .webm はブラウザ標準の動画形式です。この静的HTML版では、ブラウザのMediaRecorderを使うため、ランドマーク付き動画は .webm として保存されます。

注意:
  この結果は医学的診断ではありません。MediaPipeによる姿勢ランドマーク推定結果です。動画、座標CSV、ランドマーク付き動画は研究データ・個人情報に該当する可能性があるため、適切に管理してください。
`;
}

function viewLabel(viewId) {
  return VIEWS.find((view) => view.id === viewId)?.label || viewId;
}

function overlayStatusJa(status) {
  if (status === "generated") {
    return "生成済み";
  }
  if (status === "failed") {
    return "生成失敗";
  }
  if (status === "not_requested") {
    return "未生成";
  }
  return status || "";
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  return `${(numeric * 100).toFixed(1)}%`;
}

function formatSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  return numeric.toFixed(2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function makeZip({
  perViewOutputs,
  summaryAllJson,
  summaryAllCsv,
  summaryAllJaCsv,
  summaryReportJaHtml,
  readmeResultsJa,
  manifestJson,
}) {
  const zip = new window.JSZip();
  for (const view of VIEWS) {
    zip.folder(`coordinates/${view.id}`);
    zip.folder(`overlays/${view.id}`);
  }
  zip.folder("reports");
  for (const output of perViewOutputs) {
    zip.file(output.paths.coordinatesCsv, output.coordinatesCsv);
    zip.file(output.paths.summaryJson, output.summaryJson);
    zip.file(output.paths.summaryCsv, output.summaryCsv);
    zip.file(output.paths.summaryJaCsv, output.summaryJaCsv);
    if (output.overlayBlob?.size && output.paths.overlay) {
      zip.file(output.paths.overlay, output.overlayBlob);
    }
  }
  zip.file("reports/summary_all.json", summaryAllJson);
  zip.file("reports/summary_all.csv", summaryAllCsv);
  zip.file("reports/summary_all_ja.csv", summaryAllJaCsv);
  zip.file("reports/summary_report_ja.html", summaryReportJaHtml);
  zip.file("reports/README_RESULTS_ja.txt", readmeResultsJa);
  zip.file("reports/manifest.json", manifestJson);
  return zip.generateAsync({ type: "blob" });
}

function setDownload(link, blob, filename) {
  const url = URL.createObjectURL(blob);
  state.objectUrls.push(url);
  link.href = url;
  link.download = filename;
  link.classList.remove("disabled");
  link.setAttribute("aria-disabled", "false");
}

function toCsvWithBom(rows, headers) {
  return CSV_BOM + toCsv(rows, headers);
}

function toCsv(rows, headers) {
  const escapeCell = (value) => {
    if (value === null || value === undefined) {
      return "";
    }
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
  ].join("\r\n");
}

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`動画の読み込みに失敗しました: ${target.error?.message || eventName}`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function ensureVideoReady(video) {
  if (video.readyState >= 2) {
    return;
  }
  await waitForEvent(video, "loadeddata");
}

function seekVideo(video, timestampSec) {
  const targetTime = Math.min(Math.max(timestampSec, 0), video.duration);
  if (Math.abs(video.currentTime - targetTime) < 0.001 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`動画のシークがタイムアウトしました: ${formatNumber(targetTime)}秒`));
    }, 15000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`動画のシークに失敗しました: ${targetTime}秒`));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = targetTime;
  });
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function safeFileStem(filename) {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[_\-.]+|[_\-.]+$/g, "") || "video";
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 3,
    useGrouping: false,
  });
}

resetOutputs();
