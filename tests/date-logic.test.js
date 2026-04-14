const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const workerPath = path.join(__dirname, "..", "worker.js");
const workerCode = fs.readFileSync(workerPath, "utf8");
const context = {
  console,
  TextDecoder,
  self: {
    addEventListener() {},
    postMessage() {},
  },
};

vm.createContext(context);
vm.runInContext(workerCode, context);

function timestamp(value) {
  return Date.parse(value);
}

assert.equal(
  context.calculateSpanDays(
    timestamp("2025-12-24T00:01:00"),
    timestamp("2025-12-24T23:59:00"),
  ),
  1,
  "same-day spans should count as one calendar day",
);

assert.equal(
  context.calculateSpanDays(
    timestamp("2025-12-24T22:33:00"),
    timestamp("2025-12-26T09:00:00"),
  ),
  3,
  "spans should count inclusive local calendar days, not elapsed 24-hour periods",
);

assert.equal(
  context.calculateSpanDays(
    timestamp("2025-12-31T23:59:00"),
    timestamp("2026-01-01T00:01:00"),
  ),
  2,
  "adjacent dates across a year boundary should count both calendar days",
);

assert.equal(
  context.calculateSpanDays(
    timestamp("2024-02-28T12:00:00"),
    timestamp("2024-03-01T12:00:00"),
  ),
  3,
  "leap-day ranges should include February 29",
);

assert.equal(context.formatWeekday("2025-12-22"), "週一");
assert.equal(context.formatWeekday("2025-12-28"), "週日");
assert.equal(
  context.formatLocalDate(new Date(timestamp("2025-12-24T22:33:00"))),
  "2025-12-24",
);
assert.equal(
  context.buildRangeLabel(
    timestamp("2025-12-24T22:33:00"),
    timestamp("2025-12-26T09:00:00"),
  ),
  "3 天",
);

const state = context.createState();
context.processMessageObject(
  { type: "message", date: "2025-12-24T22:33:00", from: "A", text: "hi" },
  state,
);
context.processMessageObject(
  { type: "message", date: "2025-12-26T09:00:00", from: "B", text: "yo" },
  state,
);

context.finalizeState(state);
const payload = context.buildPayload(state);
assert.equal(payload.summary.activeDays, 2);
assert.equal(payload.summary.spanDays, 3);
assert.equal(payload.summary.rangeLabel, "3 天");
assert.equal(payload.summary.activeDensityLabel, "66.7%");
assert.deepEqual(
  Array.from(payload.dailyTimeline, (entry) => entry.label),
  ["2025-12-24", "2025-12-26"],
);

console.log("date logic tests passed");

// --- Adaptive threshold tests ---

// With fewer than 10 gaps, fallback to 30 minutes
assert.equal(
  context.computeSessionThreshold([1000, 2000, 3000]),
  30 * 60_000,
  "fewer than 10 gaps should fallback to 30 minutes",
);

// With enough gaps, threshold = clamp(p75 * 3, 10min, 24h)
const manyGaps = [];
for (let i = 0; i < 100; i += 1) {
  manyGaps.push(i * 60_000); // 0min, 1min, 2min, ... 99min
}
// quantile(100 values, 0.75): index = floor(99 * 0.75) = 74, value = 74 min, * 3 = 222 min
const computed = context.computeSessionThreshold(manyGaps);
assert.equal(computed, 74 * 60_000 * 3, "should use p75 * 3 for threshold via quantile()");

// Threshold floors at 10 minutes
const tinyGaps = Array.from({ length: 20 }, (_, i) => (i + 1) * 1000); // 1s-20s
assert.equal(
  context.computeSessionThreshold(tinyGaps),
  10 * 60_000,
  "should clamp to 10 minute minimum",
);

// Threshold caps at 24 hours
const hugeGaps = Array.from({ length: 20 }, (_, i) => (i + 1) * 3_600_000); // 1h-20h
// p75 of [1..20] hours = 15h, * 3 = 45h → capped at 24h
assert.equal(
  context.computeSessionThreshold(hugeGaps),
  24 * 60 * 60_000,
  "should clamp to 24 hour maximum",
);

