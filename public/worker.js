const REPLY_BUCKETS_MS = [
  5_000,
  20_000,
  60_000,
  5 * 60_000,
  30 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
];

const REPLY_BUCKET_LABELS = [
  "0-5s",
  "5-20s",
  "20-60s",
  "1-5m",
  "5-30m",
  "30m-6h",
  "6h-1d",
  ">1d",
];
const DEFAULT_SESSION_THRESHOLD_MS = 30 * 60_000;
const SESSION_THRESHOLD_FALLBACK_MS = DEFAULT_SESSION_THRESHOLD_MS;
const SESSION_THRESHOLD_MIN_MS = 10 * 60_000;
const SESSION_THRESHOLD_MAX_MS = 24 * 60 * 60_000;
const SESSION_THRESHOLDS_MS = [
  10 * 60_000,
  DEFAULT_SESSION_THRESHOLD_MS,
  60 * 60_000,
  6 * 60 * 60_000,
];
const QUICK_REPLY_MAX_MS = 60 * 60_000;
const WORD_CATEGORIES = {
  grammaticalStopwords: [
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "you",
    "are",
    "was",
    "have",
    "just",
    "from",
    "https",
    "http",
    "www",
    "com",
    "我",
    "你",
    "他",
    "她",
    "它",
    "我們",
    "你們",
    "他們",
    "的",
    "了",
    "是",
    "就",
    "也",
    "在",
    "有",
    "很",
    "嗎",
    "可以",
    "不是",
    "一個",
    "和",
    "與",
    "這",
    "那",
  ],
  fillers: ["嗯", "呃", "欸", "喔", "哦", "啊", "啦", "吧", "嘛", "呢", "呀"],
  laughter: ["哈哈", "哈哈哈", "lol", "xd"],
  emotionMarkers: ["嗚嗚", "哭", "笑死", "傻眼"],
};
const GRAMMATICAL_STOPWORDS = new Set(WORD_CATEGORIES.grammaticalStopwords);
const STOPWORDS = new Set([
  ...WORD_CATEGORIES.grammaticalStopwords,
  ...WORD_CATEGORIES.fillers,
  ...WORD_CATEGORIES.laughter,
  ...WORD_CATEGORIES.emotionMarkers,
]);
/*
 * General word clouds exclude grammatical stopwords. Fillers, laughter, and
 * emotion markers remain available as conversational tone signals so they are
 * not silently erased from per-participant language summaries.
 */
const GENERAL_WORD_EXCLUSIONS = GRAMMATICAL_STOPWORDS;
const TONE_MARKERS = new Set([
  ...WORD_CATEGORIES.fillers,
  ...WORD_CATEGORIES.laughter,
  ...WORD_CATEGORIES.emotionMarkers,
]);
const LEGACY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "you",
  "are",
  "was",
  "have",
  "just",
  "from",
  "https",
  "http",
  "www",
  "com",
  "我",
  "你",
  "他",
  "她",
  "它",
  "我們",
  "你們",
  "他們",
  "的",
  "了",
  "是",
  "就",
  "也",
  "在",
  "有",
  "很",
  "嗎",
  "啊",
  "吧",
  "啦",
  "喔",
  "欸",
  "嗯",
  "哈哈",
  "可以",
  "不是",
  "一個",
]);
const HAN_SEGMENT_BOUNDARIES = new Set([
  "的",
  "了",
  "是",
  "在",
  "有",
  "和",
  "跟",
  "與",
  "及",
  "或",
  "被",
  "把",
  "讓",
  "給",
  "到",
  "向",
  "對",
  "比",
  "就",
  "才",
  "又",
  "再",
  "還",
  "都",
  "也",
  "很",
  "太",
  "更",
  "最",
  "嗎",
  "啊",
  "吧",
  "啦",
  "喔",
  "欸",
  "嗯",
  "嘛",
  "呢",
  "哦",
  "嘿",
  "呀",
  "我",
  "你",
  "他",
  "她",
  "它",
]);
const PHRASE_STOPWORDS = new Set(["哈哈", "晚安", "早安", "貼圖", "圖片"]);
const MESSAGE_TYPE_LABELS = {
  text: "文字",
  photo: "圖片",
  sticker: "貼圖",
  video: "影片",
  voice: "語音",
  audio: "音訊",
  animation: "GIF/動畫",
  file: "檔案",
  other: "其他",
};
const QUANTILE_SAMPLE_LIMIT = 20_000;
const EXACT_QUANTILE_LIMIT = 50_000;
const TIMELINE_TOP_N_OPTIONS = [5, 8, 12, 20];
const TIMELINE_PARTICIPANT_LIMIT = 8;
const LANGUAGE_PARTICIPANT_LIMIT = 24;
const LANGUAGE_MIN_MESSAGES = 5;
const REPLY_ASYMMETRY_PARTICIPANT_LIMIT = 12;
const GROUP_CONCENTRATION_THRESHOLDS = {
  low: 0.4,
  high: 0.7,
};

self.addEventListener("message", async ({ data }) => {
  if (data.type !== "analyze") {
    return;
  }

  try {
    const payload = await analyzeFile(data.file, data.options || {});
    self.postMessage({ type: "result", payload });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "未知錯誤",
    });
  }
});

async function analyzeFile(file, options = {}) {
  const validation = validateTelegramExportFile(file);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const state = createState(options);
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let preamble = "";
  let foundMessages = false;
  let inString = false;
  let escapeNext = false;
  let depth = 0;
  let currentObject = "";
  let processedMessages = 0;
  let lastProgressSent = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    bytesRead += value.byteLength;
    let text = decoder.decode(value, { stream: true });

    if (!foundMessages) {
      preamble += text;
      const match = preamble.match(/"messages"\s*:\s*\[/);
      if (!match) {
        if (preamble.length > 200_000) {
          throw new Error(buildValidationResult("MESSAGES_MISSING", preamble).message);
        }
        sendProgress(bytesRead, file.size, processedMessages, "正在確認聊天檔格式");
        continue;
      }

      const startIndex = match.index + match[0].length;
      state.telegramChatType = extractRootStringField(preamble, "type") || "unknown";
      state.chatName = extractRootStringField(preamble, "name") || extractRootStringField(preamble, "title") || "";
      text = preamble.slice(startIndex);
      preamble = "";
      foundMessages = true;
    }

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (depth === 0) {
        if (char === "{") {
          depth = 1;
          currentObject = "{";
          inString = false;
          escapeNext = false;
        } else if (char === "]") {
          break;
        }
        continue;
      }

      currentObject += char;

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        depth += 1;
        continue;
      }

      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          processedMessages += 1;
          try {
            processMessageObject(JSON.parse(currentObject), state);
          } catch (error) {
            if (error instanceof SyntaxError) {
              throw new Error(buildValidationResult("INVALID_JSON").message);
            }
            throw error;
          }
          currentObject = "";
        }
      }
    }

    const progress = (bytesRead / file.size) * 100;
    if (progress - lastProgressSent >= 1 || processedMessages < 10) {
      sendProgress(bytesRead, file.size, processedMessages, "正在整理聊天內容，請稍候");
      lastProgressSent = progress;
    }
  }

  if (!foundMessages) {
    throw new Error(buildValidationResult("MESSAGES_MISSING", preamble).message);
  }

  if (depth !== 0 || currentObject) {
    throw new Error(buildValidationResult("TRUNCATED_JSON").message);
  }

  finalizeState(state);
  return buildPayload(state);
}

function validateTelegramExport(input) {
  if (input === null || input === undefined) {
    return buildValidationResult("EMPTY_FILE");
  }

  if (typeof input === "string") {
    if (!input.trim()) {
      return buildValidationResult("EMPTY_FILE");
    }

    try {
      return validateTelegramExport(JSON.parse(input));
    } catch (error) {
      const code = looksTruncatedJson(input) ? "TRUNCATED_JSON" : "INVALID_JSON";
      return buildValidationResult(code, input);
    }
  }

  if (typeof input !== "object") {
    return buildValidationResult("UNSUPPORTED_EXPORT");
  }

  const detectedFormat = detectTelegramExportFormat(input);
  if (!("messages" in input)) {
    return buildValidationResult(
      detectedFormat === "full-account-like" ? "POSSIBLE_FULL_ACCOUNT_EXPORT" : "MESSAGES_MISSING",
      input,
    );
  }

  if (!Array.isArray(input.messages)) {
    return buildValidationResult("MESSAGES_NOT_ARRAY", input);
  }

  if (input.messages.length === 0) {
    return buildValidationResult("EMPTY_MESSAGES", input);
  }

  return {
    valid: true,
    code: "OK",
    message: "可分析的 Telegram 對話 JSON。",
    suggestions: [],
    detectedFormat,
  };
}

