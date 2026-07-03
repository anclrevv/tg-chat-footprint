const fileInput = document.querySelector("#file-input");
const dropzone = document.querySelector("#dropzone");
const dashboard = document.querySelector("#dashboard");
const dashboardEmpty = document.querySelector("#dashboard-empty");
const statusText = document.querySelector("#status-text");
const progressFill = document.querySelector("#progress-fill");
const progressText = document.querySelector("#progress-text");
const fileMeta = document.querySelector("#file-meta");
const fileName = document.querySelector("#file-name");
const fileSize = document.querySelector("#file-size");
const selectedFilesPanel = document.querySelector("#selected-files");
const conversationSummary = document.querySelector("#conversation-summary");
const clearAnalysisButton = document.querySelector("#clear-analysis");
const reselectFileButton = document.querySelector("#reselect-file");
const analysisLive = document.querySelector("#analysis-live");
const conversationModeBadge = document.querySelector("#conversation-mode-badge");
const sessionThresholdSelect = document.querySelector("#session-threshold-select");
const trendTopNSelect = document.querySelector("#trend-topn-select");
const precisionBadge = document.querySelector("#precision-badge");
const tokenizerBadge = document.querySelector("#tokenizer-badge");
const customDictionaryInput = document.querySelector("#custom-dictionary");
const applyDictionaryButton = document.querySelector("#apply-dictionary");
const clearDictionaryButton = document.querySelector("#clear-dictionary");
const summaryGrid = document.querySelector("#summary-grid");
const insightsGrid = document.querySelector("#insights-grid");
const timelineChart = document.querySelector("#timeline-chart");
const dailyTimelineControls = document.querySelector("#daily-timeline-controls");
const dailyTimelineChart = document.querySelector("#daily-timeline-chart");
const heatmapChart = document.querySelector("#heatmap-chart");
const replyChart = document.querySelector("#reply-chart");
const daysTable = document.querySelector("#days-table");
const termsCloud = document.querySelector("#terms-cloud");
const phrasesPanel = document.querySelector("#phrases-panel");
const messageMixPanel = document.querySelector("#message-mix-panel");
const callsPanel = document.querySelector("#calls-panel");
const signalsPanel = document.querySelector("#signals-panel");
const reactionsPanel = document.querySelector("#reactions-panel");
const peopleTable = document.querySelector("#people-table");
const summaryCardTemplate = document.querySelector("#summary-card-template");
const replyInfoButton = document.querySelector("#reply-info-button");
const replyInfo = document.querySelector("#reply-info");
const chartTooltip = document.querySelector("#chart-tooltip");
const sidebar = document.querySelector("#sidebar");
const sidebarOverlay = document.querySelector("#sidebar-overlay");
const navToggle = document.querySelector("#nav-toggle");
const navLinks = [...document.querySelectorAll("[data-section-link]")];
const guideDialog = document.querySelector("#guide-dialog");
const guideOpenButtons = [document.querySelector("#guide-open"), document.querySelector("#guide-open-secondary")].filter(Boolean);
const guideCloseButton = document.querySelector("#guide-close");
const guideJump = document.querySelector("#guide-jump");

let currentFiles = [];
let dailyTimelineState = null;
let analysisWorker = null;
let isAnalyzing = false;
let lastDialogTrigger = null;
let currentPayload = null;
let currentSessionThreshold = null;
let currentTrendTopN = 8;
let peopleState = {
  search: "",
  sortKey: "messages",
  sortDirection: "desc",
  page: 1,
  pageSize: 25,
};
const CUSTOM_DICTIONARY_KEY = "tg-chat-footprint.customDictionary";
const PARTICIPANT_COLORS = ["#14b8a6", "#3b82f6", "#8b5cf6", "#f59e0b", "#22c55e", "#ef4444", "#06b6d4", "#64748b", "#94a3b8"];
const VALID_CONVERSATION_MODES = new Set(["direct", "group", "single"]);
const DEFAULT_SESSION_THRESHOLD_KEY = "1800000";
const DEFAULT_SESSION_THRESHOLD_VALUE = Number(DEFAULT_SESSION_THRESHOLD_KEY);
const MAX_FILE_COUNT = 20;
const LARGE_TOTAL_SIZE_WARNING_BYTES = 250 * 1024 * 1024;

customDictionaryInput.value = loadCustomDictionary();

initializeNavigation();
initializeGuideDialog();
resetUiState();

replyInfoButton.addEventListener("click", () => {
  const isHidden = replyInfo.classList.toggle("hidden");
  replyInfoButton.setAttribute("aria-expanded", String(!isHidden));
});

fileInput.addEventListener("change", (event) => {
  const files = [...(event.target.files || [])];
  if (files.length) {
    handleFiles(files);
  }
});

dropzone.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && !isAnalyzing) {
    event.preventDefault();
    fileInput.click();
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === "drop") {
      const files = [...(event.dataTransfer?.files || [])];
      if (files.length) {
        fileInput.files = event.dataTransfer.files;
        handleFiles(files);
      }
    }
    dropzone.classList.remove("dragover");
  });
});

clearAnalysisButton.addEventListener("click", clearAnalysis);
reselectFileButton.addEventListener("click", () => {
  fileInput.click();
});

sessionThresholdSelect.addEventListener("change", () => {
  currentSessionThreshold = Number(sessionThresholdSelect.value);
  renderThresholdDependentViews();
});

trendTopNSelect.addEventListener("change", () => {
  currentTrendTopN = Number(trendTopNSelect.value);
  renderTrendViews();
});

applyDictionaryButton.addEventListener("click", () => {
  const dictionary = normalizeDictionaryText(customDictionaryInput.value).join("\n");
  customDictionaryInput.value = dictionary;
  saveCustomDictionary(dictionary);
  if (currentFiles.length && !isAnalyzing) {
    handleFiles(currentFiles);
  }
});

clearDictionaryButton.addEventListener("click", () => {
  customDictionaryInput.value = "";
  saveCustomDictionary("");
  if (currentFiles.length && !isAnalyzing) {
    handleFiles(currentFiles);
  }
});

function createAnalysisWorker() {
  const worker = new Worker("./worker.js", { type: "module" });
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", () => {
    showError("瀏覽器背景分析程序啟動失敗，請重新整理頁面後再試一次。");
  });
  return worker;
}

function handleWorkerMessage({ data }) {
  if (data.type === "progress") {
    statusText.textContent = data.label;
    setProgress(data.progress);
    if (currentFiles.length) {
      const filePrefix = data.totalFiles > 1
        ? `第 ${data.currentFileIndex.toLocaleString()} / ${data.totalFiles.toLocaleString()} 個檔案`
        : "目前檔案";
      fileMeta.textContent = `${filePrefix}：已處理 ${data.processedMessages.toLocaleString()} 則訊息`;
      updateSelectedFileStatus(data.currentFileIndex - 1, "analyzing");
    }
    return;
  }

  if (data.type === "result") {
    completeAnalysis(data.payload);
    return;
  }

  if (data.type === "error") {
    showError(data.message || "這份檔案目前無法讀取，請確認是否為 Telegram 匯出的 result.json。");
  }
}

function completeAnalysis(payload) {
  const validation = validateAnalysisResult(payload);
  if (!validation.valid) {
    showError(`分析完成，但結果格式不完整：${validation.errors.join("、")}`);
    return;
  }

  try {
    renderDashboard(validation.normalized);
    showResults();
    isAnalyzing = false;
    setInputDisabled(false);
    setProgress(100);
    statusText.classList.remove("status-error");
    statusText.textContent = "分析完成，可以開始看內容了";
    fileMeta.textContent = buildMergeSummaryText(validation.normalized.mergeMeta) || "分析完成，結果已更新。";
    renderSelectedFiles(currentFiles, validation.normalized.mergeMeta);
    analysisLive.textContent = "分析完成，結果已更新。";
    scrollDashboardIntoView();
  } catch (error) {
    logAnalysisRenderFailure(error, validation.normalized);
    showError("分析完成，但顯示結果時發生錯誤。請清除後重新匯入。");
  }
}

function handleFiles(files) {
  if (isAnalyzing) {
    return;
  }

  const nextFiles = normalizeSelectedFiles(files);
  if (!nextFiles.length) {
    return;
  }

  if (nextFiles.length > MAX_FILE_COUNT) {
    showError(`一次最多選擇 ${MAX_FILE_COUNT} 個 JSON 檔案。請移除部分檔案後重試。`);
    return;
  }

  currentFiles = nextFiles;
  const invalidFiles = nextFiles.filter((file) => !isLikelyJsonFile(file));
  if (invalidFiles.length) {
    renderSelectedFiles(nextFiles);
    fileName.textContent = nextFiles.length === 1 ? nextFiles[0].name : `${nextFiles.length.toLocaleString()} 個檔案`;
    fileSize.textContent = formatBytes(sumFileSizes(nextFiles));
    showError("有檔案不是 JSON 格式。請移除標示為非 JSON 的檔案後重試。");
    return;
  }

  terminateWorker();
  analysisWorker = createAnalysisWorker();
  isAnalyzing = true;
  clearRenderedResults();
  hideResults();
  statusText.classList.remove("status-error");
  setInputDisabled(true);
  setProgress(0);
  statusText.textContent = buildSelectedFilesStatus(nextFiles);
  fileName.textContent = nextFiles.length === 1 ? nextFiles[0].name : `${nextFiles.length.toLocaleString()} 個檔案`;
  fileSize.textContent = formatBytes(sumFileSizes(nextFiles));
  fileMeta.textContent = buildSizeWarning(nextFiles) || "背景分析中，請保持此頁開啟。";
  renderSelectedFiles(nextFiles);
  analysisLive.textContent = "已開始分析檔案。";
  analysisWorker.postMessage({
    type: "analyze",
    files: nextFiles,
    options: {
      customDictionary: normalizeDictionaryText(customDictionaryInput.value),
    },
  });
}

function normalizeSelectedFiles(files) {
  return [...files].filter(Boolean);
}

function buildSelectedFilesStatus(files) {
  if (files.length === 1) {
    return "已選擇 1 個檔案";
  }
  return `已選擇 ${files.length.toLocaleString()} 個檔案，將確認是否屬於同一個對話後合併分析。`;
}

function sumFileSizes(files) {
  return files.reduce((sum, file) => sum + (file.size || 0), 0);
}

function buildSizeWarning(files) {
  const totalSize = sumFileSizes(files);
  if (totalSize <= LARGE_TOTAL_SIZE_WARNING_BYTES) {
    return "";
  }
  return `總大小 ${formatBytes(totalSize)}，大型檔案可能需要較長時間，請保持此頁開啟。`;
}

