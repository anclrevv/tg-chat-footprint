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

let currentFile = null;
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

customDictionaryInput.value = loadCustomDictionary();

initializeNavigation();
initializeGuideDialog();
resetUiState();

replyInfoButton.addEventListener("click", () => {
  const isHidden = replyInfo.classList.toggle("hidden");
  replyInfoButton.setAttribute("aria-expanded", String(!isHidden));
});

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    handleFile(file);
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
      const [file] = event.dataTransfer?.files || [];
      if (file) {
        fileInput.files = event.dataTransfer.files;
        handleFile(file);
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
  if (currentFile && !isAnalyzing) {
    handleFile(currentFile);
  }
});

clearDictionaryButton.addEventListener("click", () => {
  customDictionaryInput.value = "";
  saveCustomDictionary("");
  if (currentFile && !isAnalyzing) {
    handleFile(currentFile);
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
    if (currentFile) {
      fileMeta.textContent = `已處理 ${data.processedMessages.toLocaleString()} 則訊息`;
    }
    return;
  }

  if (data.type === "result") {
    isAnalyzing = false;
    setInputDisabled(false);
    setProgress(100);
    statusText.textContent = "分析完成，可以開始看內容了";
    renderDashboard(data.payload);
    dashboard.classList.remove("hidden");
    dashboardEmpty.classList.add("hidden");
    analysisLive.textContent = "分析完成，結果已更新。";
    scrollDashboardIntoView();
    return;
  }

  if (data.type === "error") {
    showError(data.message || "這份檔案目前無法讀取，請確認是否為 Telegram 匯出的 result.json。");
  }
}

function handleFile(file) {
  if (isAnalyzing) {
    return;
  }

  if (!isLikelyJsonFile(file)) {
    showError("請選擇 Telegram 匯出的 JSON 檔案，通常檔名是 result.json。");
    return;
  }

  terminateWorker();
  analysisWorker = createAnalysisWorker();
  isAnalyzing = true;
  currentFile = file;
  clearRenderedResults();
  dashboard.classList.add("hidden");
  dashboardEmpty.classList.remove("hidden");
  statusText.classList.remove("status-error");
  setInputDisabled(true);
  setProgress(0);
  statusText.textContent = "已收到檔案，開始整理中";
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileMeta.textContent = "背景分析中，請保持此頁開啟。";
  analysisLive.textContent = "已開始分析檔案。";
  analysisWorker.postMessage({
    type: "analyze",
    file,
    options: {
      customDictionary: normalizeDictionaryText(customDictionaryInput.value),
    },
  });
}

function setProgress(value) {
  const safeValue = Math.max(0, Math.min(100, value));
  progressFill.style.width = `${safeValue}%`;
  progressText.textContent = `${safeValue.toFixed(1)}%`;
}

function renderDashboard(payload) {
  currentPayload = payload;
  currentSessionThreshold = currentSessionThreshold || payload.selectedSessionThreshold || Number(Object.keys(payload.sessionMetricsByThreshold || {})[0]);
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
  sessionThresholdSelect.innerHTML = (payload.sessionThresholdOptions || [])
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
  renderTimeline(view.timeline, view.participants);
  renderDailyTimeline(view.dailyTimeline, view.participants);
}

function renderDatasetStrip(payload) {
  const { summary } = payload;
  const firstDate = getFirstTimelineDate(payload);
  const lastDate = getLastTimelineDate(payload);
  const fileLabel = currentFile ? currentFile.name : "Telegram 對話";
  conversationSummary.textContent = `${fileLabel} • ${getConversationModeLabel(payload.conversationMode)} • ${summary.totalMessages.toLocaleString()} 則訊息 • ${summary.participantCount.toLocaleString()} 位參與者 • ${firstDate} 到 ${lastDate}`;
}

function getSelectedSessionMetrics() {
  const metricsByThreshold = currentPayload?.sessionMetricsByThreshold || {};
  const key = String(currentSessionThreshold || currentPayload?.selectedSessionThreshold || "");
  return metricsByThreshold[key] || Object.values(metricsByThreshold)[0] || null;
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
  if (!metrics) {
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
  currentFile = null;
  fileInput.value = "";
  clearRenderedResults();
  resetUiState();
  analysisLive.textContent = "分析結果已清除。";
}

function resetUiState() {
  isAnalyzing = false;
  setInputDisabled(false);
  dashboard.classList.add("hidden");
  dashboardEmpty.classList.remove("hidden");
  statusText.classList.remove("status-error");
  statusText.textContent = "準備好了，等您載入聊天檔案";
  fileName.textContent = "尚未選擇檔案";
  fileSize.textContent = "—";
  fileMeta.textContent = "";
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

function showError(message) {
  isAnalyzing = false;
  setInputDisabled(false);
  terminateWorker();
  statusText.textContent = message;
  statusText.classList.add("status-error");
  fileMeta.textContent = "請清除後重新匯入，或確認檔案是否為 Telegram Desktop 匯出的 result.json。";
  analysisLive.textContent = `分析失敗：${message}`;
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
      const share = totalReplies ? ((bin.count / totalReplies) * 100).toFixed(1) : "0.0";
      const tooltip = `${bin.label}\n${bin.count.toLocaleString()} 次輪流回覆\n占比 ${share}%`;
      return `<div class="reply-breakdown-row has-tooltip" data-tooltip="${escapeAttribute(tooltip)}">
        <div class="reply-breakdown-meta">
          <strong>${bin.label}</strong>
          <span>${bin.count.toLocaleString()} 次</span>
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
  if (!topDays.length) {
    daysTable.innerHTML = `<div class="empty-state">目前還沒有可用的每日統計。</div>`;
    return;
  }

  const maxCount = Math.max(...topDays.map((entry) => entry.total), 1);
  daysTable.innerHTML = [
    `<div class="table-row header"><div>日期</div><div>總訊息</div><div>雙方分布</div><div>密度</div></div>`,
    ...topDays.map((entry) => {
      const participants = Object.entries(entry.byParticipant)
        .map(([name, count]) => `${escapeHtml(name)} ${count}`)
        .join(" / ");
      const tooltip = `${entry.date} ${entry.weekday}\n總訊息: ${entry.total.toLocaleString()} 則\n${Object.entries(entry.byParticipant)
        .map(([name, count]) => `${name}: ${count.toLocaleString()} 則`)
        .join("\n")}`;
      return `<div class="table-row has-tooltip" data-tooltip="${escapeAttribute(tooltip)}"><div class="table-cell"><strong>${entry.date}</strong><span class="table-muted">${entry.weekday}</span></div><div class="table-cell"><strong>${entry.total.toLocaleString()}</strong></div><div class="table-cell">${participants}</div><div class="table-cell"><div class="mini-bar"><span style="width:${(entry.total / maxCount) * 100}%"></span></div></div></div>`;
    }),
  ].join("");
  bindTooltips(daysTable);
}

function renderTerms(topTerms) {
  if (!topTerms.length) {
    termsCloud.innerHTML = `<div class="empty-state">文字訊息太少，還整理不出常見詞。</div>`;
    return;
  }

  const maxCount = Math.max(...topTerms.map((term) => term.count), 1);
  termsCloud.innerHTML = topTerms
    .map((term) => {
      const emphasis = 0.9 + (term.count / maxCount) * 0.7;
      return `<span class="term-chip has-tooltip" data-tooltip="${escapeAttribute(`${term.term}\n出現 ${term.count.toLocaleString()} 次`)}" style="font-size:${emphasis}rem"><strong>${escapeHtml(term.term)}</strong>${term.count}</span>`;
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
  if (!topReactions.length) {
    reactionsPanel.innerHTML = `<div class="empty-state">這份聊天裡還沒有表情反應資料。</div>`;
    return;
  }

  reactionsPanel.innerHTML = topReactions
    .map((reaction) => {
      const share = totalReactionCount ? ((reaction.count / totalReactionCount) * 100).toFixed(1) : "0.0";
      const tooltip = `${reaction.label}\n${reaction.count.toLocaleString()} 次表情反應\n占比 ${share}%`;
      return `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(tooltip)}">
        <div class="call-row-meta">
          <strong>${escapeHtml(reaction.label)}</strong>
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
                `<span class="phrase-chip has-tooltip" data-tooltip="${escapeAttribute(`${entry.term}\n${person.name} 用了 ${entry.count.toLocaleString()} 次`)}"><strong>${escapeHtml(entry.term)}</strong>${entry.count}</span>`,
            )
            .join("")
        : `<span class="table-muted">目前還看不出明顯的常用詞。</span>`;

      const topPhrases = person.topPhrases.length
        ? person.topPhrases
            .map(
              (entry) =>
                `<span class="phrase-chip warm has-tooltip" data-tooltip="${escapeAttribute(`${entry.term}\n${person.name} 有 ${entry.count.toLocaleString()} 則訊息出現這句`)}">「${escapeHtml(entry.term)}」<strong>${entry.count}</strong></span>`,
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
          const tooltip = `${person.name}\n${category.label}: ${category.count.toLocaleString()} 則\n占比 ${category.share}%`;
          return `<div class="mix-row has-tooltip" data-tooltip="${escapeAttribute(tooltip)}">
            <div class="mix-meta">
              <strong>${escapeHtml(category.label)}</strong>
              <span>${category.count.toLocaleString()} 則</span>
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
      meta: calls.topHour ? `${calls.topHour.count.toLocaleString()} 次通話` : "目前資料還不夠",
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
      (person) => `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(`${person.name}\n通話 ${person.count.toLocaleString()} 次\n占比 ${person.share}%\n累積 ${person.durationLabel}`)}">
        <div class="call-row-meta">
          <strong>${escapeHtml(person.name)}</strong>
          <span>${person.count.toLocaleString()} 次 / ${person.durationLabel}</span>
        </div>
        <div class="call-row-bar"><span style="width:${person.share}%"></span></div>
        <div class="call-row-share">${person.share}%</div>
      </div>`,
    )
    .join("");

  const monthRows = calls.byMonth
    .map(
      (entry) => `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(`${entry.label}\n${entry.count.toLocaleString()} 次通話\n累積 ${entry.durationLabel}`)}">
        <div class="call-row-meta">
          <strong>${entry.label}</strong>
          <span>${entry.count.toLocaleString()} 次 / ${entry.durationLabel}</span>
        </div>
        <div class="call-row-bar warm"><span style="width:${entry.share}%"></span></div>
        <div class="call-row-share">${entry.share}%</div>
      </div>`,
    )
    .join("");

  const hourRows = calls.byHour
    .map(
      (entry) => `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(`${entry.label}\n${entry.count.toLocaleString()} 次通話`)}">
        <div class="call-row-meta">
          <strong>${entry.label}</strong>
          <span>${entry.count.toLocaleString()} 次</span>
        </div>
        <div class="call-row-bar"><span style="width:${entry.share}%"></span></div>
        <div class="call-row-share">${entry.share}%</div>
      </div>`,
    )
    .join("");

  const outcomeChips = calls.outcomes
    .map(
      (entry) => `<div class="call-row has-tooltip" data-tooltip="${escapeAttribute(`${entry.label}\n${entry.count.toLocaleString()} 次\n占比 ${entry.share}%`)}">
        <div class="call-row-meta">
          <strong>${escapeHtml(entry.label)}</strong>
          <span>${entry.count.toLocaleString()} 次</span>
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
