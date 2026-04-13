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
const REPLY_ASYMMETRY_MAX_MS = 30 * 60_000;
const STOPWORDS = new Set([
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

self.addEventListener("message", async ({ data }) => {
  if (data.type !== "analyze") {
    return;
  }

  try {
    const payload = await analyzeFile(data.file);
    self.postMessage({ type: "result", payload });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "未知錯誤",
    });
  }
});

async function analyzeFile(file) {
  const state = createState();
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
          throw new Error("這份檔案裡找不到 messages 陣列，可能不是 Telegram 匯出的 JSON 聊天檔。");
        }
        sendProgress(bytesRead, file.size, processedMessages, "正在確認聊天檔格式");
        continue;
      }

      const startIndex = match.index + match[0].length;
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
          processMessageObject(JSON.parse(currentObject), state);
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
    throw new Error("這份檔案看起來不是可以分析的 Telegram 對話 JSON。");
  }

  finalizeState(state);
  return buildPayload(state);
}

function createState() {
  return {
    chatName: "",
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
    immediateReplyDelays: [],
    restartReplyDelays: [],
    replySequence: [],
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
    updateHeavyTerms(state.heavyTerms, trimmedText);
    updateParticipantLanguage(state.catchphraseStats, sender, trimmedText);
  }

  if (state.lastMessage) {
    if (state.lastMessage.sender !== sender) {
      const delay = timestamp - state.lastMessage.timestamp;
      if (delay >= 0) {
        addReplyDelay(state, delay);
        if (delay < 30 * 60_000) {
          state.immediateReplyDelays.push(delay);
        } else {
          state.restartReplyDelays.push(delay);
        }
      }
    }

    const gap = timestamp - state.lastMessage.timestamp;
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
  state.replySequence.push({ sender, timestamp });
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

function finalizeState(_state) {}

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

  const dailyEntries = [...state.daily.entries()].map(([date, entry]) => ({
    date,
    total: entry.total,
    byParticipant: entry.byParticipant,
    weekday: formatWeekday(date),
  }));

  const monthlyEntries = [...state.monthly.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, entry]) => ({
      label: month,
      total: entry.total,
      byParticipant: entry.byParticipant,
    }));

  const totalMessages = state.totalMessages || 1;
  const spanDays = calculateSpanDays(state.firstTimestamp, state.lastTimestamp);
  const activeDays = state.daily.size;
  const topParticipants = participants.slice(0, 2).map((participant) => ({
    name: participant.name,
    share: ((participant.messages / totalMessages) * 100).toFixed(1),
  }));
  const immediateReply = quantile(state.immediateReplyDelays, 0.9);
  const restartReply = quantile(state.restartReplyDelays, 0.5);

  return {
    participants: participants.map((participant) => participant.name),
    summary: {
      totalMessages: state.totalMessages,
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
      balanceLabel: buildBalanceLabel(topParticipants),
      balanceMeta: buildBalanceMeta(topParticipants, participants.length),
      immediateReplyLabel: immediateReply === null ? "暫無" : formatDuration(immediateReply),
      immediateReplyMeta: state.immediateReplyDelays.length
        ? `${state.immediateReplyDelays.length.toLocaleString()} 次 30 分內接話的 p90`
        : "目前還沒有足夠的短間隔回覆",
      restartReplyLabel: restartReply === null ? "暫無" : formatDuration(restartReply),
      restartReplyMeta: state.restartReplyDelays.length
        ? `${state.restartReplyDelays.length.toLocaleString()} 次 30 分後重啟的中位數`
        : "目前還沒有足夠的重啟對話",
    },
    insights: {
      activeHours: buildActiveHoursInsight(state.heatmap),
      burstiness: buildBurstinessInsight(dailyEntries),
      stickiness: buildStickinessInsight(state.immediateReplyDelays.length, state.restartReplyDelays.length),
      restartFrequency: buildRestartFrequencyInsight(state.restartReplyDelays.length, spanDays),
      replyAsymmetry: buildReplyAsymmetryInsight(state.replySequence),
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
        count: state.replyBuckets[index],
      })),
      longestGapLabel: state.longestGap ? formatDuration(state.longestGap.duration) : "暫無",
      longestGapRange: state.longestGap
        ? `${formatShortDate(state.longestGap.from)} → ${formatShortDate(state.longestGap.to)}`
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
    messageMix: buildMessageMixPayload(participants, state.participants),
    calls: buildCallsPayload(state.calls),
    people: participants,
    topReactions: buildReactionPayload(state.reactionTypes, 10),
  };
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

  return {
    label: `${baseline} / ${peak}`,
    meta: `一般日 p50 ${baseline.toLocaleString()} 則，聊天很多的日子 p90 ${peak.toLocaleString()} 則`,
  };
}

function buildStickinessInsight(immediateCount, restartCount) {
  const total = immediateCount + restartCount;
  if (!total) {
    return {
      label: "暫無",
      meta: "目前還沒有足夠的輪流回覆資料",
    };
  }

  return {
    label: `${((immediateCount / total) * 100).toFixed(1)}%`,
    meta: `${immediateCount.toLocaleString()} / ${total.toLocaleString()} 次輪流回覆是在 30 分鐘內接上`,
  };
}

function buildRestartFrequencyInsight(restartCount, spanDays) {
  if (!restartCount || !spanDays) {
    return {
      label: restartCount ? "偏少" : "暫無",
      meta: restartCount ? `${restartCount.toLocaleString()} 次 30 分後重啟對話` : "目前還沒有足夠的重啟對話資料",
    };
  }

  const perWeek = (restartCount / Math.max(spanDays / 7, 1)).toFixed(1);
  return {
    label: `${perWeek} 次/週`,
    meta: `${restartCount.toLocaleString()} 次 30 分後重啟對話`,
  };
}