function buildMergeSummaryText(mergeMeta) {
  if (!mergeMeta || !mergeMeta.fileCount) {
    return "";
  }
  if (mergeMeta.fileCount === 1) {
    return `已分析 1 個檔案，實際分析 ${mergeMeta.uniqueMessageCount.toLocaleString()} 則訊息。`;
  }
  return `已合併 ${mergeMeta.fileCount.toLocaleString()} 個檔案，移除 ${mergeMeta.duplicateMessageCount.toLocaleString()} 則重複訊息，實際分析 ${mergeMeta.uniqueMessageCount.toLocaleString()} 則訊息。`;
}

function validateAnalysisResult(result) {
  const errors = [];
  if (!isPlainObject(result)) {
    return {
      valid: false,
      errors: ["result 必須是 object"],
      normalized: normalizeAnalysisResult({}),
    };
  }

  if (!isPlainObject(result.summary)) {
    errors.push("summary");
  }
  if (result.conversationMode !== undefined && !VALID_CONVERSATION_MODES.has(result.conversationMode)) {
    errors.push("conversationMode");
  }
  if (result.timeline !== undefined && !Array.isArray(result.timeline)) {
    errors.push("timeline");
  }
  if (result.people !== undefined && !Array.isArray(result.people)) {
    errors.push("people");
  }
  if (result.messageMix !== undefined && !Array.isArray(result.messageMix)) {
    errors.push("messageMix");
  }
  if (result.sessionMetricsByThreshold !== undefined && !isPlainObject(result.sessionMetricsByThreshold)) {
    errors.push("sessionMetricsByThreshold");
  }
  if (result.calls !== undefined && !isPlainObject(result.calls)) {
    errors.push("calls");
  }
  if (result.analysisPrecision !== undefined && !isPlainObject(result.analysisPrecision)) {
    errors.push("analysisPrecision");
  }

  return {
    valid: !errors.includes("summary") && !errors.includes("timeline") && !errors.includes("people") && !errors.includes("messageMix"),
    errors,
    normalized: normalizeAnalysisResult(result),
  };
}

function normalizeAnalysisResult(result) {
  const source = isPlainObject(result) ? result : {};
  const people = normalizePeople(source.people);
  const conversationMode = VALID_CONVERSATION_MODES.has(source.conversationMode)
    ? source.conversationMode
    : inferConversationMode(source, people);
  const participantCount = toSafeNumber(source.participantCount ?? source.summary?.participantCount ?? people.length, people.length);
  const sessionMetricsByThreshold = normalizeSessionMetricsByThreshold(source.sessionMetricsByThreshold);
  const selectedMetrics = selectSessionMetrics(
    sessionMetricsByThreshold,
    source.selectedSessionThreshold ?? DEFAULT_SESSION_THRESHOLD_VALUE,
  );

  return {
    ...source,
    conversationMode,
    participantCount,
    telegramChatType: typeof source.telegramChatType === "string" ? source.telegramChatType : "unknown",
    participants: normalizeStringArray(source.participants, people.map((person) => person.name)),
    trendViewsByTopN: isPlainObject(source.trendViewsByTopN) ? source.trendViewsByTopN : {},
    selectedSessionThreshold: selectedMetrics?.threshold ?? DEFAULT_SESSION_THRESHOLD_VALUE,
    sessionThresholdOptions: normalizeSessionThresholdOptions(source.sessionThresholdOptions, sessionMetricsByThreshold),
    sessionMetricsByThreshold,
    groupMetrics: normalizeGroupMetrics(source.groupMetrics),
    analysisPrecision: isPlainObject(source.analysisPrecision) ? source.analysisPrecision : {},
    wordAnalysisMeta: normalizeWordAnalysisMeta(source.wordAnalysisMeta),
    presentationLimits: normalizePresentationLimits(source.presentationLimits, participantCount),
    summary: normalizeSummary(source.summary, { conversationMode, participantCount }),
    insights: normalizeInsights(source.insights),
    timeline: normalizeArray(source.timeline),
    dailyTimeline: normalizeArray(source.dailyTimeline),
    heatmap: normalizeHeatmap(source.heatmap),
    replyHistogram: normalizeReplyHistogram(source.replyHistogram),
    topDays: normalizeArray(source.topDays),
    topTerms: normalizeArray(source.topTerms),
    catchphrases: normalizeCatchphrases(source.catchphrases),
    messageMix: normalizeMessageMix(source.messageMix),
    calls: normalizeCalls(source.calls),
    people,
    participantDisplay: normalizeParticipantDisplay(source.participantDisplay, participantCount),
    topReactions: normalizeArray(source.topReactions),
    mergeMeta: normalizeMergeMeta(source.mergeMeta),
  };
}

function normalizeMergeMeta(meta) {
  const source = isPlainObject(meta) ? meta : {};
  return {
    fileCount: toSafeNumber(source.fileCount, 0),
    totalInputBytes: toSafeNumber(source.totalInputBytes, 0),
    rawMessageCount: toSafeNumber(source.rawMessageCount, 0),
    duplicateMessageCount: toSafeNumber(source.duplicateMessageCount, 0),
    uniqueMessageCount: toSafeNumber(source.uniqueMessageCount, 0),
    chatIdentityConfidence: source.chatIdentityConfidence === "inferred" ? "inferred" : "exact",
    sourceFiles: normalizeArray(source.sourceFiles).map((file) => ({
      name: String(file?.name || ""),
      size: toSafeNumber(file?.size, 0),
      rawMessageCount: toSafeNumber(file?.rawMessageCount, 0),
      duplicateMessageCount: toSafeNumber(file?.duplicateMessageCount, 0),
    })),
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value, fallback = []) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return source.map((entry) => String(entry || "Unknown"));
}

function normalizeSummary(summary, { conversationMode, participantCount }) {
  const source = isPlainObject(summary) ? summary : {};
  const totalMessages = toSafeNumber(source.totalMessages, 0);
  const activeDays = toSafeNumber(source.activeDays, 0);
  const spanDays = toSafeNumber(source.spanDays, 0);
  return {
    ...source,
    totalMessages,
    conversationMode,
    telegramChatType: source.telegramChatType || "unknown",
    participantCount,
    displayedParticipantCount: toSafeNumber(source.displayedParticipantCount, participantCount),
    textMessages: toSafeNumber(source.textMessages, 0),
    editedMessages: toSafeNumber(source.editedMessages, 0),
    forwardedMessages: toSafeNumber(source.forwardedMessages, 0),
    linkedMessages: toSafeNumber(source.linkedMessages, 0),
    reactedMessages: toSafeNumber(source.reactedMessages, 0),
    totalReactionCount: toSafeNumber(source.totalReactionCount, 0),
    activeDays,
    spanDays,
    rangeLabel: source.rangeLabel || "暫無",
    avgPerActiveDay: source.avgPerActiveDay || "0",
    activeDensityLabel: source.activeDensityLabel || "暫無",
    activeDensityMeta: source.activeDensityMeta || "目前資料還不夠",
    balanceLabel: source.balanceLabel || "暫無",
    balanceMeta: source.balanceMeta || "目前資料還不夠",
    immediateReplyLabel: source.immediateReplyLabel || "暫無",
    immediateReplyMeta: source.immediateReplyMeta || "目前還沒有足夠的短間隔回覆",
    restartReplyLabel: source.restartReplyLabel || "暫無",
    restartReplyMeta: source.restartReplyMeta || "目前還沒有足夠的重啟對話",
  };
}

function normalizeInsights(insights) {
  const source = isPlainObject(insights) ? insights : {};
  return {
    activeHours: normalizeInsightCard(source.activeHours),
    burstiness: normalizeInsightCard(source.burstiness),
    stickiness: normalizeInsightCard(source.stickiness),
    restartFrequency: normalizeInsightCard(source.restartFrequency),
    replyAsymmetry: normalizeInsightCard(source.replyAsymmetry),
    initiative: normalizeInsightCard(source.initiative),
  };
}

function normalizeInsightCard(card) {
  const source = isPlainObject(card) ? card : {};
  return {
    label: source.label || "暫無",
    meta: source.meta || "目前資料還不夠",
    rows: normalizeArray(source.rows),
  };
}

function normalizeSessionMetricsByThreshold(metricsByThreshold) {
  const source = isPlainObject(metricsByThreshold) ? metricsByThreshold : {};
  const entries = Object.entries(source);
  const output = {};
  if (!entries.length) {
    output[DEFAULT_SESSION_THRESHOLD_KEY] = normalizeSessionMetrics({});
    return output;
  }
  for (const [key, metrics] of entries) {
    output[key] = normalizeSessionMetrics(metrics, Number(key));
  }
  if (!output[DEFAULT_SESSION_THRESHOLD_KEY]) {
    output[DEFAULT_SESSION_THRESHOLD_KEY] = normalizeSessionMetrics({});
  }
  return output;
}

function normalizeSessionMetrics(metrics, threshold = DEFAULT_SESSION_THRESHOLD_VALUE) {
  const source = isPlainObject(metrics) ? metrics : {};
  return {
    ...source,
    threshold: toSafeNumber(source.threshold, threshold),
    thresholdLabel: source.thresholdLabel || formatThresholdLabelForUi(threshold),
    quickReplyThreshold: toSafeNumber(source.quickReplyThreshold, Math.min(threshold, 60 * 60_000)),
    quickReplyThresholdLabel: source.quickReplyThresholdLabel || formatThresholdLabelForUi(Math.min(threshold, 60 * 60_000)),
    sessionCount: toSafeNumber(source.sessionCount, 0),
    sessionMedian: source.sessionMedian ?? null,
    restartCount: toSafeNumber(source.restartCount, 0),
    restartMedian: source.restartMedian ?? null,
    restartInitiators: normalizeArray(source.restartInitiators),
    longestSilence: source.longestSilence ?? null,
    turnSwitchCount: toSafeNumber(source.turnSwitchCount, 0),
    quickReplyCount: toSafeNumber(source.quickReplyCount, 0),
    replyBuckets: Array.isArray(source.replyBuckets) ? source.replyBuckets : [],
    replyMedian: source.replyMedian ?? null,
    replyP90: source.replyP90 ?? null,
    directionalReplies: normalizeArray(source.directionalReplies),
    precision: isPlainObject(source.precision) ? source.precision : {},
  };
}

function normalizeSessionThresholdOptions(options, metricsByThreshold) {
  if (Array.isArray(options) && options.length) {
    return options;
  }
  return Object.values(metricsByThreshold).map((metrics) => ({
    value: metrics.threshold,
    label: metrics.thresholdLabel,
  }));
}