function validateTelegramExportFile(file) {
  if (!file || typeof file.size !== "number" || file.size === 0) {
    return buildValidationResult("EMPTY_FILE");
  }
  return {
    valid: true,
    code: "PENDING_STREAM_VALIDATION",
    message: "等待串流檢查 Telegram 匯出內容。",
    suggestions: [],
    detectedFormat: "unknown",
  };
}

function buildValidationResult(code, input = null) {
  const detectedFormat = detectTelegramExportFormat(input);
  const base = {
    valid: false,
    code,
    detectedFormat,
    suggestions: [
      "請使用 Telegram Desktop 匯出單一對話。",
      "匯出格式請選 JSON。",
      "請選擇匯出資料夾中的 result.json，而不是 HTML 檔案。",
    ],
  };

  const messages = {
    EMPTY_FILE: "檔案是空的，請重新選擇 Telegram 匯出的 result.json。",
    INVALID_JSON: "JSON 語法無法解析，請確認檔案未被修改且完整下載。",
    MESSAGES_MISSING: "找不到 messages 陣列。請確認這是單一 Telegram 對話的 JSON 匯出檔。",
    MESSAGES_NOT_ARRAY: "messages 欄位不是陣列，這份檔案不是目前可分析的 Telegram 對話格式。",
    EMPTY_MESSAGES: "messages 陣列是空的，沒有可分析的訊息。",
    UNSUPPORTED_EXPORT: "這份檔案不是目前支援的 Telegram 對話 JSON 結構。",
    TRUNCATED_JSON: "JSON 看起來不完整，可能是匯出或複製過程中被截斷。",
    POSSIBLE_FULL_ACCOUNT_EXPORT:
      "偵測到多聊天或全帳號匯出格式。請改用 Telegram Desktop 匯出單一對話的 result.json。",
  };

  return {
    ...base,
    message: messages[code] || messages.UNSUPPORTED_EXPORT,
  };
}

function detectTelegramExportFormat(input) {
  if (!input) {
    return "unknown";
  }
  if (typeof input === "string") {
    if (/"messages"\s*:\s*\[/.test(input)) {
      return "single-chat-like";
    }
    if (/"chats"\s*:|"_chat_map"\s*:|accounts?\s*:/i.test(input)) {
      return "full-account-like";
    }
    return "unknown";
  }
  if (typeof input === "object") {
    if (Array.isArray(input.messages)) {
      return "single-chat";
    }
    if (input.chats || input._chat_map || input.account || input.accounts) {
      return "full-account-like";
    }
  }
  return "unknown";
}

function looksTruncatedJson(text) {
  const trimmed = text.trim();
  return Boolean(trimmed) && !/[}\]]\s*$/u.test(trimmed);
}