console.log("adaptive threshold tests passed");

// --- Session + initiative tests ---

const sessionState = context.createState();
// Session 1: A starts, B replies quickly
context.processMessageObject(
  { type: "message", date: "2025-12-24T10:00:00", from: "A", text: "hey" },
  sessionState,
);
context.processMessageObject(
  { type: "message", date: "2025-12-24T10:01:00", from: "B", text: "hi" },
  sessionState,
);
context.processMessageObject(
  { type: "message", date: "2025-12-24T10:02:00", from: "A", text: "how are you" },
  sessionState,
);
// Long gap -> Session 2: B starts
context.processMessageObject(
  { type: "message", date: "2025-12-24T15:00:00", from: "B", text: "back" },
  sessionState,
);
context.processMessageObject(
  { type: "message", date: "2025-12-24T15:01:00", from: "A", text: "ok" },
  sessionState,
);
// Long gap -> Session 3: A starts
context.processMessageObject(
  { type: "message", date: "2025-12-25T09:00:00", from: "A", text: "morning" },
  sessionState,
);
context.processMessageObject(
  { type: "message", date: "2025-12-25T09:01:00", from: "B", text: "morning" },
  sessionState,
);

context.finalizeState(sessionState);

// With only 6 adjacent message gaps (< 10), threshold falls back to 30 min
assert.equal(sessionState.sessionThreshold, 30 * 60_000, "should fallback with few delays");
assert.equal(sessionState.sessions.length, 3, "should detect 3 sessions");
assert.equal(sessionState.sessions[0].initiator, "A", "session 1 initiated by A");
assert.equal(sessionState.sessions[1].initiator, "B", "session 2 initiated by B");
assert.equal(sessionState.sessions[2].initiator, "A", "session 3 initiated by A");
assert.equal(sessionState.sessions[0].messageCount, 3, "session 1 has 3 messages");
assert.equal(sessionState.sessions[1].messageCount, 2, "session 2 has 2 messages");

const sessionPayload = context.buildPayload(sessionState);
// 3 sessions, but initiative skips the first (data start), leaving 2 restarts → too few
assert.equal(sessionPayload.insights.initiative.label, "暫無", "2 restarts is below threshold of 3");

// Also verify quickReplyThreshold is separate from sessionThreshold
assert.ok(
  sessionState.quickReplyThreshold <= sessionState.sessionThreshold,
  "quickReplyThreshold should not exceed sessionThreshold",
);
assert.ok(
  sessionState.quickReplyThreshold <= 60 * 60_000,
  "quickReplyThreshold should be capped at 1 hour",
);

// Test initiative with enough sessions (need 4+ sessions so restarts >= 3 after skipping first)
const initiativeState = context.createState();
const sessions = [
  { time: "2025-12-01T10:00:00", from: "A" },
  { time: "2025-12-01T10:01:00", from: "B" },
  { time: "2025-12-01T15:00:00", from: "A" }, // session 2: A starts
  { time: "2025-12-01T15:01:00", from: "B" },
  { time: "2025-12-02T09:00:00", from: "B" }, // session 3: B starts
  { time: "2025-12-02T09:01:00", from: "A" },
  { time: "2025-12-02T15:00:00", from: "A" }, // session 4: A starts
  { time: "2025-12-02T15:01:00", from: "B" },
  { time: "2025-12-03T09:00:00", from: "A" }, // session 5: A starts
  { time: "2025-12-03T09:01:00", from: "B" },
];
for (const msg of sessions) {
  context.processMessageObject(
    { type: "message", date: msg.time, from: msg.from, text: "x" },
    initiativeState,
  );
}
context.finalizeState(initiativeState);
const initiativePayload = context.buildPayload(initiativeState);
// 5 sessions, 4 restarts (skip first); A starts 3, B starts 1
assert.equal(initiativePayload.insights.initiative.label, "A", "A should be top initiator");
assert.ok(
  initiativePayload.insights.initiative.meta.includes("4 次重啟對話"),
  "initiative meta should mention 4 restarts",
);