function normalizeGroupMetrics(groupMetrics) {
  const source = isPlainObject(groupMetrics) ? groupMetrics : {};
  return {
    activeParticipantCount: toSafeNumber(source.activeParticipantCount, 0),
    topParticipantShare: toSafeNumber(source.topParticipantShare, 0),
    topParticipantShareLabel: source.topParticipantShareLabel || "0.0%",
    topThreeShare: toSafeNumber(source.topThreeShare, 0),
    topThreeShareLabel: source.topThreeShareLabel || "0.0%",
    medianMessagesPerParticipant: toSafeNumber(source.medianMessagesPerParticipant, 0),
    starterRanking: normalizeArray(source.starterRanking),
    concentrationLevel: source.concentrationLevel || "low",
    concentrationLabel: source.concentrationLabel || "目前資料還不夠",
  };
}

function normalizeWordAnalysisMeta(meta) {
  const source = isPlainObject(meta) ? meta : {};
  return {
    tokenizer: source.tokenizer || "unknown",
    locale: source.locale || "zh-Hant",
    customDictionaryCount: toSafeNumber(source.customDictionaryCount, 0),
    analyzedTextMessageCount: toSafeNumber(source.analyzedTextMessageCount, 0),
    rejectedTokenCount: toSafeNumber(source.rejectedTokenCount, 0),
  };
}

function normalizePresentationLimits(limits, participantCount) {
  const source = isPlainObject(limits) ? limits : {};
  return {
    trendTopNDefault: toSafeNumber(source.trendTopNDefault, 8),
    trendTopNOptions: Array.isArray(source.trendTopNOptions) ? source.trendTopNOptions : [5, 8, 12, 20],
    participantTableTotal: toSafeNumber(source.participantTableTotal, participantCount),
    personalWordStatsComputedFor: toSafeNumber(source.personalWordStatsComputedFor, participantCount),
    personalTypeStatsComputedFor: toSafeNumber(source.personalTypeStatsComputedFor, participantCount),
  };
}

function normalizeHeatmap(heatmap) {
  if (!Array.isArray(heatmap)) {
    return Array.from({ length: 7 }, () => Array(24).fill(0));
  }
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const row = Array.isArray(heatmap[dayIndex]) ? heatmap[dayIndex] : [];
    return Array.from({ length: 24 }, (_, hour) => toSafeNumber(row[hour], 0));
  });
}

function normalizeReplyHistogram(histogram) {
  const source = isPlainObject(histogram) ? histogram : {};
  return {
    bins: normalizeArray(source.bins),
    precision: source.precision || "exact",
    longestGapLabel: source.longestGapLabel || "暫無",
    longestGapRange: source.longestGapRange || "目前資料還不夠",
  };
}

function normalizeCatchphrases(catchphrases) {
  return normalizeArray(catchphrases).map((person) => ({
    ...person,
    name: person?.name || "Unknown",
    messageShare: person?.messageShare || "0.0",
    topWords: normalizeArray(person?.topWords).map(normalizeCountEntry),
    topPhrases: normalizeArray(person?.topPhrases).map((entry) => ({
      ...entry,
      term: entry?.term || "",
      totalCount: toSafeNumber(entry?.totalCount, 0),
      messageCount: toSafeNumber(entry?.messageCount ?? entry?.count, 0),
      activeDayCount: toSafeNumber(entry?.activeDayCount, 0),
      count: toSafeNumber(entry?.messageCount ?? entry?.count ?? entry?.totalCount, 0),
    })),
    toneMarkers: normalizeArray(person?.toneMarkers).map(normalizeCountEntry),
  }));
}

function normalizeMessageMix(messageMix) {
  return normalizeArray(messageMix).map((person) => ({
    ...person,
    name: person?.name || "Unknown",
    total: toSafeNumber(person?.total, 0),
    categories: normalizeArray(person?.categories),
  }));
}

function normalizeCountEntry(entry) {
  return {
    ...entry,
    term: entry?.term || "",
    label: entry?.label || entry?.term || "",
    count: toSafeNumber(entry?.count, 0),
  };
}

function normalizeCalls(calls) {
  const source = isPlainObject(calls) ? calls : {};
  const totalCalls = toSafeNumber(source.totalCalls ?? source.total, 0);
  return {
    ...source,
    total: toSafeNumber(source.total, totalCalls),
    totalCalls,
    connected: toSafeNumber(source.connected, 0),
    missed: toSafeNumber(source.missed, 0),
    totalDurationSeconds: toSafeNumber(source.totalDurationSeconds, 0),
    totalDurationLabel: source.totalDurationLabel || "0 秒",
    avgDurationLabel: source.avgDurationLabel || "0 秒",
    callsWithDuration: toSafeNumber(source.callsWithDuration, 0),
    callsWithoutDuration: toSafeNumber(source.callsWithoutDuration, 0),
    durationCompletenessRate: toSafeNumber(source.durationCompletenessRate, 0),
    durationCompletenessLabel: source.durationCompletenessLabel || "0.0%",
    callsWithResult: toSafeNumber(source.callsWithResult, 0),
    callsWithoutResult: toSafeNumber(source.callsWithoutResult, 0),
    byParticipant: normalizeArray(source.byParticipant),
    byMonth: normalizeArray(source.byMonth),
    byHour: normalizeArray(source.byHour),
    outcomes: normalizeArray(source.outcomes),
    topCaller: source.topCaller || null,
    topHour: source.topHour || null,
  };
}

function normalizePeople(people) {
  return normalizeArray(people).map((person) => ({
    ...person,
    name: person?.name || "Unknown",
    messages: toSafeNumber(person?.messages, 0),
    characters: toSafeNumber(person?.characters, 0),
    avgChars: toSafeNumber(person?.avgChars, 0),
    mediaShare: person?.mediaShare ?? "0.0",
    edits: toSafeNumber(person?.edits, 0),
    forwards: toSafeNumber(person?.forwards, 0),
    links: toSafeNumber(person?.links, 0),
    reactionCountReceived: toSafeNumber(person?.reactionCountReceived, 0),
    reactionsReceived: normalizeArray(person?.reactionsReceived),
  }));
}

function normalizeParticipantDisplay(display, participantCount) {
  const source = isPlainObject(display) ? display : {};
  return {
    total: toSafeNumber(source.total, participantCount),
    timelineLimit: toSafeNumber(source.timelineLimit, 8),
    timelineHasOther: Boolean(source.timelineHasOther),
  };
}

function inferConversationMode(source, people) {
  const participantCount = toSafeNumber(source.participantCount ?? source.summary?.participantCount ?? people.length, people.length);
  if (participantCount <= 1) {
    return "single";
  }
  return participantCount === 2 ? "direct" : "group";
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatThresholdLabelForUi(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${minutes} 分鐘`;
  }
  const hours = ms / 3_600_000;
  return Number.isInteger(hours) ? `${hours} 小時` : `${hours.toFixed(1)} 小時`;
}

function setProgress(value) {
  const safeValue = Math.max(0, Math.min(100, value));
  progressFill.style.width = `${safeValue}%`;
  progressText.textContent = `${safeValue.toFixed(1)}%`;
}

function renderDashboard(payload) {
  currentPayload = payload;
  const selectedMetrics = selectSessionMetrics(payload.sessionMetricsByThreshold, currentSessionThreshold || payload.selectedSessionThreshold);
  currentSessionThreshold = selectedMetrics?.threshold || payload.selectedSessionThreshold || DEFAULT_SESSION_THRESHOLD_VALUE;
  currentTrendTopN = payload.presentationLimits?.trendTopNDefault || currentTrendTopN;
  trendTopNSelect.value = String(currentTrendTopN);
  renderAnalysisControls(payload);
  renderDatasetStrip(payload);
  renderThresholdDependentViews();
  renderTrendViews();
  renderHeatmap(payload.heatmap);
  renderTopDays(payload.topDays);
  renderTerms(payload.topTerms);
  renderCatchphrases(payload.catchphrases);
  renderMessageMix(payload.messageMix);
  renderCalls(payload.calls);
  renderSignals(payload.summary);
  renderTopReactions(payload.topReactions, payload.summary.totalReactionCount);
  renderPeople(payload.people, payload.participantDisplay);
}

function renderAnalysisControls(payload) {
  conversationModeBadge.textContent = getConversationModeLabel(payload.conversationMode);
  const options = Array.isArray(payload.sessionThresholdOptions) ? payload.sessionThresholdOptions : [];
  sessionThresholdSelect.innerHTML = options
    .map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`)
    .join("");
  sessionThresholdSelect.value = String(currentSessionThreshold || payload.selectedSessionThreshold);
  precisionBadge.textContent = getPrecisionLabel(payload.analysisPrecision?.replyMedian);
  tokenizerBadge.textContent = payload.wordAnalysisMeta
    ? `${payload.wordAnalysisMeta.tokenizer === "intl-segmenter" ? "原生斷詞" : "fallback 斷詞"} · ${payload.wordAnalysisMeta.customDictionaryCount} 個自訂詞`
    : "斷詞";
}

function renderThresholdDependentViews() {
  if (!currentPayload) {
    return;
  }
  const metrics = getSelectedSessionMetrics();
  const summary = buildSummaryForThreshold(currentPayload.summary, metrics);
  renderSummary(summary, currentPayload.groupMetrics);
  renderInsights(buildInsightsForThreshold(currentPayload.insights, metrics, currentPayload));
  renderReplyHistogram(buildReplyHistogramForThreshold(metrics));
  precisionBadge.textContent = getPrecisionLabel(metrics?.precision?.replyMedian);
}

function renderTrendViews() {
  if (!currentPayload) {
    return;
  }
  const view = currentPayload.trendViewsByTopN?.[String(currentTrendTopN)] || {
    participants: currentPayload.participants,
    timeline: currentPayload.timeline,
    dailyTimeline: currentPayload.dailyTimeline,
  };
  renderTimeline(normalizeArray(view.timeline), normalizeStringArray(view.participants));
  renderDailyTimeline(normalizeArray(view.dailyTimeline), normalizeStringArray(view.participants));
}

function renderDatasetStrip(payload) {
  const { summary } = payload;
  const firstDate = getFirstTimelineDate(payload);
  const lastDate = getLastTimelineDate(payload);
  const fileLabel = payload.mergeMeta?.fileCount > 1
    ? `${payload.mergeMeta.fileCount.toLocaleString()} 個 JSON 檔案`
    : currentFiles[0]?.name || "Telegram 對話";
  conversationSummary.textContent = `${fileLabel} • ${getConversationModeLabel(payload.conversationMode)} • ${summary.totalMessages.toLocaleString()} 則訊息 • ${summary.participantCount.toLocaleString()} 位參與者 • ${firstDate} 到 ${lastDate}`;
}

