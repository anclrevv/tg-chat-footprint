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
