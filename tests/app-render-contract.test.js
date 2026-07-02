const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class MockClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) {
      this.values.add(name);
    }
  }

  remove(...names) {
    for (const name of names) {
      this.values.delete(name);
    }
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
    return enabled;
  }
}

class MockElement {
  constructor(id = "") {
    this.id = id;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.dataset = {};
    this.attributes = {};
    this.classList = new MockClassList();
    this.children = [];
    this.style = {};
  }

  addEventListener() {}
  focus() {}
  scrollIntoView() {}

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector() {
    return new MockElement();
  }

  querySelectorAll() {
    return [];
  }
}

class MockTemplate extends MockElement {
  constructor(id) {
    super(id);
    this.content = {
      cloneNode: () => ({
        querySelector: () => new MockElement(),
      }),
    };
  }
}

function createContext() {
  const elements = new Map();
  const errorLogs = [];
  const ids = [
    "file-input",
    "dropzone",
    "dashboard",
    "dashboard-empty",
    "status-text",
    "progress-fill",
    "progress-text",
    "file-meta",
    "file-name",
    "file-size",
    "conversation-summary",
    "clear-analysis",
    "reselect-file",
    "analysis-live",
    "conversation-mode-badge",
    "session-threshold-select",
    "trend-topn-select",
    "precision-badge",
    "tokenizer-badge",
    "custom-dictionary",
    "apply-dictionary",
    "clear-dictionary",
    "summary-grid",
    "insights-grid",
    "timeline-chart",
    "daily-timeline-controls",
    "daily-timeline-chart",
    "heatmap-chart",
    "reply-chart",
    "days-table",
    "terms-cloud",
    "phrases-panel",
    "message-mix-panel",
    "calls-panel",
    "signals-panel",
    "reactions-panel",
    "people-table",
    "reply-info-button",
    "reply-info",
    "chart-tooltip",
    "sidebar",
    "sidebar-overlay",
    "nav-toggle",
    "guide-dialog",
    "guide-open",
    "guide-open-secondary",
    "guide-close",
    "guide-jump",
  ];

  for (const id of ids) {
    elements.set(id, new MockElement(id));
  }
  elements.set("summary-card-template", new MockTemplate("summary-card-template"));

  const document = {
    body: new MockElement("body"),
    activeElement: null,
    addEventListener() {},
    querySelector(selector) {
      if (selector.startsWith("#")) {
        return elements.get(selector.slice(1)) || new MockElement(selector.slice(1));
      }
      return new MockElement();
    },
    querySelectorAll(selector) {
      if (selector === "[data-section-link]" || selector === "[data-section]") {
        return [];
      }
      return [];
    },
  };

  const context = {
    console: {
      ...console,
      error: (...args) => errorLogs.push(args),
    },
    document,
    localStorage: {
      getItem: () => "",
      setItem() {},
      removeItem() {},
    },
    window: {
      matchMedia: () => ({ matches: true }),
    },
    Worker: function Worker() {},
    IntersectionObserver: class {
      observe() {}
    },
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.createContext(context);
  const appCode = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  vm.runInContext(appCode, context);
  return { context, elements, document, errorLogs };
}

function basePayload(mode = "direct") {
  const people =
    mode === "single"
      ? [{ name: "A", messages: 2, characters: 5, avgChars: 2.5 }]
      : mode === "group"
        ? [
            { name: "A", messages: 3, characters: 5, avgChars: 1.7 },
            { name: "B", messages: 2, characters: 4, avgChars: 2 },
            { name: "C", messages: 1, characters: 3, avgChars: 3 },
          ]
        : [
            { name: "A", messages: 2, characters: 5, avgChars: 2.5 },
            { name: "B", messages: 2, characters: 4, avgChars: 2 },
          ];
  const participantCount = people.length;
  const metrics = {
    threshold: 1800000,
    thresholdLabel: "30 分鐘",
    quickReplyThreshold: 1800000,
    quickReplyThresholdLabel: "30 分鐘",
    restartCount: 0,
    turnSwitchCount: 1,
    quickReplyCount: 1,
    replyBuckets: [1, 0, 0, 0, 0, 0, 0, 0],
    precision: { replyMedian: "exact" },
  };
  return {
    conversationMode: mode,
    participantCount,
    telegramChatType: "personal_chat",
    participants: people.map((person) => person.name),
    selectedSessionThreshold: 1800000,
    sessionThresholdOptions: [{ value: 1800000, label: "30 分鐘" }],
    sessionMetricsByThreshold: { 1800000: metrics },
    groupMetrics: {
      activeParticipantCount: participantCount,
      medianMessagesPerParticipant: 2,
      topThreeShareLabel: "100.0%",
      concentrationLabel: "低集中：多人平均參與",
    },
    analysisPrecision: { replyMedian: "exact" },
    wordAnalysisMeta: { tokenizer: "fallback", customDictionaryCount: 0 },
    presentationLimits: { trendTopNDefault: 8 },
    summary: {
      totalMessages: 4,
      textMessages: 4,
      activeDays: 1,
      participantCount,
      spanDays: 1,
      rangeLabel: "1 天",
      activeDensityLabel: "100.0%",
      activeDensityMeta: "1 / 1 天有對話",
      balanceLabel: "平均",
      balanceMeta: "測試",
      immediateReplyLabel: "1 分鐘",
      immediateReplyMeta: "1 次 30 分鐘內接話",
      restartReplyLabel: "暫無",
      restartReplyMeta: "目前還沒有足夠的重啟對話",
      editedMessages: 0,
      forwardedMessages: 0,
      linkedMessages: 0,
      reactedMessages: 0,
      totalReactionCount: 0,
    },
    insights: {},
    timeline: [{ label: "2026-01", total: 4, byParticipant: { A: 2, B: 2 } }],
    dailyTimeline: [{ label: "2026-01-01", total: 4, byParticipant: { A: 2, B: 2 } }],
    heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
    topDays: [{ date: "2026-01-01", weekday: "週四", total: 4, byParticipant: { A: 2, B: 2 } }],
    topTerms: [{ term: "hello", count: 2 }],
    catchphrases: [],
    messageMix: [],
    calls: { total: 0 },
    people,
    participantDisplay: { total: participantCount, timelineLimit: 8 },
    topReactions: [],
  };
}

function assertCanComplete(payload, label) {
  const { context, elements, document } = createContext();
  context.completeAnalysis(payload);
  assert.equal(document.body.dataset.analysisState, "complete", `${label} should enter success state`);
  assert.equal(elements.get("dashboard").hidden, false, `${label} should show dashboard`);
  assert.equal(elements.get("status-text").textContent, "分析完成，可以開始看內容了");
}

assertCanComplete(basePayload("direct"), "direct payload");
assertCanComplete(basePayload("group"), "group payload");
assertCanComplete(basePayload("single"), "single payload");

assertCanComplete({ ...basePayload("group"), groupMetrics: undefined }, "missing groupMetrics");
assertCanComplete({ ...basePayload("direct"), calls: undefined }, "missing calls");
assertCanComplete({ ...basePayload("direct"), wordAnalysisMeta: undefined }, "missing wordAnalysisMeta");
assertCanComplete({ ...basePayload("direct"), selectedSessionThreshold: 999 }, "missing selected threshold key");
assertCanComplete({ ...basePayload("direct"), people: [] }, "empty people");
assertCanComplete(
  {
    ...basePayload("direct"),
    catchphrases: [
      {
        name: "A",
        messageShare: "50.0",
        topWords: [{ term: "hello", count: 2 }],
        topPhrases: [{ term: "我覺得先保守一點", totalCount: 7, messageCount: 3, activeDayCount: 2 }],
      },
    ],
  },
  "top phrase entries with messageCount but no count",
);

{
  const { context } = createContext();
  const normalized = context.normalizeAnalysisResult({ ...basePayload("direct"), selectedSessionThreshold: 999 });
  assert.equal(context.selectSessionMetrics(normalized.sessionMetricsByThreshold, 999).threshold, 1800000);
}

{
  const { context, elements } = createContext();
  const payload = context.normalizeAnalysisResult({
    ...basePayload("direct"),
    catchphrases: [
      {
        name: "A",
        messageShare: "50.0",
        topWords: [{ term: "hello", count: 1234 }],
        topPhrases: [
          { term: "新版欄位", totalCount: 9, messageCount: 4, activeDayCount: 3 },
          { term: "空值欄位", totalCount: null, messageCount: null, activeDayCount: null },
        ],
      },
    ],
  });
  assert.equal(payload.catchphrases[0].topPhrases[0].count, 4);
  assert.equal(payload.catchphrases[0].topPhrases[0].totalCount, 9);
  assert.equal(payload.catchphrases[0].topPhrases[1].count, 0);
  context.renderCatchphrases(payload.catchphrases);
  const html = elements.get("phrases-panel").innerHTML;
  assert.match(html, /新版欄位/);
  assert.ok(html.includes("<strong>4</strong>"), "messageCount should be rendered, not mistaken for 0");
  assert.match(html, /1,234|1234/, "normal numeric counts should still render");
}

{
  const { context, elements, document, errorLogs } = createContext();
  context.renderDashboard = () => {
    throw new TypeError("synthetic render failure");
  };
  context.completeAnalysis(basePayload("direct"));
  assert.equal(document.body.dataset.analysisState, "idle");
  assert.match(elements.get("status-text").textContent, /顯示結果時發生錯誤/);
  assert.notEqual(elements.get("status-text").textContent, "分析完成，可以開始看內容了");
  assert.equal(errorLogs.length, 1, "render failures should be diagnosed once");
}

console.log("app render contract tests passed");