function getSelectedSessionMetrics() {
  return selectSessionMetrics(currentPayload?.sessionMetricsByThreshold, currentSessionThreshold || currentPayload?.selectedSessionThreshold);
}

function selectSessionMetrics(metricsByThreshold, selectedThreshold) {
  const metrics = isPlainObject(metricsByThreshold) ? metricsByThreshold : {};
  const key = String(selectedThreshold || "");
  return metrics[key] || metrics[DEFAULT_SESSION_THRESHOLD_KEY] || Object.values(metrics)[0] || null;
}

function buildSummaryForThreshold(summary, metrics) {
  if (!metrics) {
    return summary;
  }
  return {
    ...summary,
    immediateReplyLabel: metrics.replyP90 === null ? "暫無" : formatDuration(metrics.replyP90),
    immediateReplyMeta: metrics.turnSwitchCount
      ? `${metrics.quickReplyCount.toLocaleString()} 次 ${metrics.quickReplyThresholdLabel}內接話；回覆速度僅計算同一段對話內的換人接話`
      : "目前還沒有足夠的短間隔回覆",
    restartReplyLabel: metrics.restartMedian === null ? "暫無" : formatDuration(metrics.restartMedian),
    restartReplyMeta: metrics.restartCount
      ? `以 ${metrics.thresholdLabel} 作為對話斷點，${metrics.restartCount.toLocaleString()} 次重啟間隔的中位數`
      : "目前還沒有足夠的重啟對話",
  };
}

function buildInsightsForThreshold(baseInsights, metrics, payload) {
  if (!metrics) {
    return baseInsights;
  }
  return {
    ...baseInsights,
    stickiness: {
      label: metrics.turnSwitchCount
        ? `${((metrics.quickReplyCount / metrics.turnSwitchCount) * 100).toFixed(1)}%`
        : "暫無",
      meta: metrics.turnSwitchCount
        ? `${metrics.quickReplyCount.toLocaleString()} / ${metrics.turnSwitchCount.toLocaleString()} 次輪流回覆在 ${metrics.quickReplyThresholdLabel}內接上`
        : "目前還沒有足夠的輪流回覆資料",
    },
    restartFrequency: {
      label: metrics.restartCount && payload.summary.spanDays
        ? `${(metrics.restartCount / Math.max(payload.summary.spanDays / 7, 1)).toFixed(1)} 次/週`
        : "暫無",
      meta: metrics.restartCount
        ? `以 ${metrics.thresholdLabel} 作為對話斷點，共 ${metrics.restartCount.toLocaleString()} 次重啟`
        : "目前還沒有足夠的重啟對話資料",
    },
  };
}

function buildReplyHistogramForThreshold(metrics) {
  if (!metrics || !Array.isArray(metrics.replyBuckets)) {
    return { bins: [] };
  }
  return {
    bins: metrics.replyBuckets.map((count, index) => ({
      label: ["0-5s", "5-20s", "20-60s", "1-5m", "5-30m", "30m-6h", "6h-1d", ">1d"][index],
      count,
    })),
    precision: metrics.precision?.replyMedian,
    longestGapLabel: metrics.longestSilence ? formatDuration(metrics.longestSilence.duration) : "暫無",
    longestGapRange: metrics.longestSilence
      ? `${formatShortDate(metrics.longestSilence.from)} → ${formatShortDate(metrics.longestSilence.to)}`
      : "目前資料還不夠",
  };
}

function getConversationModeLabel(mode) {
  if (mode === "group") {
    return "群組";
  }
  if (mode === "single") {
    return "單人／特殊對話";
  }
  return "一對一";
}

function getPrecisionLabel(value) {
  return value === "approximate" ? "大型資料近似" : "精確";
}