function extractRootStringField(preamble, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`);
  const match = preamble.match(pattern);
  return match ? match[1] : "";
}

function createState(options = {}) {
  const customDictionary = normalizeCustomDictionary(options.customDictionary);
  const tokenizer = createTokenizer(customDictionary);
  return {
    options: {
      customDictionary,
    },
    tokenizer,
    wordAnalysisMeta: {
      tokenizer: tokenizer.strategy,
      locale: "zh-Hant",
      customDictionaryCount: customDictionary.length,
      analyzedTextMessageCount: 0,
      rejectedTokenCount: 0,
    },
    chatName: "",
    telegramChatType: "unknown",
    totalMessages: 0,
    textMessages: 0,
    editedMessages: 0,
    forwardedMessages: 0,
    linkedMessages: 0,
    reactedMessages: 0,
    totalReactionCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    participants: new Map(),
    daily: new Map(),
    monthly: new Map(),
    heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
    replyBuckets: Array(REPLY_BUCKET_LABELS.length).fill(0),
    messageGapStats: createQuantileSampler(QUANTILE_SAMPLE_LIMIT),
    turnDelayStats: createQuantileSampler(QUANTILE_SAMPLE_LIMIT),
    turnSwitchCount: 0,
    sequenceSenders: [],
    sequenceTimestamps: [],
    calls: [],
    lastMessage: null,
    longestGap: null,
    heavyTerms: new Map(),
    catchphraseStats: new Map(),
    reactionTypes: new Map(),
  };
}

function processMessageObject(message, state) {
  const sender = resolveSender(message);
  const timestamp = parseTimestamp(message.date);
  if (!Number.isFinite(timestamp)) {
    return;
  }

  if (isPhoneCallEvent(message)) {
    processPhoneCall(message, state, sender, timestamp);
    return;
  }

  if (message.type !== "message") {
    return;
  }

  const date = new Date(timestamp);
  const text = extractText(message.text);
  const trimmedText = text.trim();
  const hasText = trimmedText.length > 0;
  const hasMedia = detectMedia(message, hasText);

  state.totalMessages += 1;
  if (hasText) {
    state.textMessages += 1;
  }

  if (state.firstTimestamp === null || timestamp < state.firstTimestamp) {
    state.firstTimestamp = timestamp;
  }
  if (state.lastTimestamp === null || timestamp > state.lastTimestamp) {
    state.lastTimestamp = timestamp;
  }

  const person = getOrCreateParticipant(state.participants, sender);
  person.messages += 1;
  person.characters += trimmedText.length;

  if (message.forwarded_from) {
    state.forwardedMessages += 1;
    person.forwards += 1;
  }

  if (message.edited || message.edited_unixtime) {
    state.editedMessages += 1;
    person.edits += 1;
  }

  if (
    message.text_entities &&
    message.text_entities.some((entity) => entity.type === "link" || entity.type === "text_link")
  ) {
    state.linkedMessages += 1;
    person.links += 1;
  }

  if (message.reactions && Array.isArray(message.reactions)) {
    let reactionCountForMessage = 0;
    for (const reaction of message.reactions) {
      const reactionKey = resolveReactionKey(reaction);
      if (reactionKey) {
        reactionCountForMessage += reaction.count || 0;
        recordReaction(state.reactionTypes, reactionKey, reaction.count || 0);
        recordReaction(person.reactionsReceived, reactionKey, reaction.count || 0);
      }
    }
    if (reactionCountForMessage > 0) {
      state.reactedMessages += 1;
      state.totalReactionCount += reactionCountForMessage;
    }
  }

  if (hasMedia) {
    person.mediaMessages += 1;
  }
  incrementMessageType(person.messageTypes, classifyMessageType(message, hasText));

  const dayKey = formatLocalDate(date);
  const monthKey = dayKey.slice(0, 7);
  const dayStats = getOrCreateBucket(state.daily, dayKey);
  const monthStats = getOrCreateBucket(state.monthly, monthKey);
  dayStats.total += 1;
  monthStats.total += 1;
  dayStats.byParticipant[sender] = (dayStats.byParticipant[sender] || 0) + 1;
  monthStats.byParticipant[sender] = (monthStats.byParticipant[sender] || 0) + 1;

  const weekday = (date.getDay() + 6) % 7;
  state.heatmap[weekday][date.getHours()] += 1;

  if (hasText) {
    state.wordAnalysisMeta.analyzedTextMessageCount += 1;
    updateHeavyTerms(state, trimmedText);
    updateParticipantLanguage(state, sender, trimmedText, person.messages, dayKey);
  }

  if (state.lastMessage) {
    const gap = timestamp - state.lastMessage.timestamp;
    if (gap >= 0) {
      addQuantileSample(state.messageGapStats, gap);
    }

    if (state.lastMessage.sender !== sender) {
      const delay = gap;
      if (delay >= 0) {
        addReplyDelay(state, delay);
        addQuantileSample(state.turnDelayStats, delay);
        state.turnSwitchCount += 1;
      }
    }

    if (
      gap >= 0 &&
      (!state.longestGap || gap > state.longestGap.duration)
    ) {
      state.longestGap = {
        duration: gap,
        from: state.lastMessage.timestamp,
        to: timestamp,
      };
    }
  }

  state.lastMessage = { sender, timestamp };
  state.sequenceSenders.push(sender);
  state.sequenceTimestamps.push(timestamp);
}

function resolveSender(message) {
  const candidates = [
    message.from,
    message.actor,
    message.member_id,
    message.from_id,
    message.actor_id,
    message.user_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "Unknown";
}

function finalizeState(state) {
  state.sessionThreshold = DEFAULT_SESSION_THRESHOLD_MS;
  state.quickReplyThreshold = Math.min(state.sessionThreshold, QUICK_REPLY_MAX_MS);
  state.sessionMetricsByThreshold = buildSessionMetricsByThreshold(
    state.sequenceSenders,
    state.sequenceTimestamps,
  );
  state.defaultSessionMetrics = state.sessionMetricsByThreshold[String(DEFAULT_SESSION_THRESHOLD_MS)];
  state.sessions = state.defaultSessionMetrics.sessions;
  state.sessionRestartIntervals = state.defaultSessionMetrics.restartIntervals;
  state.immediateReplyCount = state.defaultSessionMetrics.quickReplyCount;
  state.immediateReplyDelays = state.defaultSessionMetrics.replySamples;
}

function buildPayload(state) {
  const participants = [...state.participants.entries()]
    .map(([name, stats]) => ({
      name,
      messages: stats.messages,
      characters: stats.characters,
      avgChars: stats.messages ? stats.characters / stats.messages : 0,
      mediaShare: stats.messages ? ((stats.mediaMessages / stats.messages) * 100).toFixed(1) : "0.0",
      edits: stats.edits,
      forwards: stats.forwards,
      links: stats.links,
      editRatio: stats.messages ? ((stats.edits / stats.messages) * 100).toFixed(1) : "0.0",
      reactionCountReceived: sumMapValues(stats.reactionsReceived),
      reactionsReceived: buildReactionPayload(stats.reactionsReceived, 4),
    }))
    .sort((left, right) => right.messages - left.messages);
  const participantCount = participants.length;
  const conversationMode = getConversationMode(participantCount);
  const sessionMetrics = state.defaultSessionMetrics;
  const timelineParticipants = participants.slice(0, TIMELINE_PARTICIPANT_LIMIT);
  const timelineParticipantNames = timelineParticipants.map((participant) => participant.name);
  const timelineNamesWithOther =
    participantCount > timelineParticipants.length
      ? [...timelineParticipantNames, "其他"]
      : timelineParticipantNames;

  const dailyEntries = [...state.daily.entries()].map(([date, entry]) => ({
    date,
    total: entry.total,
    byParticipant: buildGroupedParticipantCounts(entry, timelineParticipantNames),
    weekday: formatWeekday(date),
  }));

  const monthlyEntries = [...state.monthly.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, entry]) => ({
      label: month,
      total: entry.total,
      byParticipant: buildGroupedParticipantCounts(entry, timelineParticipantNames),
    }));

  const totalMessages = state.totalMessages || 1;
  const spanDays = calculateSpanDays(state.firstTimestamp, state.lastTimestamp);
  const activeDays = state.daily.size;
  const topParticipants = participants.slice(0, 2).map((participant) => ({
    name: participant.name,
    share: ((participant.messages / totalMessages) * 100).toFixed(1),
  }));
  const immediateReply = sessionMetrics.replyP90;
  const restartReply = sessionMetrics.restartMedian;
  const quickLabel = sessionMetrics.quickReplyThresholdLabel;
  const sessionLabel = sessionMetrics.thresholdLabel;
  const trendViewsByTopN = buildTrendViewsByTopN(state, participants);
  const groupMetrics = buildGroupMetrics(participants, sessionMetrics);
  const balance = conversationMode === "group"
    ? buildGroupBalanceSummary(groupMetrics)
    : {
        label: buildBalanceLabel(topParticipants),
        meta: buildBalanceMeta(topParticipants, participants.length),
      };

  return {
    conversationMode,
    participantCount,
    telegramChatType: state.telegramChatType,
    chatName: state.chatName,
    participants: timelineNamesWithOther,
    trendViewsByTopN,
    selectedSessionThreshold: DEFAULT_SESSION_THRESHOLD_MS,
    sessionThresholdOptions: SESSION_THRESHOLDS_MS.map((threshold) => ({
      value: threshold,
      label: formatThresholdLabel(threshold),
    })),
    sessionMetricsByThreshold: serializeSessionMetrics(state.sessionMetricsByThreshold),
    groupMetrics,
    analysisPrecision: sessionMetrics.precision,
    wordAnalysisMeta: state.wordAnalysisMeta,
    presentationLimits: {
      trendTopNDefault: TIMELINE_PARTICIPANT_LIMIT,
      trendTopNOptions: TIMELINE_TOP_N_OPTIONS,
      participantTableTotal: participantCount,
      personalWordStatsComputedFor: Math.min(LANGUAGE_PARTICIPANT_LIMIT, participantCount),
      personalTypeStatsComputedFor: Math.min(LANGUAGE_PARTICIPANT_LIMIT, participantCount),
    },
    summary: {
      totalMessages: state.totalMessages,
      conversationMode,
      telegramChatType: state.telegramChatType,
      participantCount,
      displayedParticipantCount: timelineNamesWithOther.length,
      textMessages: state.textMessages,
      editedMessages: state.editedMessages,
      forwardedMessages: state.forwardedMessages,
      linkedMessages: state.linkedMessages,
      reactedMessages: state.reactedMessages,
      totalReactionCount: state.totalReactionCount,
      activeDays,
      spanDays,
      rangeLabel: buildRangeLabel(state.firstTimestamp, state.lastTimestamp),
      avgPerActiveDay: activeDays ? (state.totalMessages / activeDays).toFixed(1) : "0",
      activeDensityLabel: spanDays ? `${((activeDays / spanDays) * 100).toFixed(1)}%` : "暫無",
      activeDensityMeta: spanDays
        ? `${activeDays.toLocaleString()} / ${spanDays.toLocaleString()} 天有對話`
        : "目前資料還不夠",
      balanceLabel: balance.label,
      balanceMeta: balance.meta,
      immediateReplyLabel: immediateReply === null ? "暫無" : formatDuration(immediateReply),
      immediateReplyMeta: sessionMetrics.turnSwitchCount
        ? `${sessionMetrics.quickReplyCount.toLocaleString()} 次 ${quickLabel}內接話；回覆速度僅計算同一段對話內的換人接話`
        : "目前還沒有足夠的短間隔回覆",
      restartReplyLabel: restartReply === null ? "暫無" : formatDuration(restartReply),
      restartReplyMeta: sessionMetrics.restartCount
        ? `以 ${sessionLabel} 作為對話斷點，${sessionMetrics.restartCount.toLocaleString()} 次重啟間隔的中位數`
        : "目前還沒有足夠的重啟對話",
    },
    insights: {
      activeHours: buildActiveHoursInsight(state.heatmap),
      burstiness: buildBurstinessInsight(dailyEntries),
      stickiness: buildStickinessInsight(sessionMetrics.quickReplyCount, sessionMetrics.turnSwitchCount, sessionMetrics.quickReplyThreshold),
      restartFrequency: buildRestartFrequencyInsight(sessionMetrics.restartCount, spanDays, sessionMetrics.threshold),
      replyAsymmetry: conversationMode === "direct"
        ? buildReplyAsymmetryInsightFromMetrics(sessionMetrics.directionalReplies)
        : buildGroupReplyInsight(sessionMetrics.directionalReplies, conversationMode),
      initiative: conversationMode === "group"
        ? buildGroupInitiativeInsight(sessionMetrics.restartInitiators)
        : buildInitiativeInsight(state.sessions),
    },
    timeline: monthlyEntries,
    dailyTimeline: dailyEntries
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((entry) => ({
        label: entry.date,
        total: entry.total,
        byParticipant: entry.byParticipant,
      })),
    heatmap: state.heatmap,
    replyHistogram: {
      bins: REPLY_BUCKET_LABELS.map((label, index) => ({
        label,
        count: sessionMetrics.replyBuckets[index],
      })),
      precision: sessionMetrics.precision.replyMedian,
      longestGapLabel: sessionMetrics.longestSilence ? formatDuration(sessionMetrics.longestSilence.duration) : "暫無",
      longestGapRange: sessionMetrics.longestSilence
        ? `${formatShortDate(sessionMetrics.longestSilence.from)} → ${formatShortDate(sessionMetrics.longestSilence.to)}`
        : "目前資料還不夠",
    },
    topDays: dailyEntries
      .sort((left, right) => right.total - left.total)
      .slice(0, 8),
    topTerms: [...state.heavyTerms.entries()]
      .map(([term, count]) => ({ term, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 24),
    catchphrases: buildCatchphrasePayload(state.catchphraseStats, state.totalMessages),
    messageMix: buildMessageMixPayload(participants.slice(0, LANGUAGE_PARTICIPANT_LIMIT), state.participants),
    calls: buildCallsPayload(state.calls),
    people: participants,
    participantDisplay: {
      total: participantCount,
      timelineLimit: TIMELINE_PARTICIPANT_LIMIT,
      timelineHasOther: participantCount > timelineParticipants.length,
    },
    topReactions: buildReactionPayload(state.reactionTypes, 10),
  };
}

function getConversationMode(participantCount) {
  if (participantCount <= 1) {
    return "single";
  }
  if (participantCount === 2) {
    return "direct";
  }
  return "group";
}

function buildTrendViewsByTopN(state, participants) {
  const output = {};
  for (const limit of TIMELINE_TOP_N_OPTIONS) {
    const selectedNames = participants.slice(0, limit).map((participant) => participant.name);
    const namesWithOther =
      participants.length > selectedNames.length ? [...selectedNames, "其他"] : selectedNames;
    output[String(limit)] = {
      participants: namesWithOther,
      timeline: [...state.monthly.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, entry]) => ({
          label: month,
          total: entry.total,
          byParticipant: buildGroupedParticipantCounts(entry, selectedNames),
        })),
      dailyTimeline: [...state.daily.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, entry]) => ({
          label: date,
          total: entry.total,
          byParticipant: buildGroupedParticipantCounts(entry, selectedNames),
        })),
    };
  }
  return output;
}

function buildGroupMetrics(participants, sessionMetrics) {
  const counts = participants.map((participant) => participant.messages).filter((count) => count > 0);
  const totalMessages = counts.reduce((sum, count) => sum + count, 0);
  const topParticipantShare = totalMessages ? counts[0] / totalMessages : 0;
  const topThreeShare = totalMessages
    ? counts.slice(0, 3).reduce((sum, count) => sum + count, 0) / totalMessages
    : 0;
  const medianMessagesPerParticipant = quantile(counts, 0.5) || 0;
  return {
    activeParticipantCount: counts.length,
    topParticipantShare,
    topParticipantShareLabel: `${(topParticipantShare * 100).toFixed(1)}%`,
    topThreeShare,
    topThreeShareLabel: `${(topThreeShare * 100).toFixed(1)}%`,
    medianMessagesPerParticipant,
    starterRanking: sessionMetrics.restartInitiators,
    concentrationLevel: getConcentrationLevel(topThreeShare),
    concentrationLabel: getConcentrationLabel(topThreeShare),
  };
}

function getConcentrationLevel(topThreeShare) {
  if (topThreeShare < GROUP_CONCENTRATION_THRESHOLDS.low) {
    return "low";
  }
  if (topThreeShare < GROUP_CONCENTRATION_THRESHOLDS.high) {
    return "medium";
  }
  return "high";
}

function getConcentrationLabel(topThreeShare) {
  const level = getConcentrationLevel(topThreeShare);
  if (level === "low") {
    return "低集中：多人平均參與";
  }
  if (level === "medium") {
    return "中集中：部分成員較活躍";
  }
  return "高集中：主要由少數成員主導";
}

function buildGroupBalanceSummary(groupMetrics) {
  return {
    label: groupMetrics.topThreeShareLabel,
    meta: `${groupMetrics.concentrationLabel}，前三位訊息占比 ${groupMetrics.topThreeShareLabel}`,
  };
}

function serializeSessionMetrics(metricsByThreshold) {
  const output = {};
  for (const [threshold, metrics] of Object.entries(metricsByThreshold)) {
    output[threshold] = {
      threshold: metrics.threshold,
      thresholdLabel: metrics.thresholdLabel,
      quickReplyThreshold: metrics.quickReplyThreshold,
      quickReplyThresholdLabel: metrics.quickReplyThresholdLabel,
      sessionCount: metrics.sessionCount,
      sessionMedian: metrics.sessionMedian,
      restartCount: metrics.restartCount,
      restartMedian: metrics.restartMedian,
      restartInitiators: metrics.restartInitiators,
      longestSilence: metrics.longestSilence,
      turnSwitchCount: metrics.turnSwitchCount,
      quickReplyCount: metrics.quickReplyCount,
      replyBuckets: metrics.replyBuckets,
      replyMedian: metrics.replyMedian,
      replyP90: metrics.replyP90,
      directionalReplies: metrics.directionalReplies.slice(0, REPLY_ASYMMETRY_PARTICIPANT_LIMIT),
      precision: metrics.precision,
    };
  }
  return output;
}

function buildActiveHoursInsight(heatmap) {
  const hourlyTotals = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: heatmap.reduce((sum, row) => sum + row[hour], 0),
  }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);

  return {
    label: hourlyTotals.length ? formatHourRange(hourlyTotals[0].hour) : "暫無",
    meta: hourlyTotals.length
      ? hourlyTotals.map((entry) => `${formatHourRange(entry.hour)} (${entry.count.toLocaleString()} 則)`).join(" / ")
      : "目前資料還不夠",
  };
}

function buildBurstinessInsight(dailyEntries) {
  const dailyTotals = dailyEntries.map((entry) => entry.total).filter((value) => value > 0);
  const baseline = quantile(dailyTotals, 0.5);
  const peak = quantile(dailyTotals, 0.9);

  if (baseline === null || peak === null) {
    return {
      label: "暫無",
      meta: "目前還沒有足夠的每日資料",
    };
  }

  const ratio = peak / Math.max(baseline, 1);
  const descriptor = ratio <= 2 ? "幾乎固定" : ratio <= 4 ? "一般波動" : "落差明顯";

  return {
    label: `${descriptor}，差 ${ratio.toFixed(1)} 倍`,
    meta: `平常日 ${baseline.toLocaleString()} 則，聊開時可達 ${peak.toLocaleString()} 則`,
  };
}

function buildStickinessInsight(immediateCount, totalTurnSwitches, quickReplyThreshold) {
  if (!totalTurnSwitches) {
    return {
      label: "暫無",
      meta: "目前還沒有足夠的輪流回覆資料",
    };
  }

  const thresholdLabel = formatThresholdLabel(quickReplyThreshold);
  return {
    label: `${((immediateCount / totalTurnSwitches) * 100).toFixed(1)}%`,
    meta: `${immediateCount.toLocaleString()} / ${totalTurnSwitches.toLocaleString()} 次輪流回覆在 ${thresholdLabel}內接上`,
  };
}

function buildRestartFrequencyInsight(restartCount, spanDays, sessionThreshold) {
  const thresholdLabel = formatThresholdLabel(sessionThreshold);
  if (!restartCount || !spanDays) {
    return {
      label: restartCount ? "偏少" : "暫無",
      meta: restartCount
        ? `以 ${thresholdLabel} 作為對話斷點，共 ${restartCount.toLocaleString()} 次重啟`
        : "目前還沒有足夠的重啟對話資料",
    };
  }

  const perWeek = (restartCount / Math.max(spanDays / 7, 1)).toFixed(1);
  return {
    label: `${perWeek} 次/週`,
    meta: `以 ${thresholdLabel} 作為對話斷點，共 ${restartCount.toLocaleString()} 次重啟`,
  };
}

function buildReplyAsymmetryInsight(sequenceSenders, sequenceTimestamps, replyThreshold, participantNames) {
  const thresholdLabel = formatThresholdLabel(replyThreshold);
  const includedParticipants = new Set(participantNames);
  const participantCount = includedParticipants.size;
  if (participantCount < 2) {
    return {
      label: "暫無",
      meta: `目前還沒有足夠的雙向回覆資料（只看前 ${REPLY_ASYMMETRY_PARTICIPANT_LIMIT} 名、${thresholdLabel}內的接話）`,
      rows: [],
    };
  }

  const pairDelays = new Map();
  for (let index = 1; index < sequenceSenders.length; index += 1) {
    const previousSender = sequenceSenders[index - 1];
    const sender = sequenceSenders[index];
    if (
      previousSender !== sender &&
      includedParticipants.has(previousSender) &&
      includedParticipants.has(sender)
    ) {
      const key = `${previousSender}→${sender}`;
      if (!pairDelays.has(key)) {
        pairDelays.set(key, createQuantileSampler(QUANTILE_SAMPLE_LIMIT));
      }
      const delay = sequenceTimestamps[index] - sequenceTimestamps[index - 1];
      if (delay >= 0 && delay <= replyThreshold) {
        addQuantileSample(pairDelays.get(key), delay);
      }
    }
  }

  const directional = [...pairDelays.entries()]
    .map(([key, stats]) => ({
      key,
      count: stats.seen,
      median: quantile(getQuantileSamples(stats), 0.5),
    }))
    .filter((entry) => entry.median !== null)
    .sort((left, right) => right.count - left.count)
    .slice(0, 2);

  if (directional.length < 2) {
    return {
      label: directional[0] ? formatMetricDuration(directional[0].median) : "暫無",
      meta: directional[0]
        ? `${directional[0].key} 這個方向在 ${thresholdLabel}內的常見回覆速度`
        : `目前還沒有足夠的雙向回覆資料（只看前 ${REPLY_ASYMMETRY_PARTICIPANT_LIMIT} 名、${thresholdLabel}內的接話）`,
      rows: directional[0]
        ? [
            {
              label: formatReplyDirectionLabel(directional[0].key),
              value: formatMetricDuration(directional[0].median),
            },
          ]
        : [],
    };
  }

  const difference = Math.abs(directional[0].median - directional[1].median);
  return {
    label: `相差 ${formatMetricDuration(difference)}`,
    meta: `只看前 ${REPLY_ASYMMETRY_PARTICIPANT_LIMIT} 名、${thresholdLabel}內的接話，比較雙方平常回得多快`,
    rows: directional.map((entry) => ({
      label: formatReplyDirectionLabel(entry.key),
      value: formatMetricDuration(entry.median),
    })),
  };
}

function buildReplyAsymmetryInsightFromMetrics(directionalReplies) {
  const directional = directionalReplies.slice(0, 2);
  if (!directional.length) {
    return {
      label: "暫無",
      meta: "目前還沒有足夠的雙向回覆資料",
      rows: [],
    };
  }

  if (directional.length === 1) {
    return {
      label: formatMetricDuration(directional[0].median),
      meta: `${directional[0].key} 這個方向在同一段對話內的常見回覆速度`,
      rows: [
        {
          label: formatReplyDirectionLabel(directional[0].key),
          value: formatMetricDuration(directional[0].median),
        },
      ],
    };
  }

  const difference = Math.abs(directional[0].median - directional[1].median);
  return {
    label: `相差 ${formatMetricDuration(difference)}`,
    meta: "只比較同一段對話內的接話，不含超過對話斷點的沉默重啟",
    rows: directional.map((entry) => ({
      label: formatReplyDirectionLabel(entry.key),
      value: formatMetricDuration(entry.median),
    })),
  };
}

function buildGroupReplyInsight(directionalReplies, conversationMode) {
  if (conversationMode === "single") {
    return {
      label: "不適用",
      meta: "單人或特殊對話沒有雙向回覆比較。",
      rows: [],
    };
  }

  const top = directionalReplies[0];
  return {
    label: top ? formatMetricDuration(top.median) : "暫無",
    meta: top
      ? `群組模式僅顯示最常見的接話方向作為節奏線索：${formatReplyDirectionLabel(top.key)}`
      : "群組模式不使用一對一雙向比較，目前也沒有足夠的接話資料。",
    rows: directionalReplies.slice(0, 3).map((entry) => ({
      label: formatReplyDirectionLabel(entry.key),
      value: `${formatMetricDuration(entry.median)} / ${entry.count.toLocaleString()} 次`,
    })),
  };
}

function buildGroupInitiativeInsight(starterRanking) {
  if (!starterRanking.length) {
    return {
      label: "暫無",
      meta: "目前還沒有足夠的對話重啟資料。",
      rows: [],
    };
  }

  const top = starterRanking[0];
  return {
    label: top.name,
    meta: `群組重啟排行：${top.name} 發起 ${top.count.toLocaleString()} 次（${top.share}%）`,
    rows: starterRanking.slice(0, 3).map((entry) => ({
      label: entry.name,
      value: `${entry.count.toLocaleString()} 次（${entry.share}%）`,
    })),
  };
}

function formatReplyDirectionLabel(directionKey) {
  const [from, to] = directionKey.split("→");
  if (!from || !to) {
    return directionKey;
  }

  return `${to} 接 ${from}`;
}

function computeSessionThreshold(gaps) {
  if (gaps.length < 10) {
    return SESSION_THRESHOLD_FALLBACK_MS;
  }

  const p75 = quantile(gaps, 0.75);
  return Math.max(SESSION_THRESHOLD_MIN_MS, Math.min(SESSION_THRESHOLD_MAX_MS, p75 * 3));
}

function createQuantileSampler(limit) {
  return {
    limit,
    seen: 0,
    values: [],
  };
}

function addQuantileSample(stats, value) {
  if (!Number.isFinite(value)) {
    return;
  }

  stats.seen += 1;
  if (stats.values.length < stats.limit) {
    stats.values.push(value);
    return;
  }

  const index = (stats.seen * 48_271) % stats.limit;
  stats.values[index] = value;
}

function getQuantileSamples(stats) {
  return stats.values;
}

function estimateSampledCount(stats, sampleCount) {
  if (!stats.values.length || !sampleCount) {
    return 0;
  }
  if (stats.values.length === stats.seen) {
    return sampleCount;
  }
  return Math.round((sampleCount / stats.values.length) * stats.seen);
}

function buildSessions(sequenceSenders, sequenceTimestamps, threshold) {
  if (!sequenceSenders.length) {
    return [];
  }

  const sessions = [];
  let current = {
    initiator: sequenceSenders[0],
    start: sequenceTimestamps[0],
    end: sequenceTimestamps[0],
    messageCount: 1,
  };

  for (let i = 1; i < sequenceSenders.length; i += 1) {
    const gap = sequenceTimestamps[i] - sequenceTimestamps[i - 1];
    if (gap > threshold) {
      sessions.push(current);
      current = {
        initiator: sequenceSenders[i],
        start: sequenceTimestamps[i],
        end: sequenceTimestamps[i],
        messageCount: 1,
      };
    } else {
      current.end = sequenceTimestamps[i];
      current.messageCount += 1;
    }
  }

  sessions.push(current);
  return sessions;
}

function buildSessionMetricsByThreshold(sequenceSenders, sequenceTimestamps) {
  const output = {};
  for (const threshold of SESSION_THRESHOLDS_MS) {
    output[String(threshold)] = buildSessionMetrics(sequenceSenders, sequenceTimestamps, threshold);
  }
  return output;
}

function buildSessionMetrics(sequenceSenders, sequenceTimestamps, threshold) {
  const sessions = buildSessions(sequenceSenders, sequenceTimestamps, threshold);
  const replyBuckets = Array(REPLY_BUCKET_LABELS.length).fill(0);
  const replyQuantiles = createQuantileAccumulator();
  const restartQuantiles = createQuantileAccumulator();
  const sessionDurationQuantiles = createQuantileAccumulator();
  const restartInitiators = new Map();
  const directional = new Map();
  let turnSwitchCount = 0;
  let quickReplyCount = 0;
  let restartCount = 0;
  let longestSilence = null;

  for (const session of sessions) {
    const duration = Math.max(0, session.end - session.start);
    addQuantileValue(sessionDurationQuantiles, duration);
  }

  for (let index = 1; index < sequenceSenders.length; index += 1) {
    const previousSender = sequenceSenders[index - 1];
    const sender = sequenceSenders[index];
    const gap = sequenceTimestamps[index] - sequenceTimestamps[index - 1];
    if (gap < 0) {
      continue;
    }

    if (gap > threshold) {
      restartCount += 1;
      addQuantileValue(restartQuantiles, gap);
      restartInitiators.set(sender, (restartInitiators.get(sender) || 0) + 1);
      if (!longestSilence || gap > longestSilence.duration) {
        longestSilence = {
          duration: gap,
          from: sequenceTimestamps[index - 1],
          to: sequenceTimestamps[index],
          initiator: sender,
        };
      }
      continue;
    }

    if (previousSender !== sender) {
      turnSwitchCount += 1;
      if (gap <= QUICK_REPLY_MAX_MS) {
        quickReplyCount += 1;
      }
      addReplyDelayToBuckets(replyBuckets, gap);
      addQuantileValue(replyQuantiles, gap);

      const key = `${previousSender}→${sender}`;
      if (!directional.has(key)) {
        directional.set(key, {
          count: 0,
          quantiles: createQuantileAccumulator(),
        });
      }
      const pair = directional.get(key);
      pair.count += 1;
      addQuantileValue(pair.quantiles, gap);
    }
  }

  const replyMedian = getQuantileValue(replyQuantiles, 0.5);
  const replyP90 = getQuantileValue(replyQuantiles, 0.9);
  const restartMedian = getQuantileValue(restartQuantiles, 0.5);
  const sessionMedian = getQuantileValue(sessionDurationQuantiles, 0.5);

  return {
    threshold,
    thresholdLabel: formatThresholdLabel(threshold),
    quickReplyThreshold: Math.min(threshold, QUICK_REPLY_MAX_MS),
    quickReplyThresholdLabel: formatThresholdLabel(Math.min(threshold, QUICK_REPLY_MAX_MS)),
    sessions,
    sessionCount: sessions.length,
    sessionMedian,
    restartCount,
    restartIntervals: getQuantileSamplesForCompat(restartQuantiles),
    restartMedian,
    restartInitiators: buildRankedCounts(restartInitiators, restartCount, 12),
    longestSilence,
    turnSwitchCount,
    quickReplyCount,
    replyBuckets,
    replySamples: getQuantileSamplesForCompat(replyQuantiles),
    replyMedian,
    replyP90,
    directionalReplies: buildDirectionalReplyRows(directional),
    precision: {
      replyMedian: replyQuantiles.mode,
      restartMedian: restartQuantiles.mode,
      sessionMedian: sessionDurationQuantiles.mode,
      exactQuantileLimit: EXACT_QUANTILE_LIMIT,
    },
  };
}

function createQuantileAccumulator() {
  return {
    count: 0,
    values: [],
    histogram: Array(QUANTILE_HISTOGRAM_BOUNDS.length + 1).fill(0),
    mode: "exact",
  };
}

const QUANTILE_HISTOGRAM_BOUNDS = [
  1_000,
  2_000,
  5_000,
  10_000,
  20_000,
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
  3 * 24 * 60 * 60_000,
  7 * 24 * 60 * 60_000,
  30 * 24 * 60 * 60_000,
];

function addQuantileValue(stats, value) {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  stats.count += 1;
  if (stats.mode === "exact" && stats.values.length < EXACT_QUANTILE_LIMIT) {
    stats.values.push(value);
    return;
  }

  if (stats.mode === "exact") {
    for (const existing of stats.values) {
      addHistogramValue(stats.histogram, existing);
    }
    stats.values = [];
    stats.mode = "approximate";
  }
  addHistogramValue(stats.histogram, value);
}

function addHistogramValue(histogram, value) {
  const index = QUANTILE_HISTOGRAM_BOUNDS.findIndex((bound) => value <= bound);
  histogram[index === -1 ? histogram.length - 1 : index] += 1;
}

function getQuantileValue(stats, ratio) {
  if (!stats.count) {
    return null;
  }

  if (stats.mode === "exact") {
    return quantile(stats.values, ratio);
  }

  const target = Math.max(1, Math.ceil(stats.count * ratio));
  let cumulative = 0;
  for (let index = 0; index < stats.histogram.length; index += 1) {
    cumulative += stats.histogram[index];
    if (cumulative >= target) {
      return QUANTILE_HISTOGRAM_BOUNDS[index] || QUANTILE_HISTOGRAM_BOUNDS[QUANTILE_HISTOGRAM_BOUNDS.length - 1];
    }
  }
  return QUANTILE_HISTOGRAM_BOUNDS[QUANTILE_HISTOGRAM_BOUNDS.length - 1];
}

function getQuantileSamplesForCompat(stats) {
  return stats.mode === "exact" ? stats.values : [];
}

function addReplyDelayToBuckets(buckets, delay) {
  const bucketIndex = REPLY_BUCKETS_MS.findIndex((limit) => delay < limit);
  const safeIndex = bucketIndex === -1 ? buckets.length - 1 : bucketIndex;
  buckets[safeIndex] += 1;
}

function buildRankedCounts(counts, total, limit) {
  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      share: total ? ((count / total) * 100).toFixed(1) : "0.0",
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function buildDirectionalReplyRows(directional) {
  return [...directional.entries()]
    .map(([key, stats]) => ({
      key,
      count: stats.count,
      median: getQuantileValue(stats.quantiles, 0.5),
      precision: stats.quantiles.mode,
    }))
    .filter((entry) => entry.median !== null)
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function buildInitiativeInsight(sessions) {
  const restarts = sessions.slice(1);
  if (restarts.length < 3) {
    return {
      label: "暫無",
      meta: "對話場次太少，還看不出誰比較常先開口",
      rows: [],
    };
  }

  const counts = new Map();
  for (const session of restarts) {
    counts.set(session.initiator, (counts.get(session.initiator) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const topName = sorted[0][0];
  const topCount = sorted[0][1];
  const share = ((topCount / restarts.length) * 100).toFixed(1);

  return {
    label: topName,
    meta: `${restarts.length} 次重啟對話中，${topName} 先開口 ${topCount} 次（${share}%）`,
    rows: sorted.slice(0, 2).map(([name, count]) => ({
      label: name,
      value: `${count} 次（${((count / restarts.length) * 100).toFixed(1)}%）`,
    })),
  };
}

function formatThresholdLabel(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${minutes} 分鐘`;
  }
  const hours = ms / 3_600_000;
  if (hours === Math.floor(hours)) {
    return `${hours} 小時`;
  }
  return `${hours.toFixed(1)} 小時`;
}