const sameSenderRestartState = context.createState();
context.processMessageObject(
  { type: "message", date: "2025-12-04T10:00:00", from: "A", text: "first" },
  sameSenderRestartState,
);
context.processMessageObject(
  { type: "message", date: "2025-12-04T15:00:00", from: "A", text: "still me" },
  sameSenderRestartState,
);
context.processMessageObject(
  { type: "message", date: "2025-12-04T15:01:00", from: "B", text: "reply" },
  sameSenderRestartState,
);
context.finalizeState(sameSenderRestartState);
const sameSenderRestartPayload = context.buildPayload(sameSenderRestartState);
assert.equal(
  sameSenderRestartState.sessionRestartIntervals.length,
  1,
  "same-sender silence breaks should count as session restarts",
);
assert.equal(
  sameSenderRestartPayload.summary.restartReplyLabel,
  "5 小時",
  "restart interval should use session gaps, not only turn-switch gaps",
);

console.log("session + initiative tests passed");

// --- Burstiness ratio tests ---

const burstResult1 = context.buildBurstinessInsight([
  { total: 10 }, { total: 12 }, { total: 11 }, { total: 13 },
  { total: 10 }, { total: 11 }, { total: 12 }, { total: 10 },
  { total: 11 }, { total: 12 },
]);
assert.equal(burstResult1.label, "幾乎固定，差 1.1 倍", "low variance should show descriptor and ratio");
assert.ok(burstResult1.meta.includes("平常日"), "meta should include baseline context");

const burstResult2 = context.buildBurstinessInsight([
  { total: 5 }, { total: 5 }, { total: 5 }, { total: 5 }, { total: 5 },
  { total: 5 }, { total: 5 }, { total: 5 }, { total: 5 }, { total: 5 },
  { total: 5 }, { total: 5 }, { total: 5 }, { total: 5 }, { total: 5 },
  { total: 5 }, { total: 5 }, { total: 200 }, { total: 200 }, { total: 200 },
]);
assert.equal(burstResult2.label, "落差明顯，差 40.0 倍", "high spike should show descriptor and ratio");

console.log("burstiness ratio tests passed");

// --- formatThresholdLabel tests ---

assert.equal(context.formatThresholdLabel(10 * 60_000), "10 分鐘");
assert.equal(context.formatThresholdLabel(30 * 60_000), "30 分鐘");
assert.equal(context.formatThresholdLabel(60 * 60_000), "1 小時");
assert.equal(context.formatThresholdLabel(90 * 60_000), "1.5 小時");
assert.equal(context.formatThresholdLabel(24 * 60 * 60_000), "24 小時");

console.log("formatThresholdLabel tests passed");

// --- Large group payload cap tests ---

const largeGroupState = context.createState();
for (let personIndex = 0; personIndex < 100; personIndex += 1) {
  const messageCount = 100 - personIndex;
  for (let messageIndex = 0; messageIndex < messageCount; messageIndex += 1) {
    context.processMessageObject(
      {
        type: "message",
        date: `2025-12-${String((messageIndex % 28) + 1).padStart(2, "0")}T10:00:00`,
        from: `Person ${personIndex}`,
        text: `message ${messageIndex}`,
      },
      largeGroupState,
    );
  }
}
context.finalizeState(largeGroupState);
const largeGroupPayload = context.buildPayload(largeGroupState);

assert.equal(largeGroupPayload.summary.participantCount, 100);
assert.equal(largeGroupPayload.participants.length, 9, "charts should use top 8 participants plus Others");
assert.equal(largeGroupPayload.participants.at(-1), "其他");
assert.equal(largeGroupPayload.people.length, 80, "people table should be capped for large groups");
assert.ok(
  largeGroupPayload.dailyTimeline.some((entry) => entry.byParticipant["其他"] > 0),
  "daily timeline should aggregate non-top participants into Others",
);
assert.equal(largeGroupPayload.messageMix.length, 24, "message mix should be capped to top language participants");

console.log("large group payload cap tests passed");