function renderInsights(insights) {
  const cards = [
    {
      label: "活躍時段",
      value: insights.activeHours.label,
      meta: insights.activeHours.meta,
    },
    {
      label: "爆量程度",
      value: insights.burstiness.label,
      meta: insights.burstiness.meta,
    },
    {
      label: "即時回覆率",
      value: insights.stickiness.label,
      meta: insights.stickiness.meta,
    },
    {
      label: "重啟頻率",
      value: insights.restartFrequency.label,
      meta: insights.restartFrequency.meta,
    },
    {
      label: "雙向回覆速度",
      value: insights.replyAsymmetry.label,
      meta: insights.replyAsymmetry.meta,
      rows: insights.replyAsymmetry.rows || [],
    },
    {
      label: "誰先開口",
      value: insights.initiative.label,
      meta: insights.initiative.meta,
      rows: insights.initiative.rows || [],
    },
  ];

  insightsGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="insight-card">
          <p class="insight-label">${escapeHtml(card.label)}</p>
          <p class="insight-value">${escapeHtml(card.value)}</p>
          <p class="insight-meta">${escapeHtml(card.meta)}</p>
          ${
            card.rows?.length
              ? `<div class="insight-rows">
                  ${card.rows
                    .map(
                      (row) => `
                        <div class="insight-row">
                          <span class="insight-row-label">${escapeHtml(row.label)}</span>
                          <strong class="insight-row-value">${escapeHtml(row.value)}</strong>
                        </div>
                      `,
                    )
                    .join("")}
                </div>`
              : ""
          }
        </article>
      `,
    )
    .join("");
}

function scrollDashboardIntoView() {
  dashboard.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
}

function initializeNavigation() {
  navToggle.addEventListener("click", () => {
    const shouldOpen = !sidebar.classList.contains("is-open");
    setDrawerOpen(shouldOpen);
  });

  sidebarOverlay.addEventListener("click", () => setDrawerOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setDrawerOpen(false);
    }
  });

  for (const link of navLinks) {
    link.addEventListener("click", () => setDrawerOpen(false));
  }

  const observedSections = [...document.querySelectorAll("[data-section]")];
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!visible) {
        return;
      }
      setActiveSection(visible.target.id);
    },
    {
      rootMargin: "-20% 0px -65% 0px",
      threshold: [0.1, 0.3, 0.6],
    },
  );

  for (const section of observedSections) {
    observer.observe(section);
  }
}

function initializeGuideDialog() {
  for (const button of guideOpenButtons) {
    button.addEventListener("click", () => openGuideDialog(button));
  }
  guideCloseButton.addEventListener("click", closeGuideDialog);
  guideJump.addEventListener("click", closeGuideDialog);
  guideDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeGuideDialog();
  });
  guideDialog.addEventListener("keydown", trapDialogFocus);
}

function openGuideDialog(trigger) {
  lastDialogTrigger = trigger;
  if (typeof guideDialog.showModal === "function") {
    guideDialog.showModal();
    guideCloseButton.focus();
  } else {
    document.querySelector("#usage-guide").scrollIntoView({ behavior: "smooth" });
  }
}

function closeGuideDialog() {
  if (guideDialog.open) {
    guideDialog.close();
  }
  lastDialogTrigger?.focus();
}

function trapDialogFocus(event) {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = [
    ...guideDialog.querySelectorAll("a[href], button:not(:disabled), [tabindex]:not([tabindex='-1'])"),
  ].filter((element) => element.offsetParent !== null);
  if (!focusable.length) {
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setDrawerOpen(isOpen) {
  sidebar.classList.toggle("is-open", isOpen);
  sidebarOverlay.classList.toggle("hidden", !isOpen);
  document.body.classList.toggle("drawer-open", isOpen);
  navToggle.setAttribute("aria-expanded", String(isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "關閉導覽" : "開啟導覽");
}

function setActiveSection(sectionId) {
  for (const link of navLinks) {
    link.classList.toggle("active", link.dataset.sectionLink === sectionId);
  }
}

function clearRenderedResults() {
  dailyTimelineState = null;
  currentPayload = null;
  currentSessionThreshold = null;
  peopleState = {
    search: "",
    sortKey: "messages",
    sortDirection: "desc",
    page: 1,
    pageSize: 25,
  };
  summaryGrid.innerHTML = "";
  insightsGrid.innerHTML = "";
  timelineChart.innerHTML = "";
  dailyTimelineControls.innerHTML = "";
  dailyTimelineChart.innerHTML = "";
  heatmapChart.innerHTML = "";
  replyChart.innerHTML = "";
  daysTable.innerHTML = "";
  termsCloud.innerHTML = "";
  phrasesPanel.innerHTML = "";
  messageMixPanel.innerHTML = "";
  callsPanel.innerHTML = "";
  signalsPanel.innerHTML = "";
  reactionsPanel.innerHTML = "";
  peopleTable.innerHTML = "";
  conversationModeBadge.textContent = "—";
  precisionBadge.textContent = "精確";
  tokenizerBadge.textContent = "斷詞";
}

function clearAnalysis() {
  terminateWorker();
  currentFiles = [];
  fileInput.value = "";
  clearRenderedResults();
  resetUiState();
  analysisLive.textContent = "分析結果已清除。";
}

function resetUiState() {
  isAnalyzing = false;
  setInputDisabled(false);
  hideResults();
  statusText.classList.remove("status-error");
  statusText.textContent = "準備好了，等您載入聊天檔案";
  fileName.textContent = "尚未選擇檔案";
  fileSize.textContent = "—";
  fileMeta.textContent = "";
  renderSelectedFiles([]);
  conversationSummary.textContent = "已完成本機分析。";
  setProgress(0);
}

function terminateWorker() {
  if (!analysisWorker) {
    return;
  }
  analysisWorker.terminate();
  analysisWorker = null;
}

function setInputDisabled(disabled) {
  fileInput.disabled = disabled;
  dropzone.classList.toggle("is-disabled", disabled);
  clearAnalysisButton.disabled = false;
  reselectFileButton.disabled = disabled;
}

function showResults() {
  dashboard.hidden = false;
  dashboard.classList.remove("hidden");
  dashboard.removeAttribute("aria-hidden");
  dashboardEmpty.hidden = true;
  dashboardEmpty.classList.add("hidden");
  dashboardEmpty.setAttribute("aria-hidden", "true");
  document.body.dataset.analysisState = "complete";
}

function hideResults() {
  dashboard.hidden = true;
  dashboard.classList.add("hidden");
  dashboard.setAttribute("aria-hidden", "true");
  dashboardEmpty.hidden = false;
  dashboardEmpty.classList.remove("hidden");
  dashboardEmpty.removeAttribute("aria-hidden");
  document.body.dataset.analysisState = "idle";
}

function showError(message) {
  isAnalyzing = false;
  setInputDisabled(false);
  terminateWorker();
  hideResults();
  statusText.textContent = message;
  statusText.classList.add("status-error");
  fileMeta.textContent = "請清除後重新匯入，或確認檔案是否為 Telegram Desktop 匯出的 result.json。";
  renderSelectedFiles(currentFiles);
  analysisLive.textContent = `分析失敗：${message}`;
}

function renderSelectedFiles(files, mergeMeta = null) {
  selectedFilesPanel.innerHTML = "";
  selectedFilesPanel.classList.toggle("hidden", files.length === 0);
  if (!files.length) {
    return;
  }

  const totalSize = sumFileSizes(files);
  const header = document.createElement("div");
  header.className = "selected-files-head";

  const title = document.createElement("strong");
  title.textContent = `${files.length.toLocaleString()} 個檔案`;
  const meta = document.createElement("span");
  meta.textContent = `總大小 ${formatBytes(totalSize)}`;
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "file-list-action";
  clearButton.textContent = "清除全部";
  clearButton.disabled = isAnalyzing;
  clearButton.addEventListener("click", clearAnalysis);

  header.append(title, meta, clearButton);
  selectedFilesPanel.appendChild(header);

  const list = document.createElement("ul");
  list.className = "selected-file-list";
  files.forEach((file, index) => {
    const item = document.createElement("li");
    item.className = "selected-file-item";
    item.dataset.fileIndex = String(index);

    const body = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = file.name;
    const details = document.createElement("span");
    const sourceMeta = mergeMeta?.sourceFiles?.[index] || null;
    const validationLabel = getFileValidationLabel(file, sourceMeta);
    details.textContent = `${formatBytes(file.size)} · ${validationLabel}`;
    body.append(name, details);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "file-list-action";
    removeButton.textContent = "移除";
    removeButton.disabled = isAnalyzing;
    removeButton.addEventListener("click", () => removeSelectedFile(index));

    item.append(body, removeButton);
    list.appendChild(item);
  });
  selectedFilesPanel.appendChild(list);

  if (mergeMeta?.fileCount) {
    const mergeLine = document.createElement("p");
    mergeLine.className = "selected-files-merge";
    mergeLine.textContent = `合併後實際訊息數 ${mergeMeta.uniqueMessageCount.toLocaleString()}，移除重複 ${mergeMeta.duplicateMessageCount.toLocaleString()} 則`;
    selectedFilesPanel.appendChild(mergeLine);
  }
}

function getFileValidationLabel(file, sourceMeta = null) {
  if (!isLikelyJsonFile(file)) {
    return "非 JSON 檔案";
  }
  if (sourceMeta) {
    return `已驗證，原始 ${sourceMeta.rawMessageCount.toLocaleString()} 則，重複 ${sourceMeta.duplicateMessageCount.toLocaleString()} 則`;
  }
  if (isAnalyzing) {
    return "等待驗證";
  }
  return "可驗證";
}

function updateSelectedFileStatus(fileIndexToUpdate, status) {
  if (!Number.isInteger(fileIndexToUpdate) || fileIndexToUpdate < 0) {
    return;
  }
  for (const item of selectedFilesPanel.querySelectorAll(".selected-file-item")) {
    if (Number(item.dataset.fileIndex) !== fileIndexToUpdate) {
      continue;
    }
    const detail = item.querySelector("span");
    const file = currentFiles[fileIndexToUpdate];
    if (detail && file) {
      detail.textContent = `${formatBytes(file.size)} · ${status === "analyzing" ? "正在驗證／分析" : "等待驗證"}`;
    }
  }
}

function removeSelectedFile(index) {
  if (isAnalyzing || index < 0 || index >= currentFiles.length) {
    return;
  }
  currentFiles = currentFiles.filter((_, fileIndex) => fileIndex !== index);
  fileInput.value = "";
  if (!currentFiles.length) {
    clearAnalysis();
    return;
  }
  handleFiles(currentFiles);
}

function logAnalysisRenderFailure(error, payload) {
  const topLevelFields = [
    "summary",
    "conversationMode",
    "participantCount",
    "telegramChatType",
    "groupMetrics",
    "sessionMetricsByThreshold",
    "analysisPrecision",
    "wordAnalysisMeta",
    "presentationLimits",
    "calls",
    "timeline",
    "dailyTimeline",
    "people",
    "messageMix",
  ];
  const missingTopLevelFields = topLevelFields.filter((field) => !(field in (payload || {})));
  console.error("Analysis render failed", {
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : "",
    missingTopLevelFields,
    conversationMode: payload?.conversationMode,
    hasSummary: Boolean(payload?.summary),
  });
}

function isLikelyJsonFile(file) {
  return (
    file.type === "application/json" ||
    file.name.toLowerCase().endsWith(".json") ||
    file.name.toLowerCase() === "result"
  );
}

function getFirstTimelineDate(payload = currentPayload) {
  return payload?.dailyTimeline?.[0]?.label || "—";
}

function getLastTimelineDate(payload = currentPayload) {
  const entries = payload?.dailyTimeline || [];
  return entries.length ? entries[entries.length - 1].label : "—";
}

function renderSummary(summary, groupMetrics = null) {
  summaryGrid.innerHTML = "";
  const firstDate = getFirstTimelineDate();
  const lastDate = getLastTimelineDate();
  const cards = [
    {
      icon: "💬",
      label: "總訊息數",
      value: formatCompact(summary.totalMessages),
      meta: `${summary.textMessages.toLocaleString()} 則含文字內容`,
    },
    {
      icon: "📅",
      label: "活躍日數",
      value: summary.activeDays ? summary.activeDays.toLocaleString() : "—",
      meta: `${summary.participantCount.toLocaleString()} 位參與者`,
    },
    {
      icon: "▶",
      label: "開始日期",
      value: firstDate,
      meta: "最早的對話記錄",
    },
    {
      icon: "◼",
      label: "最後日期",
      value: lastDate,
      meta: "最近的對話記錄",
    },
    {
      icon: "↔",
      label: "時間跨度",
      value: summary.rangeLabel,
      meta: `${summary.activeDays.toLocaleString()} 個活躍日`,
    },
    {
      icon: "▦",
      label: "活躍密度",
      value: summary.activeDensityLabel,
      meta: summary.activeDensityMeta,
    },
    {
      icon: "⚖",
      label: summary.conversationMode === "group" ? "發言集中度" : "發話平衡",
      value: summary.balanceLabel,
      meta: summary.balanceMeta,
    },
    {
      icon: "⏱",
      label: "即時回覆節奏",
      value: summary.immediateReplyLabel,
      meta: summary.immediateReplyMeta,
    },
    {
      icon: "↺",
      label: "重啟對話間隔",
      value: summary.restartReplyLabel,
      meta: summary.restartReplyMeta,
    },
  ];

  if (summary.conversationMode === "group" && groupMetrics) {
    cards.push(
      {
        icon: "◎",
        label: "活躍參與者",
        value: groupMetrics.activeParticipantCount.toLocaleString(),
        meta: `訊息數中位數 ${groupMetrics.medianMessagesPerParticipant.toLocaleString()} 則`,
      },
      {
        icon: "▥",
        label: "Top 1 占比",
        value: groupMetrics.topParticipantShareLabel,
        meta: `前三位合計 ${groupMetrics.topThreeShareLabel}`,
      },
    );
  }

  for (const card of cards) {
    const fragment = summaryCardTemplate.content.cloneNode(true);
    fragment.querySelector(".summary-icon").dataset.icon = card.icon;
    fragment.querySelector(".summary-label").textContent = card.label;
    fragment.querySelector(".summary-value").textContent = safeDisplay(card.value);
    fragment.querySelector(".summary-meta").textContent = card.meta;
    summaryGrid.appendChild(fragment);
  }
}

function renderTimeline(timeline, participants) {
  if (!timeline.length) {
    timelineChart.innerHTML = `<div class="empty-state">目前還沒有足夠的月份資料可以畫圖。</div>`;
    return;
  }

  const width = 980;
  const height = 356;
  const padding = { top: 16, right: 16, bottom: 78, left: 46 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxTotal = Math.max(...timeline.map((entry) => entry.total), 1);
  const barWidth = innerWidth / timeline.length;
  const labelStep = Math.max(1, Math.ceil(timeline.length / 12));
  const colors = PARTICIPANT_COLORS;

  const stackedBars = timeline
    .map((entry, index) => {
      let offset = 0;
      const segments = participants
        .map((name, participantIndex) => {
          const value = entry.byParticipant[name] || 0;
          const segmentHeight = (value / maxTotal) * innerHeight;
          const y = padding.top + innerHeight - offset - segmentHeight;
          offset += segmentHeight;
          const tooltip = `${entry.label}\n${name}: ${value.toLocaleString()} 則\n合計: ${entry.total.toLocaleString()} 則`;
          return `<rect class="has-tooltip" data-tooltip="${escapeAttribute(tooltip)}" x="${padding.left + index * barWidth + 1}" y="${y}" width="${Math.max(barWidth - 2, 1)}" height="${segmentHeight}" fill="${colors[participantIndex % colors.length]}"></rect>`;
        })
        .join("");
      const axisLabel =
        index % labelStep === 0 || index === timeline.length - 1
          ? `<text class="axis-text" x="${padding.left + index * barWidth + barWidth / 2}" y="${padding.top + innerHeight + 24}" text-anchor="middle">${entry.label.slice(2)}</text>`
          : "";
      return `${segments}${axisLabel}`;
    })
    .join("");

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = padding.top + innerHeight - innerHeight * ratio;
      const value = Math.round(maxTotal * ratio);
      return `<g><line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e7ecf2" /><text class="axis-text" x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${value}</text></g>`;
    })
    .join("");

  const legend = participants
    .map(
      (name, index) =>
        `<g transform="translate(${padding.left + index * 180}, ${height - 28})"><rect width="12" height="12" rx="3" fill="${colors[index % colors.length]}"></rect><text class="chart-title" x="18" y="11">${escapeHtml(name)}</text></g>`,
    )
    .join("");

  timelineChart.innerHTML = `<svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="月度訊息趨勢圖">${gridLines}${stackedBars}${legend}</svg>`;
  bindTooltips(timelineChart);
}