function isPhoneCallEvent(message) {
  return message.action === "phone_call" || message.type === "phone_call";
}

function processPhoneCall(message, state, sender, timestamp) {
  const durationSeconds = extractCallDurationSeconds(message);
  const hasDuration = durationSeconds !== null;
  const outcome = getCallOutcomeLabel(message);
  state.calls.push({
    sender,
    timestamp,
    durationSeconds: hasDuration ? durationSeconds : 0,
    hasDuration,
    outcome,
    hasResult: hasCallResult(message),
    completeness: hasDuration && hasCallResult(message) ? "complete" : hasDuration || hasCallResult(message) ? "partial" : "minimal",
  });
}

function parseTimestamp(value) {
  return Date.parse(value);
}

function extractText(input) {
  if (typeof input === "string") {
    return input;
  }

  if (Array.isArray(input)) {
    return input
      .map((chunk) => {
        if (typeof chunk === "string") {
          return chunk;
        }
        if (chunk && typeof chunk.text === "string") {
          return chunk.text;
        }
        return "";
      })
      .join("");
  }

  return "";
}

function detectMedia(message, hasText) {
  const mediaKeys = [
    "photo",
    "file",
    "media_type",
    "thumbnail",
    "sticker_emoji",
    "video_file_size",
    "audio_file_size",
  ];
  return mediaKeys.some((key) => key in message) || !hasText;
}