function buildReplyAsymmetryInsight(replySequence) {
  const participantCount = new Set(replySequence.map((entry) => entry.sender)).size;
  if (participantCount < 2) {
    return {
      label: "暫無",
      meta: "目前還沒有足夠的雙向回覆資料（只看 30 分鐘內的接話）",
      rows: [],
    };
  }

  const pairDelays = new Map();
  let previous = null;
  for (const { sender, timestamp } of replySequence) {
    if (previous && previous.sender !== sender) {
      const key = `${previous.sender}→${sender}`;
      if (!pairDelays.has(key)) {
        pairDelays.set(key, []);
      }
      const delay = timestamp - previous.timestamp;
      if (delay >= 0 && delay <= REPLY_ASYMMETRY_MAX_MS) {
        pairDelays.get(key).push(delay);
      }
    }
    previous = { sender, timestamp };
  }

  const directional = [...pairDelays.entries()]
    .map(([key, delays]) => ({
      key,
      count: delays.length,
      median: quantile(delays, 0.5),
    }))
    .filter((entry) => entry.median !== null)
    .sort((left, right) => right.count - left.count)
    .slice(0, 2);

  if (directional.length < 2) {
    return {
      label: directional[0] ? formatMetricDuration(directional[0].median) : "暫無",
      meta: directional[0]
        ? `${directional[0].key} 這個方向在 30 分鐘內的常見回覆速度`
        : "目前還沒有足夠的雙向回覆資料（只看 30 分鐘內的接話）",
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
    meta: "只看 30 分鐘內的接話，比較雙方平常回得多快",
    rows: directional.map((entry) => ({
      label: formatReplyDirectionLabel(entry.key),
      value: formatMetricDuration(entry.median),
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

function isPhoneCallEvent(message) {
  return message.action === "phone_call" || message.type === "phone_call";
}

function processPhoneCall(message, state, sender, timestamp) {
  state.calls.push({
    sender,
    timestamp,
    durationSeconds: extractCallDurationSeconds(message),
    outcome: getCallOutcomeLabel(message),
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

function addReplyDelay(state, delay) {
  const bucketIndex = REPLY_BUCKETS_MS.findIndex((limit) => delay < limit);
  const safeIndex = bucketIndex === -1 ? state.replyBuckets.length - 1 : bucketIndex;
  state.replyBuckets[safeIndex] += 1;
}

function updateHeavyTerms(heavyTerms, text) {
  const tokens = extractTermTokens(text);
  for (const token of tokens) {
    recordCount(heavyTerms, token);
  }
}

function updateParticipantLanguage(catchphraseStats, sender, text) {
  let person = catchphraseStats.get(sender);
  if (!person) {
    person = {
      words: new Map(),
      phrases: new Map(),
      messages: 0,
    };
    catchphraseStats.set(sender, person);
  }

  person.messages += 1;

  for (const token of extractTermTokens(text)) {
    recordCount(person.words, token);
  }

  for (const phrase of extractPhraseCandidates(text)) {
    recordCount(person.phrases, phrase);
  }
}

function extractTermTokens(text) {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[_~!！?？,，.。:：;；、/|()[\]{}"'`<>#%^&*+=\\\n\r\t-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.match(/[a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu) || [];
  const output = [];

  for (const token of tokens) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      output.push(...extractHanTermCandidates(token));
      continue;
    }

    if (!STOPWORDS.has(token)) {
      output.push(token);
    }
  }

  return output;
}

function extractPhraseCandidates(text) {
  const normalized = text
    .replace(/https?:\/\/\S+/g, " ")
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
    if (!candidate || candidate.length < 2 || candidate.length > 12) {
      continue;
    }
    if (/^\d+$/u.test(candidate) || PHRASE_STOPWORDS.has(candidate)) {
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
    .map(([name, stats]) => ({
      name,
      messageShare: totalMessages ? ((stats.messages / totalMessages) * 100).toFixed(1) : "0.0",
      topWords: [...stats.words.entries()]
        .map(([term, count]) => ({ term, count }))
        .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
        .slice(0, 8),
      topPhrases: [...stats.phrases.entries()]
        .filter(([, count]) => count >= 2)
        .map(([term, count]) => ({ term, count }))
        .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
        .slice(0, 6),
      messages: stats.messages,
    }))
    .sort((left, right) => right.messages - left.messages)
    .map(({ messages: _messages, ...person }) => person);
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

  for (const call of calls) {
    const date = new Date(call.timestamp);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const hour = date.getHours();
    const participant = byParticipant.get(call.sender) || { name: call.sender, count: 0, durationSeconds: 0 };

    participant.count += 1;
    participant.durationSeconds += call.durationSeconds;
    byParticipant.set(call.sender, participant);

    const month = byMonth.get(monthKey) || { label: monthKey, count: 0, durationSeconds: 0 };
    month.count += 1;
    month.durationSeconds += call.durationSeconds;
    byMonth.set(monthKey, month);

    byHour[hour].count += 1;
    outcomes.set(call.outcome, (outcomes.get(call.outcome) || 0) + 1);

    if (call.durationSeconds > 0) {
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
    totalDurationLabel: formatCallDuration(totalDurationSeconds),
    avgDurationLabel: formatCallDuration(connected ? Math.round(totalDurationSeconds / connected) : 0),
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
  const duration = Number(message.duration_seconds ?? message.duration ?? 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function getCallOutcomeLabel(message) {
  const reason = String(message.discard_reason || message.reason || "").toLowerCase();
  if (!reason) {
    return extractCallDurationSeconds(message) > 0 ? "已接通" : "未知結果";
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

  return `${names}（取前兩位）`;
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