function renderHeatmap(heatmap) {
  const days = ["一", "二", "三", "四", "五", "六", "日"];
  const width = 760;
  const height = 340;
  const padding = { top: 22, right: 16, bottom: 26, left: 34 };
  const cellWidth = (width - padding.left - padding.right) / 24;
  const cellHeight = (height - padding.top - padding.bottom) / 7;
  const maxValue = Math.max(...heatmap.flat(), 1);

  const cells = heatmap
    .flatMap((row, dayIndex) =>
      row.map((value, hour) => {
        const x = padding.left + hour * cellWidth;
        const y = padding.top + dayIndex * cellHeight;
        const alpha = value === 0 ? 0.08 : 0.16 + 0.84 * (value / maxValue);
        const tooltip = `週${days[dayIndex]} ${String(hour).padStart(2, "0")}:00-${String((hour + 1) % 24).padStart(2, "0")}:00\n${value.toLocaleString()} 則訊息`;
        return `<rect class="has-tooltip" data-tooltip="${escapeAttribute(tooltip)}" x="${x + 1}" y="${y + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" rx="6" fill="rgba(20,184,166,${alpha})"></rect>`;
      }),
    )
    .join("");

  const xLabels = Array.from({ length: 24 }, (_, hour) => {
    const x = padding.left + hour * cellWidth + cellWidth / 2;
    return `<text class="axis-text" x="${x}" y="14" text-anchor="middle">${hour}</text>`;
  }).join("");

  const yLabels = days
    .map((day, index) => {
      const y = padding.top + index * cellHeight + cellHeight / 2 + 4;
      return `<text class="axis-text" x="18" y="${y}" text-anchor="middle">${day}</text>`;
    })
    .join("");

  heatmapChart.innerHTML = `<svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="每週時段熱區圖">${xLabels}${yLabels}${cells}</svg>`;
  bindTooltips(heatmapChart);
}

function renderDailyTimeline(timeline, participants) {
  if (!timeline.length) {
    dailyTimelineControls.innerHTML = "";
    dailyTimelineChart.innerHTML = `<div class="empty-state">目前還沒有足夠的每日資料可以畫圖。</div>`;
    return;
  }

  dailyTimelineState = {
    timeline,
    participants,
    startIndex: 0,
    endIndex: timeline.length - 1,
  };

  renderDailyTimelineControls();
  renderDailyTimelineChart();
}

function renderDailyTimelineControls() {
  if (!dailyTimelineState) {
    dailyTimelineControls.innerHTML = "";
    return;
  }

  const selectedStart = dailyTimelineState.timeline[dailyTimelineState.startIndex].label;
  const selectedEnd = dailyTimelineState.timeline[dailyTimelineState.endIndex].label;
  const isFullRange =
    dailyTimelineState.startIndex === 0 &&
    dailyTimelineState.endIndex === dailyTimelineState.timeline.length - 1;
  dailyTimelineControls.innerHTML = `
    <div class="timeline-controls-inner">
      <p class="timeline-range-label">目前區間 <strong>${selectedStart}</strong> - <strong>${selectedEnd}</strong></p>
      <p class="timeline-hint">在圖表上按住滑鼠拖曳，放開後就能放大這段日期範圍。</p>
      <button type="button" class="timeline-reset" id="daily-range-reset" ${isFullRange ? "disabled" : ""}>回到全部日期</button>
    </div>
  `;

  const resetButton = dailyTimelineControls.querySelector("#daily-range-reset");

  resetButton.addEventListener("click", () => {
    dailyTimelineState.startIndex = 0;
    dailyTimelineState.endIndex = dailyTimelineState.timeline.length - 1;
    renderDailyTimelineControls();
    renderDailyTimelineChart();
  });
}

function renderDailyTimelineChart() {
  if (!dailyTimelineState) {
    dailyTimelineChart.innerHTML = `<div class="empty-state">目前還沒有足夠的每日資料可以畫圖。</div>`;
    return;
  }

  const timeline = dailyTimelineState.timeline.slice(
    dailyTimelineState.startIndex,
    dailyTimelineState.endIndex + 1,
  );

  if (!timeline.length) {
    dailyTimelineChart.innerHTML = `<div class="empty-state">你目前選的區間沒有資料。</div>`;
    return;
  }

  const width = 980;
  const height = 320;
  const padding = { top: 18, right: 16, bottom: 52, left: 46 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxTotal = Math.max(...timeline.map((entry) => entry.total), 1);
  const stepX = timeline.length > 1 ? innerWidth / (timeline.length - 1) : innerWidth;
  const labelStep = Math.max(1, Math.ceil(timeline.length / 8));
  const colors = PARTICIPANT_COLORS;

  const yLines = [0, 0.5, 1]
    .map((ratio) => {
      const y = padding.top + innerHeight - innerHeight * ratio;
      const label = Math.round(maxTotal * ratio);
      return `<g><line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e7ecf2" /><text class="axis-text" x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${label}</text></g>`;
    })
    .join("");

  const series = dailyTimelineState.participants
    .map((name, participantIndex) => {
      const path = timeline
        .map((entry, index) => {
          const x = padding.left + stepX * index;
          const value = entry.byParticipant[name] || 0;
          const y = padding.top + innerHeight - (value / maxTotal) * innerHeight;
          return `${index === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .join(" ");

      const dots = timeline
        .map((entry, index) => {
          const value = entry.byParticipant[name] || 0;
          const x = padding.left + stepX * index;
          const y = padding.top + innerHeight - (value / maxTotal) * innerHeight;
          const tooltip = `${entry.label}\n${name}: ${value.toLocaleString()} 則\n合計: ${entry.total.toLocaleString()} 則`;
          return `<circle class="has-tooltip" data-tooltip="${escapeAttribute(tooltip)}" cx="${x}" cy="${y}" r="4" fill="${colors[participantIndex % colors.length]}"></circle>`;
        })
        .join("");

      return `<g><path d="${path}" fill="none" stroke="${colors[participantIndex % colors.length]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>${dots}</g>`;
    })
    .join("");

  const labels = timeline
    .map((entry, index) => {
      if (index % labelStep !== 0 && index !== timeline.length - 1) {
        return "";
      }
      const x = padding.left + stepX * index;
      return `<text class="axis-text" x="${x}" y="${height - 18}" text-anchor="middle">${entry.label.slice(5)}</text>`;
    })
    .join("");

  dailyTimelineChart.innerHTML = `<svg class="svg-chart daily-brush-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="日度訊息趨勢圖">${yLines}${series}${labels}<rect class="brush-selection hidden" x="${padding.left}" y="${padding.top}" width="0" height="${innerHeight}"></rect></svg>`;
  bindTooltips(dailyTimelineChart);
  bindDailyTimelineBrush({
    svg: dailyTimelineChart.querySelector(".daily-brush-chart"),
    selection: dailyTimelineChart.querySelector(".brush-selection"),
    padding,
    innerWidth,
    innerHeight,
    visibleCount: timeline.length,
  });
}

function bindDailyTimelineBrush({ svg, selection, padding, innerWidth, innerHeight, visibleCount }) {
  if (!svg || !selection || !dailyTimelineState) {
    return;
  }

  let dragStartX = null;

  const clampX = (clientX) => {
    const bounds = svg.getBoundingClientRect();
    const relativeX = ((clientX - bounds.left) / bounds.width) * svg.viewBox.baseVal.width;
    return Math.max(padding.left, Math.min(padding.left + innerWidth, relativeX));
  };

  const xToVisibleIndex = (x) => {
    if (visibleCount <= 1) {
      return 0;
    }
    const ratio = (x - padding.left) / innerWidth;
    return Math.max(0, Math.min(visibleCount - 1, Math.round(ratio * (visibleCount - 1))));
  };

  const isInsidePlot = (clientX, clientY) => {
    const bounds = svg.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width) * svg.viewBox.baseVal.width;
    const y = ((clientY - bounds.top) / bounds.height) * svg.viewBox.baseVal.height;
    return (
      x >= padding.left &&
      x <= padding.left + innerWidth &&
      y >= padding.top &&
      y <= padding.top + innerHeight
    );
  };

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (!isInsidePlot(event.clientX, event.clientY)) {
      return;
    }
    dragStartX = clampX(event.clientX);
    selection.classList.remove("hidden");
    selection.setAttribute("x", String(dragStartX));
    selection.setAttribute("width", "0");
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", (event) => {
    if (dragStartX === null) {
      return;
    }
    const currentX = clampX(event.clientX);
    selection.setAttribute("x", String(Math.min(dragStartX, currentX)));
    selection.setAttribute("width", String(Math.abs(currentX - dragStartX)));
  });

  svg.addEventListener("pointerup", (event) => {
    if (dragStartX === null) {
      return;
    }
    const dragEndX = clampX(event.clientX);
    selection.classList.add("hidden");
    svg.releasePointerCapture(event.pointerId);

    const startVisibleIndex = xToVisibleIndex(Math.min(dragStartX, dragEndX));
    const endVisibleIndex = xToVisibleIndex(Math.max(dragStartX, dragEndX));
    dragStartX = null;

    if (startVisibleIndex === endVisibleIndex) {
      return;
    }

    dailyTimelineState.startIndex += startVisibleIndex;
    dailyTimelineState.endIndex = dailyTimelineState.startIndex + (endVisibleIndex - startVisibleIndex);
    renderDailyTimelineControls();
    renderDailyTimelineChart();
  });

  svg.addEventListener("pointercancel", () => {
    dragStartX = null;
    selection.classList.add("hidden");
  });

  svg.addEventListener("dblclick", () => {
    dailyTimelineState.startIndex = 0;
    dailyTimelineState.endIndex = dailyTimelineState.timeline.length - 1;
    renderDailyTimelineControls();
    renderDailyTimelineChart();
  });
}

function renderReplyHistogram(histogram) {
  if (!histogram.bins.length) {
    replyChart.innerHTML = `<div class="empty-state">目前還沒有足夠的輪流回覆資料。</div>`;
    return;
  }

  const totalReplies = histogram.bins.reduce((sum, bin) => sum + bin.count, 0);
  const breakdown = histogram.bins
    .map((bin) => {
      const count = toSafeNumber(bin.count, 0);
      const share = totalReplies ? ((count / totalReplies) * 100).toFixed(1) : "0.0";
      const tooltip = `${bin.label}\n${formatCount(count)} 次輪流回覆\n占比 ${share}%`;
      return `<div class="reply-breakdown-row has-tooltip" data-tooltip="${escapeAttribute(tooltip)}">
        <div class="reply-breakdown-meta">
          <strong>${bin.label}</strong>
          <span>${formatCount(count)} 次</span>
        </div>
        <div class="reply-breakdown-bar"><span style="width:${share}%"></span></div>
        <div class="reply-breakdown-share">${share}%</div>
      </div>`;
    })
    .join("");

  replyChart.innerHTML = `
    <div class="reply-breakdown">
      ${breakdown}
    </div>
    <div class="reply-side-note">
      <div class="reply-side-note-label">最久沒聊天</div>
      <div class="reply-side-note-value">${histogram.longestGapLabel}</div>
      <div class="reply-side-note-meta">${histogram.longestGapRange}</div>
    </div>
  `;
  bindTooltips(replyChart);
}