function classifyMessageType(message, hasText) {
  if ("sticker_emoji" in message) {
    return "sticker";
  }
  if ("photo" in message) {
    return "photo";
  }
  if (message.media_type === "video_file" || "video_file_size" in message) {
    return "video";
  }
  if (message.media_type === "voice_message") {
    return "voice";
  }
  if (message.media_type === "audio_file" || "audio_file_size" in message) {
    return "audio";
  }
  if (message.media_type === "animation") {
    return "animation";
  }
  if ("file" in message || message.media_type === "document") {
    return "file";
  }
  if (hasText) {
    return "text";
  }
  return "other";
}

function getOrCreateParticipant(participants, name) {
  let participant = participants.get(name);
  if (!participant) {
    participant = {
      messages: 0,
      characters: 0,
      mediaMessages: 0,
      messageTypes: new Map(),
      edits: 0,
      forwards: 0,
      links: 0,
      reactionsReceived: new Map(),
    };
    participants.set(name, participant);
  }
  return participant;
}

function resolveReactionKey(reaction) {
  if (!reaction || typeof reaction !== "object") {
    return null;
  }

  if (reaction.type === "emoji" && typeof reaction.emoji === "string" && reaction.emoji.trim()) {
    return `emoji:${reaction.emoji.trim()}`;
  }

  if (reaction.type === "custom_emoji") {
    return "custom";
  }

  return null;
}