function renderTopDays(topDays) {
  topDays = normalizeArray(topDays);
  if (!topDays.length) {
    daysTable.innerHTML = `<div class="empty-state">目前還沒有可用的每日統計。</div>`;
    return;
  }

  const maxCount = Math.max(...topDays.map((entry) => toSafeNumber(entry.total, 0)), 1);
  daysTable.innerHTML = [
    `<div class="table-row header"><div>日期</div><div>總訊息</div><div>雙方分布</div><div>密度</div></div>`,
    ...topDays.map((entry) => {
      const byParticipant = isPlainObject(entry.byParticipant) ? entry.byParticipant : {};
      const participants = Object.entries(byParticipant)
        .map(([name, count]) => `${escapeHtml(name)} ${count}`)
        .join(" / ");
      const total = toSafeNumber(entry.total, 0);
      const date = entry.date || "—";
      const weekday = entry.weekday || "";
      const tooltip = `${date} ${weekday}\n總訊息: ${total.toLocaleString()} 則\n${Object.entries(byParticipant)
        .map(([name, count]) => `${name}: ${count.toLocaleString()} 則`)
        .join("\n")}`;
      return `<div class="table-row has-tooltip" data-tooltip="${escapeAttribute(tooltip)}"><div class="table-cell"><strong>${date}</strong><span class="table-muted">${weekday}</span></div><div class="table-cell"><strong>${total.toLocaleString()}</strong></div><div class="table-cell">${participants}</div><div class="table-cell"><div class="mini-bar"><span style="width:${(total / maxCount) * 100}%"></span></div></div></div>`;
    }),
  ].join("");
  bindTooltips(daysTable);
}

function renderTerms(topTerms) {
  topTerms = normalizeArray(topTerms).map(normalizeCountEntry);
  if (!topTerms.length) {
    termsCloud.innerHTML = `<div class="empty-state">文字訊息太少，還整理不出常見詞。</div>`;
    return;
  }

  const maxCount = Math.max(...topTerms.map((term) => term.count), 1);
  termsCloud.innerHTML = topTerms
    .map((term) => {
      const emphasis = 0.9 + (term.count / maxCount) * 0.7;
      return `<span class="term-chip has-tooltip" data-tooltip="${escapeAttribute(`${term.term}\n出現 ${formatCount(term.count)} 次`)}" style="font-size:${emphasis}rem"><strong>${escapeHtml(term.term)}</strong>${formatCount(term.count)}</span>`;
    })
    .join("");
  bindTooltips(termsCloud);
}

function renderSignals(summary) {
  const cards = [
    {
      label: "編輯訊息",
      value: summary.editedMessages.toLocaleString(),
      meta: `${formatShare(summary.editedMessages, summary.totalMessages)} 的訊息曾被編輯`,
    },
    {
      label: "轉傳訊息",
      value: summary.forwardedMessages.toLocaleString(),
      meta: `${formatShare(summary.forwardedMessages, summary.totalMessages)} 的訊息是轉傳內容`,
    },
    {
      label: "附連結訊息",
      value: summary.linkedMessages.toLocaleString(),
      meta: `${formatShare(summary.linkedMessages, summary.totalMessages)} 的訊息含外部連結`,
    },
    {
      label: "收到反應",
      value: summary.totalReactionCount.toLocaleString(),
      meta: summary.reactedMessages
        ? `${summary.reactedMessages.toLocaleString()} 則訊息收到至少一個反應`
        : "目前沒有任何訊息收到表情反應",
    },
  ];

  signalsPanel.innerHTML = cards
    .map(
      (card) => `<article class="call-summary-card">
        <p class="summary-label">${card.label}</p>
        <p class="summary-value">${card.value}</p>
        <p class="summary-meta">${card.meta}</p>
      </article>`,
    )
    .join("");
}

function renderTopReactions(topReactions, totalReactionCount) {
  topReactions = normalizeArray(topReactions);
  if (!topReactions.length) {
    reactionsPanel.innerHTML = `<div class="empty-state">這份聊天裡還沒有表情反應資料。</div>`;
    return;
  }

  reactionsPanel.innerHTML = topReactions
    .map((reaction) => {
      const count = toSafeNumber(reaction.count, 0);
      const label = reaction.label || "未知反應";
      const share = totalReactionCount ? ((count / totalReactionCount) * 100).toFixed(1) : "0.0";
      const tooltip = `${label}\n${count.toLocaleString()} 次表情反應\n占比 ${share}%`;
      return `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(tooltip)}">
        <div class="call-row-meta">
          <strong>${escapeHtml(label)}</strong>
          <span>${reaction.kind === "custom" ? "自訂表情" : "預設表情"}</span>
        </div>
        <div class="call-row-bar warm"><span style="width:${share}%"></span></div>
        <div class="call-row-share">${share}%</div>
      </div>`;
    })
    .join("");

  bindTooltips(reactionsPanel);
}

function renderPeople(people, participantDisplay) {
  if (!people.length) {
    peopleTable.innerHTML = `<div class="empty-state">目前還沒有參與者統計資料。</div>`;
    return;
  }

  const query = peopleState.search.trim().toLowerCase();
  const filtered = people.filter((person) => person.name.toLowerCase().includes(query));
  const sorted = [...filtered].sort((left, right) => comparePeople(left, right));
  const pageCount = Math.max(1, Math.ceil(sorted.length / peopleState.pageSize));
  peopleState.page = Math.min(peopleState.page, pageCount);
  const pageStart = (peopleState.page - 1) * peopleState.pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + peopleState.pageSize);
  const maxMessages = Math.max(...people.map((person) => person.messages), 1);
  const limitNotice = participantDisplay
    ? `<div class="table-note">完整參與者資料共 ${participantDisplay.total.toLocaleString()} 位，可搜尋、排序與分頁；圖表預設顯示 Top ${participantDisplay.timelineLimit} 加上「其他」。</div>`
    : "";
  peopleTable.innerHTML = [
    limitNotice,
    `<div class="people-toolbar">
      <label><span class="sr-only">搜尋參與者</span><input id="people-search" type="search" value="${escapeAttribute(peopleState.search)}" placeholder="搜尋姓名" /></label>
      <label><span>每頁</span><select id="people-page-size"><option value="25"${peopleState.pageSize === 25 ? " selected" : ""}>25</option><option value="50"${peopleState.pageSize === 50 ? " selected" : ""}>50</option></select></label>
    </div>`,
    `<div class="table-row table-row-wide header"><button type="button" data-sort="name">參與者</button><button type="button" data-sort="messages">訊息數</button><button type="button" data-sort="avgChars">平均字數</button><button type="button" data-sort="mediaShare">媒體訊息占比</button><div>互動線索</div></div>`,
    ...pageRows.map((person) => {
      const share = ((person.messages / maxMessages) * 100).toFixed(1);
      const topReactionLine = person.reactionsReceived.length
        ? `收到表情反應: ${person.reactionCountReceived.toLocaleString()} 次\n最常見的是: ${person.reactionsReceived
            .slice(0, 3)
            .map((reaction) => `${reaction.label} ${reaction.count}`)
            .join(" / ")}`
        : "收到表情反應: 0 次";
      const tooltip = `${person.name}\n訊息數: ${person.messages.toLocaleString()} 則\n總字元: ${person.characters.toLocaleString()}\n平均字數: ${person.avgChars.toFixed(1)}\n媒體訊息占比: ${person.mediaShare}%\n編輯訊息: ${person.edits.toLocaleString()} 則\n轉傳訊息: ${person.forwards.toLocaleString()} 則\n附連結訊息: ${person.links.toLocaleString()} 則\n${topReactionLine}`;
      const signalSummary = [
        `編輯 ${person.edits}`,
        `轉傳 ${person.forwards}`,
        `連結 ${person.links}`,
        `反應 ${person.reactionCountReceived}`,
      ].join(" / ");
      return `<div class="table-row table-row-wide has-tooltip" data-tooltip="${escapeAttribute(tooltip)}"><div class="table-cell"><strong>${escapeHtml(person.name)}</strong><span class="table-muted">${person.characters.toLocaleString()} 字元</span></div><div class="table-cell"><strong>${person.messages.toLocaleString()}</strong><div class="mini-bar"><span style="width:${share}%"></span></div></div><div class="table-cell">${person.avgChars.toFixed(1)}</div><div class="table-cell">${person.mediaShare}%</div><div class="table-cell">${signalSummary}</div></div>`;
    }),
    `<div class="pagination">
      <button class="button button-ghost" type="button" id="people-prev" ${peopleState.page <= 1 ? "disabled" : ""}>上一頁</button>
      <span>第 ${peopleState.page.toLocaleString()} / ${pageCount.toLocaleString()} 頁，符合 ${filtered.length.toLocaleString()} 位</span>
      <button class="button button-ghost" type="button" id="people-next" ${peopleState.page >= pageCount ? "disabled" : ""}>下一頁</button>
    </div>`,
  ].join("");
  bindPeopleControls(people, participantDisplay);
  bindTooltips(peopleTable);
}

function comparePeople(left, right) {
  const direction = peopleState.sortDirection === "asc" ? 1 : -1;
  if (peopleState.sortKey === "name") {
    return left.name.localeCompare(right.name) * direction;
  }
  const leftValue = Number(left[peopleState.sortKey]) || 0;
  const rightValue = Number(right[peopleState.sortKey]) || 0;
  return (leftValue - rightValue) * direction;
}

function bindPeopleControls(people, participantDisplay) {
  peopleTable.querySelector("#people-search")?.addEventListener("input", (event) => {
    peopleState.search = event.target.value;
    peopleState.page = 1;
    renderPeople(people, participantDisplay);
  });
  peopleTable.querySelector("#people-page-size")?.addEventListener("change", (event) => {
    peopleState.pageSize = Number(event.target.value);
    peopleState.page = 1;
    renderPeople(people, participantDisplay);
  });
  peopleTable.querySelector("#people-prev")?.addEventListener("click", () => {
    peopleState.page -= 1;
    renderPeople(people, participantDisplay);
  });
  peopleTable.querySelector("#people-next")?.addEventListener("click", () => {
    peopleState.page += 1;
    renderPeople(people, participantDisplay);
  });
  peopleTable.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (peopleState.sortKey === key) {
        peopleState.sortDirection = peopleState.sortDirection === "asc" ? "desc" : "asc";
      } else {
        peopleState.sortKey = key;
        peopleState.sortDirection = key === "name" ? "asc" : "desc";
      }
      peopleState.page = 1;
      renderPeople(people, participantDisplay);
    });
  });
}