function recordReaction(map, key, count) {
  if (!key || !Number.isFinite(count) || count <= 0) {
    return;
  }
  map.set(key, (map.get(key) || 0) + count);
}

function formatReactionLabel(key) {
  if (key.startsWith("emoji:")) {
    return key.slice(6);
  }
  return "Custom Emoji";
}

function buildReactionPayload(map, limit) {
  return [...map.entries()]
    .map(([key, count]) => ({
      key,
      label: formatReactionLabel(key),
      count,
      kind: key.startsWith("emoji:") ? "emoji" : "custom",
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function sumMapValues(map) {
  let total = 0;
  for (const value of map.values()) {
    total += value;
  }
  return total;
}

function incrementMessageType(messageTypes, type) {
  messageTypes.set(type, (messageTypes.get(type) || 0) + 1);
}

function getOrCreateBucket(map, key) {
  let entry = map.get(key);
  if (!entry) {
    entry = { total: 0, byParticipant: {} };
    map.set(key, entry);
  }
  return entry;
}

function buildGroupedParticipantCounts(entry, selectedNames) {
  const grouped = {};
  let selectedTotal = 0;

  for (const name of selectedNames) {
    const count = entry.byParticipant[name] || 0;
    if (count > 0) {
      grouped[name] = count;
      selectedTotal += count;
    }
  }

  const other = entry.total - selectedTotal;
  if (other > 0) {
    grouped["其他"] = other;
  }

  return grouped;
}

function addReplyDelay(state, delay) {
  const bucketIndex = REPLY_BUCKETS_MS.findIndex((limit) => delay < limit);
  const safeIndex = bucketIndex === -1 ? state.replyBuckets.length - 1 : bucketIndex;
  state.replyBuckets[safeIndex] += 1;
}

function updateHeavyTerms(state, text) {
  const tokens = extractTermTokens(text, state.tokenizer, state.wordAnalysisMeta, {
    excludeToneMarkers: true,
  });
  for (const token of tokens) {
    recordCount(state.heavyTerms, token);
  }
}

function updateParticipantLanguage(state, sender, text, senderMessageCount, dayKey) {
  let person = state.catchphraseStats.get(sender);
  if (!person) {
    if (senderMessageCount < LANGUAGE_MIN_MESSAGES) {
      return;
    }
    if (state.catchphraseStats.size >= LANGUAGE_PARTICIPANT_LIMIT) {
      let smallestName = null;
      let smallestMessages = Infinity;
      for (const [name, stats] of state.catchphraseStats.entries()) {
        if (stats.messages < smallestMessages) {
          smallestName = name;
          smallestMessages = stats.messages;
        }
      }
      if (senderMessageCount <= smallestMessages) {
        return;
      }
      state.catchphraseStats.delete(smallestName);
    }
    person = {
      words: new Map(),
      phrases: new Map(),
      tone: new Map(),
      messages: senderMessageCount - 1,
    };
    state.catchphraseStats.set(sender, person);
  }

  person.messages += 1;

  for (const token of extractTermTokens(text, state.tokenizer, state.wordAnalysisMeta, {
    excludeToneMarkers: false,
  })) {
    if (TONE_MARKERS.has(token)) {
      recordCount(person.tone, token);
      continue;
    }
    recordCount(person.words, token);
  }

  for (const phrase of extractPhraseCandidates(text)) {
    recordPhraseCandidate(person.phrases, phrase, dayKey);
  }
}

function createTokenizer(customDictionary) {
  const hasSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";
  const segmenter = hasSegmenter ? new Intl.Segmenter("zh-Hant", { granularity: "word" }) : null;
  return {
    strategy: segmenter ? "intl-segmenter" : "fallback",
    segmenter,
    customDictionary,
  };
}

function normalizeCustomDictionary(input) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/\r?\n/u)
      : [];
  const seen = new Set();
  const words = [];
  for (const value of raw) {
    const word = String(value || "").trim().replace(/\s+/gu, " ");
    if (!word || word.length > 40 || seen.has(word)) {
      continue;
    }
    seen.add(word);
    words.push(word);
    if (words.length >= 100) {
      break;
    }
  }
  return words;
}

function extractTermTokens(text, tokenizer = createTokenizer([]), meta = null, options = {}) {
  const customDictionary = tokenizer.customDictionary || [];
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[_~!！?？,，.。:：;；、/|()[\]{}"'`<>#%^&*+=\\\n\r\t-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = tokenizer.segmenter
    ? segmentWithIntl(normalized, tokenizer.segmenter)
    : normalized.match(/[a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu) || [];
  const output = [];
  const customMatches = findCustomDictionaryMatches(text, customDictionary);
  output.push(...customMatches);
  for (const marker of TONE_MARKERS) {
    if (text.toLowerCase().includes(marker.toLowerCase())) {
      pushToken(marker, output, meta, options);
    }
  }

  for (const token of tokens) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      for (const candidate of extractHanTermCandidates(token)) {
        pushToken(candidate, output, meta, options);
      }
      continue;
    }

    pushToken(token, output, meta, options);
  }

  return output;
}

function segmentWithIntl(text, segmenter) {
  return [...segmenter.segment(text)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment.toLowerCase());
}

function pushToken(token, output, meta, options) {
  const normalized = normalizeToken(token);
  if (!normalized) {
    if (meta) {
      meta.rejectedTokenCount += 1;
    }
    return;
  }
  if (GENERAL_WORD_EXCLUSIONS.has(normalized)) {
    if (meta) {
      meta.rejectedTokenCount += 1;
    }
    return;
  }
  if (options.excludeToneMarkers && TONE_MARKERS.has(normalized)) {
    if (meta) {
      meta.rejectedTokenCount += 1;
    }
    return;
  }
  output.push(normalized);
}

function normalizeToken(token) {
  const normalized = String(token || "")
    .toLowerCase()
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (normalized.length < 2 || /^[\d\s]+$/u.test(normalized)) {
    return "";
  }
  return normalized;
}

function findCustomDictionaryMatches(text, customDictionary) {
  if (!customDictionary.length) {
    return [];
  }
  const lowerText = text.toLowerCase();
  return customDictionary
    .filter((term) => lowerText.includes(term.toLowerCase()))
    .map((term) => term.trim())
    .filter(Boolean);
}

function extractPhraseCandidates(text) {
  const normalized = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, " ")
    .replace(/[~!！?？,，.。:：;；、/\n\r\t]+/g, "|")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const seen = new Set();
  const phrases = [];
  for (const rawPart of normalized.split("|")) {
    const candidate = rawPart.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!candidate || candidate.length < 4 || candidate.length > 24) {
      continue;
    }
    if (/^\d+$/u.test(candidate) || PHRASE_STOPWORDS.has(candidate) || /^[\d\s:：/-]+$/u.test(candidate)) {
      continue;
    }
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    phrases.push(candidate);
  }
  return phrases;
}