function renderCatchphrases(catchphrases) {
  if (!catchphrases.length) {
    phrasesPanel.innerHTML = `<div class="empty-state">文字訊息太少，還整理不出每個人的常用詞。</div>`;
    return;
  }

  phrasesPanel.innerHTML = catchphrases
    .map((person) => {
      const topWords = person.topWords.length
        ? person.topWords
            .map(
              (entry) =>
                `<span class="phrase-chip has-tooltip" data-tooltip="${escapeAttribute(`${entry.term}\n${person.name} 用了 ${formatCount(entry.count)} 次`)}"><strong>${escapeHtml(entry.term)}</strong>${formatCount(entry.count)}</span>`,
            )
            .join("")
        : `<span class="table-muted">目前還看不出明顯的常用詞。</span>`;

      const topPhrases = person.topPhrases.length
        ? person.topPhrases
            .map(
              (entry) =>
                `<span class="phrase-chip warm has-tooltip" data-tooltip="${escapeAttribute(`${entry.term}\n${person.name} 有 ${formatCount(entry.count)} 則訊息出現這句`)}">「${escapeHtml(entry.term)}」<strong>${formatCount(entry.count)}</strong></span>`,
            )
            .join("")
        : `<span class="table-muted">目前還看不出明顯的固定短句。</span>`;

      return `<section class="phrase-person">
        <div class="phrase-person-head">
          <h3>${escapeHtml(person.name)}</h3>
          <p>${person.messageShare}% 訊息占比</p>
        </div>
        <div class="phrase-group">
          <p class="phrase-label">愛用詞彙</p>
          <div class="phrase-list">${topWords}</div>
        </div>
        <div class="phrase-group">
          <p class="phrase-label">口頭禪候選</p>
          <div class="phrase-list">${topPhrases}</div>
        </div>
      </section>`;
    })
    .join("");

  bindTooltips(phrasesPanel);
}

function renderMessageMix(messageMix) {
  if (!messageMix.length) {
    messageMixPanel.innerHTML = `<div class="empty-state">目前還沒有足夠的訊息類型資料。</div>`;
    return;
  }

  messageMixPanel.innerHTML = messageMix
    .map((person) => {
      const rows = person.categories
        .map((category) => {
          const count = toSafeNumber(category.count, 0);
          const tooltip = `${person.name}\n${category.label}: ${formatCount(count)} 則\n占比 ${category.share}%`;
          return `<div class="mix-row has-tooltip" data-tooltip="${escapeAttribute(tooltip)}">
            <div class="mix-meta">
              <strong>${escapeHtml(category.label)}</strong>
              <span>${formatCount(count)} 則</span>
            </div>
            <div class="mix-bar"><span style="width:${category.share}%"></span></div>
            <div class="mix-share">${category.share}%</div>
          </div>`;
        })
        .join("");

      return `<section class="mix-card">
        <div class="phrase-person-head">
          <h3>${escapeHtml(person.name)}</h3>
          <p>${person.total.toLocaleString()} 則訊息</p>
        </div>
        <div class="mix-list">${rows}</div>
      </section>`;
    })
    .join("");

  bindTooltips(messageMixPanel);
}

function renderCalls(calls) {
  if (!calls || !calls.total) {
    callsPanel.innerHTML = `<div class="empty-state">這份聊天裡沒有可分析的通話紀錄。</div>`;
    return;
  }

  const summaryCards = [
    {
      label: "通話次數",
      value: calls.total.toLocaleString(),
      meta: `${calls.callsWithDuration.toLocaleString()} 次有時長，${calls.callsWithoutDuration.toLocaleString()} 次缺少時長`,
    },
    {
      label: "總通話時長",
      value: calls.totalDurationLabel,
      meta: `平均每次 ${calls.avgDurationLabel}（只除以有時長的通話）`,
    },
    {
      label: "資料完整度",
      value: calls.durationCompletenessLabel,
      meta: `${calls.callsWithResult.toLocaleString()} 次有結果欄位，${calls.callsWithoutResult.toLocaleString()} 次缺少結果`,
    },
    {
      label: "最常打的人",
      value: calls.topCaller?.name || "暫無",
      meta: calls.topCaller ? `${calls.topCaller.share}% 通話占比` : "目前找不到誰發起通話",
    },
    {
      label: "最常通話時段",
      value: calls.topHour?.label || "暫無",
      meta: calls.topHour ? `${formatCount(calls.topHour.count)} 次通話` : "目前資料還不夠",
    },
  ]
    .map(
      (card) => `<article class="call-summary-card">
        <p class="summary-label">${card.label}</p>
        <p class="summary-value">${card.value}</p>
        <p class="summary-meta">${card.meta}</p>
      </article>`,
    )
    .join("");

  const peopleRows = calls.byParticipant
    .map(
      (person) => `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(`${person.name}\n通話 ${formatCount(person.count)} 次\n占比 ${person.share}%\n累積 ${person.durationLabel}`)}">
        <div class="call-row-meta">
          <strong>${escapeHtml(person.name)}</strong>
          <span>${formatCount(person.count)} 次 / ${person.durationLabel}</span>
        </div>
        <div class="call-row-bar"><span style="width:${person.share}%"></span></div>
        <div class="call-row-share">${person.share}%</div>
      </div>`,
    )
    .join("");

  const monthRows = calls.byMonth
    .map(
      (entry) => `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(`${entry.label}\n${formatCount(entry.count)} 次通話\n累積 ${entry.durationLabel}`)}">
        <div class="call-row-meta">
          <strong>${entry.label}</strong>
          <span>${formatCount(entry.count)} 次 / ${entry.durationLabel}</span>
        </div>
        <div class="call-row-bar warm"><span style="width:${entry.share}%"></span></div>
        <div class="call-row-share">${entry.share}%</div>
      </div>`,
    )
    .join("");

  const hourRows = calls.byHour
    .map(
      (entry) => `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(`${entry.label}\n${formatCount(entry.count)} 次通話`)}">
        <div class="call-row-meta">
          <strong>${entry.label}</strong>
          <span>${formatCount(entry.count)} 次</span>
        </div>
        <div class="call-row-bar"><span style="width:${entry.share}%"></span></div>
        <div class="call-row-share">${entry.share}%</div>
      </div>`,
    )
    .join("");

  const outcomeChips = calls.outcomes
    .map(
      (entry) => `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(`${entry.label}\n${formatCount(entry.count)} 次\n占比 ${entry.share}%`)}">
        <div class="call-row-meta">
          <strong>${escapeHtml(entry.label)}</strong>
          <span>${formatCount(entry.count)} 次</span>
        </div>
        <div class="call-row-bar warm"><span style="width:${entry.share}%"></span></div>
        <div class="call-row-share">${entry.share}%</div>
      </div>`,
    )
    .join("");

  callsPanel.innerHTML = `
    <div class="call-summary-grid">${summaryCards}</div>
    <div class="call-grid">
      <section class="call-block">
        <p class="phrase-label">誰比較常發起通話</p>
        <div class="call-list">${peopleRows}</div>
      </section>
      <section class="call-block">
        <p class="phrase-label">通話集中月份</p>
        <div class="call-list">${monthRows}</div>
      </section>
      <section class="call-block">
        <p class="phrase-label">通話時段分布</p>
        <div class="call-list">${hourRows}</div>
      </section>
      <section class="call-block">
        <p class="phrase-label">通話結果</p>
        <div class="call-list">${outcomeChips || `<span class="table-muted">目前資料還不夠。</span>`}</div>
      </section>
    </div>
  `;

  bindTooltips(callsPanel);
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatCompact(value) {
  return new Intl.NumberFormat("zh-Hant", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatShare(part, total) {
  if (!total) {
    return "0.0%";
  }
  return `${((part / total) * 100).toFixed(1)}%`;
}

function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "暫無";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} 分鐘`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小時`;
  }
  const days = Math.round(hours / 24);
  return `${days} 天`;
}

function formatShortDate(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "—";
  }
  return new Date(timestamp).toLocaleDateString("zh-Hant", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeDictionaryText(value) {
  const seen = new Set();
  return String(value || "")
    .split(/\r?\n/u)
    .map((entry) => entry.trim().replace(/\s+/gu, " "))
    .filter((entry) => {
      if (!entry || entry.length > 40 || seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    })
    .slice(0, 100);
}

function loadCustomDictionary() {
  try {
    return localStorage.getItem(CUSTOM_DICTIONARY_KEY) || "";
  } catch (_error) {
    return "";
  }
}

function saveCustomDictionary(value) {
  try {
    if (value) {
      localStorage.setItem(CUSTOM_DICTIONARY_KEY, value);
    } else {
      localStorage.removeItem(CUSTOM_DICTIONARY_KEY);
    }
  } catch (_error) {
    // Storage may be disabled; dictionary still works for the current page.
  }
}

function safeDisplay(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  const stringValue = String(value);
  return /NaN|Infinity/.test(stringValue) ? "—" : stringValue;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(input) {
  return escapeHtml(input).replaceAll('"', "&quot;");
}

function bindTooltips(container) {
  const elements = container.querySelectorAll("[data-tooltip]");
  for (const element of elements) {
    element.addEventListener("mouseenter", showTooltip);
    element.addEventListener("mousemove", moveTooltip);
    element.addEventListener("mouseleave", hideTooltip);
  }
}

function showTooltip(event) {
  const message = event.currentTarget.getAttribute("data-tooltip");
  if (!message) {
    return;
  }
  chartTooltip.textContent = message;
  chartTooltip.classList.remove("hidden");
  moveTooltip(event);
}

function moveTooltip(event) {
  const offset = 14;
  const tooltipWidth = chartTooltip.offsetWidth || 220;
  const tooltipHeight = chartTooltip.offsetHeight || 60;
  let left = event.clientX + offset;
  let top = event.clientY + offset;

  if (left + tooltipWidth > window.innerWidth - 12) {
    left = event.clientX - tooltipWidth - offset;
  }
  if (top + tooltipHeight > window.innerHeight - 12) {
    top = event.clientY - tooltipHeight - offset;
  }

  chartTooltip.style.left = `${Math.max(12, left)}px`;
  chartTooltip.style.top = `${Math.max(12, top)}px`;
}

function hideTooltip() {
  chartTooltip.classList.add("hidden");
}