function recordPhraseCandidate(map, phrase, dayKey) {
  let entry = map.get(phrase);
  if (!entry) {
    entry = {
      totalCount: 0,
      messageCount: 0,
      days: new Set(),
    };
    map.set(phrase, entry);
  }
  entry.totalCount += 1;
  entry.messageCount += 1;
  if (dayKey) {
    entry.days.add(dayKey);
  }
}

function extractHanTermCandidates(chunk) {
  const segments = splitHanSegments(chunk);
  const output = [];

  for (const segment of segments) {
    if (segment.length < 2) {
      continue;
    }

    if (segment.length <= 4) {
      if (!STOPWORDS.has(segment)) {
        output.push(segment);
      }
      continue;
    }

    for (const size of [3, 2]) {
      if (segment.length < size) {
        continue;
      }
      for (let index = 0; index <= segment.length - size; index += 1) {
        const candidate = segment.slice(index, index + size);
        if (STOPWORDS.has(candidate) || isNoisyHanCandidate(candidate)) {
          continue;
        }
        output.push(candidate);
      }
    }
  }

  return output;
}

function splitHanSegments(chunk) {
  const segments = [];
  let current = "";

  for (const char of chunk) {
    if (HAN_SEGMENT_BOUNDARIES.has(char)) {
      if (current.length) {
        segments.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length) {
    segments.push(current);
  }

  return segments;
}

function isNoisyHanCandidate(candidate) {
  if (candidate.length < 2) {
    return true;
  }

  if (/^(.)\1+$/u.test(candidate)) {
    return true;
  }

  return false;
}

function recordCount(map, key) {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) || 0) + 1);
}

function buildCatchphrasePayload(catchphraseStats, totalMessages) {
  return [...catchphraseStats.entries()]
    .map(([name, stats]) => {
      const phraseCandidates = suppressOverlappingPhrases(
        [...stats.phrases.entries()]
          .map(([term, entry]) => ({
            term,
            totalCount: entry.totalCount,
            messageCount: entry.messageCount,
            activeDayCount: entry.days.size,
            score: scorePhraseCandidate(term, entry),
          }))
          .filter((entry) => (
            entry.totalCount >= 3 &&
            entry.messageCount >= 2 &&
            entry.activeDayCount >= 2
          ))
          .sort((left, right) => right.score - left.score || right.totalCount - left.totalCount),
      );

      return {
        name,
        messageShare: totalMessages ? ((stats.messages / totalMessages) * 100).toFixed(1) : "0.0",
        topWords: [...stats.words.entries()]
          .map(([term, count]) => ({ term, count }))
          .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
          .slice(0, 8),
        toneMarkers: [...stats.tone.entries()]
          .map(([term, count]) => ({ term, count }))
          .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
          .slice(0, 5),
        topPhrases: phraseCandidates.slice(0, 6),
        messages: stats.messages,
      };
    })
    .sort((left, right) => right.messages - left.messages)
    .map(({ messages: _messages, ...person }) => person);
}

function scorePhraseCandidate(term, entry) {
  /*
   * Scores favor phrases that recur in several messages and days, while mildly
   * preferring concise phrases. Overlap suppression runs after this, so longer
   * variants must earn their place through broader recurrence.
   */
  const lengthScore = Math.min(term.length, 12) / 12;
  return (
    entry.messageCount * 3 +
    entry.days.size * 2 +
    entry.totalCount +
    lengthScore
  );
}

function suppressOverlappingPhrases(candidates) {
  const selected = [];
  for (const candidate of candidates) {
    const overlaps = selected.some((existing) => (
      existing.term.includes(candidate.term) || candidate.term.includes(existing.term)
    ));
    if (!overlaps) {
      selected.push(candidate);
    }
  }
  return selected;
}

function buildMessageMixPayload(participants, participantMap) {
  return participants.map((person) => {
    const source = participantMap.get(person.name);
    const total = person.messages || 1;
    const categories = Object.entries(MESSAGE_TYPE_LABELS)
      .map(([key, label]) => {
        const count = source?.messageTypes.get(key) || 0;
        return {
          key,
          label,
          count,
          share: ((count / total) * 100).toFixed(1),
        };
      })
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.count - left.count);

    return {
      name: person.name,
      total: person.messages,
      categories,
    };
  });
}

function buildCallsPayload(calls) {
  if (!calls.length) {
    return {
      total: 0,
      connected: 0,
      totalDurationLabel: "0 分",
      avgDurationLabel: "0 分",
      byParticipant: [],
      byMonth: [],
      byHour: [],
      outcomes: [],
      topCaller: null,
      topHour: null,
    };
  }

  const byParticipant = new Map();
  const byMonth = new Map();
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    count: 0,
  }));
  const outcomes = new Map();
  let connected = 0;
  let totalDurationSeconds = 0;
  let callsWithDuration = 0;
  let callsWithResult = 0;

  for (const call of calls) {
    const date = new Date(call.timestamp);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const hour = date.getHours();
    const participant = byParticipant.get(call.sender) || { name: call.sender, count: 0, durationSeconds: 0 };

    participant.count += 1;
    participant.durationSeconds += call.hasDuration ? call.durationSeconds : 0;
    byParticipant.set(call.sender, participant);

    const month = byMonth.get(monthKey) || { label: monthKey, count: 0, durationSeconds: 0 };
    month.count += 1;
    month.durationSeconds += call.hasDuration ? call.durationSeconds : 0;
    byMonth.set(monthKey, month);

    byHour[hour].count += 1;
    if (call.hasResult) {
      outcomes.set(call.outcome, (outcomes.get(call.outcome) || 0) + 1);
      callsWithResult += 1;
    }

    if (call.hasDuration) {
      callsWithDuration += 1;
    }
    if (call.hasDuration && call.durationSeconds > 0) {
      connected += 1;
      totalDurationSeconds += call.durationSeconds;
    }
  }

  const total = calls.length;
  const topCallerEntry = [...byParticipant.values()].sort((left, right) => right.count - left.count)[0] || null;
  const topHourEntry = [...byHour].sort((left, right) => right.count - left.count)[0] || null;

  return {
    total,
    connected,
    callsWithDuration,
    callsWithoutDuration: total - callsWithDuration,
    durationCompletenessRate: total ? callsWithDuration / total : 0,
    durationCompletenessLabel: `${(((callsWithDuration / total) || 0) * 100).toFixed(1)}%`,
    callsWithResult,
    callsWithoutResult: total - callsWithResult,
    totalDurationLabel: formatCallDuration(totalDurationSeconds),
    avgDurationLabel: formatCallDuration(callsWithDuration ? Math.round(totalDurationSeconds / callsWithDuration) : 0),
    byParticipant: [...byParticipant.values()]
      .sort((left, right) => right.count - left.count)
      .map((entry) => ({
        ...entry,
        share: ((entry.count / total) * 100).toFixed(1),
        durationLabel: formatCallDuration(entry.durationSeconds),
      })),
    byMonth: [...byMonth.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((entry) => ({
        ...entry,
        share: ((entry.count / total) * 100).toFixed(1),
        durationLabel: formatCallDuration(entry.durationSeconds),
      })),
    byHour: byHour
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, 8)
      .map((entry) => ({
        ...entry,
        share: ((entry.count / total) * 100).toFixed(1),
      })),
    outcomes: [...outcomes.entries()]
      .map(([label, count]) => ({
        label,
        count,
        share: ((count / total) * 100).toFixed(1),
      }))
      .sort((left, right) => right.count - left.count),
    topCaller: topCallerEntry
      ? {
          name: topCallerEntry.name,
          share: ((topCallerEntry.count / total) * 100).toFixed(1),
        }
      : null,
    topHour: topHourEntry
      ? {
          label: topHourEntry.label,
          count: topHourEntry.count,
        }
      : null,
  };
}

function extractCallDurationSeconds(message) {
  if (!("duration_seconds" in message) && !("duration" in message)) {
    return null;
  }
  const duration = Number(message.duration_seconds ?? message.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function getCallOutcomeLabel(message) {
  const reason = String(message.discard_reason || message.reason || "").toLowerCase();
  if (!reason) {
    return extractCallDurationSeconds(message) !== null ? "已接通" : "未知結果";
  }
  if (reason.includes("miss")) {
    return "未接";
  }
  if (reason.includes("disconnect") || reason.includes("hangup")) {
    return "主動掛斷";
  }
  if (reason.includes("busy")) {
    return "忙線";
  }
  if (reason.includes("declin")) {
    return "已拒接";
  }
  if (reason.includes("cancel")) {
    return "已取消";
  }
  return reason;
}

function hasCallResult(message) {
  return Boolean(message.discard_reason || message.reason || extractCallDurationSeconds(message) !== null);
}

function formatCallDuration(totalSeconds) {
  if (!totalSeconds) {
    return "0 分";
  }
  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours} 小時 ${remainMinutes} 分` : `${hours} 小時`;
}

function buildRangeLabel(first, last) {
  if (first === null || last === null) {
    return "N/A";
  }

  const days = calculateSpanDays(first, last);
  if (days >= 365) {
    return `${(days / 365).toFixed(1)} 年`;
  }
  if (days >= 30) {
    return `${(days / 30).toFixed(1)} 月`;
  }
  return `${days} 天`;
}

function calculateSpanDays(first, last) {
  if (first === null || last === null) {
    return 0;
  }

  const firstDate = new Date(first);
  const lastDate = new Date(last);
  const firstDay = Date.UTC(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
  const lastDay = Date.UTC(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());

  return Math.max(1, Math.round((lastDay - firstDay) / 86_400_000) + 1);
}

function quantile(values, ratio) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[index];
}

function buildBalanceLabel(topParticipants) {
  if (!topParticipants.length) {
    return "N/A";
  }

  if (topParticipants.length === 1) {
    return `${topParticipants[0].share}%`;
  }

  return `${topParticipants[0].share} / ${topParticipants[1].share}`;
}

function buildBalanceMeta(topParticipants, participantCount) {
  if (!topParticipants.length) {
    return "找不到參與者資料";
  }

  if (topParticipants.length === 1) {
    return topParticipants[0].name;
  }

  const names = `${topParticipants[0].name} vs ${topParticipants[1].name}`;
  if (participantCount <= 2) {
    return names;
  }

  return `${names}（共 ${participantCount.toLocaleString()} 位，取前兩位）`;
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) {
    return "<1 分";
  }
  if (minutes < 60) {
    return `${minutes} 分`;
  }
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) {
    return `${hours} 小時`;
  }
  const days = Math.round(ms / 86_400_000);
  if (days < 60) {
    return `${days} 天`;
  }
  return `${(days / 30).toFixed(1)} 月`;
}

function formatMetricDuration(ms) {
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s`;
  }

  return formatDuration(ms);
}

function formatShortDate(timestamp) {
  return formatLocalDate(new Date(timestamp));
}

function formatWeekday(dateString) {
  const weekdays = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];
  const weekday = (new Date(`${dateString}T00:00:00`).getDay() + 6) % 7;
  return weekdays[weekday];
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHourRange(hour) {
  return `${String(hour).padStart(2, "0")}:00-${String((hour + 1) % 24).padStart(2, "0")}:00`;
}

function sendProgress(bytesRead, fileSize, processedMessages, label) {
  self.postMessage({
    type: "progress",
    progress: (bytesRead / fileSize) * 100,
    processedMessages,
    label,
  });
}
