const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createContext() {
  const progressEvents = [];
  const context = {
    console,
    Intl,
    Date,
    Map,
    Set,
    TextDecoder,
    self: {
      addEventListener() {},
      postMessage(message) {
        if (message.type === "progress") {
          progressEvents.push(message);
        }
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  const workerCode = fs.readFileSync(path.join(__dirname, "..", "public", "worker.js"), "utf8");
  vm.runInContext(workerCode, context);
  return { context, progressEvents };
}

function makeFile(name, exportData, type = "application/json") {
  const text = typeof exportData === "string" ? exportData : JSON.stringify(exportData);
  return {
    name,
    type,
    size: Buffer.byteLength(text),
    stream() {
      return new Blob([text], { type }).stream();
    },
  };
}

function chat(options = {}) {
  const {
    id = 42,
    name = "Test Chat",
    type = "personal_chat",
    messages = [],
  } = options;
  const output = { name, type };
  output.id = id;
  output.messages = messages;
  return output;
}

function msg(id, date, from, text = "hello", extra = {}) {
  return {
    id,
    type: "message",
    date,
    from,
    from_id: `user${from}`,
    text,
    ...extra,
  };
}

async function analyze(files) {
  const { context } = createContext();
  return context.analyzeFiles(files, { customDictionary: ["ChatGPT"] });
}

(async () => {
  {
    const payload = await analyze([
      makeFile("one.json", chat({ messages: [msg(1, "2026-01-01T00:00:00", "A", "ChatGPT hi")] })),
    ]);
    assert.equal(payload.mergeMeta.fileCount, 1);
    assert.equal(payload.mergeMeta.duplicateMessageCount, 0);
    assert.equal(payload.summary.totalMessages, 1);
  }

  {
    const files = [
      makeFile("a.json", chat({ id: 7, messages: [msg(1, "2026-01-01T00:00:00", "A")] })),
      makeFile("b.json", chat({ id: 7, messages: [msg(2, "2026-01-01T00:01:00", "B")] })),
      makeFile("c.json", chat({ id: 7, messages: [msg(3, "2026-01-01T00:02:00", "A")] })),
    ];
    const payload = await analyze(files);
    assert.equal(payload.mergeMeta.fileCount, 3);
    assert.equal(payload.mergeMeta.uniqueMessageCount, 3);
    assert.equal(payload.summary.totalMessages, 3);
  }

  {
    await assert.rejects(
      analyze([
        makeFile("a.json", chat({ id: 1, name: "Same", messages: [msg(1, "2026-01-01T00:00:00", "A")] })),
        makeFile("b.json", chat({ id: 2, name: "Same", messages: [msg(2, "2026-01-01T00:01:00", "B")] })),
      ]),
      /不同對話/,
    );
  }

  {
    const payload = await analyze([
      makeFile("a.json", chat({ id: null, name: "No Id", type: "private_group", messages: [msg(1, "2026-01-01T00:00:00", "A")] })),
      makeFile("b.json", chat({ id: null, name: "No Id", type: "private_group", messages: [msg(2, "2026-01-01T00:01:00", "B")] })),
    ]);
    assert.equal(payload.mergeMeta.chatIdentityConfidence, "inferred");
    assert.equal(payload.summary.totalMessages, 2);
  }

  {
    await assert.rejects(
      analyze([
        makeFile("a.json", chat({ id: null, name: "A Chat", messages: [msg(1, "2026-01-01T00:00:00", "A")] })),
        makeFile("b.json", chat({ id: null, name: "B Chat", messages: [msg(2, "2026-01-01T00:01:00", "B")] })),
      ]),
      /不同對話/,
    );
  }

  {
    const payload = await analyze([
      makeFile("a.json", chat({ messages: [msg(1, "2026-01-01T00:00:00", "A", "ChatGPT"), msg(2, "2026-01-01T00:01:00", "B", "hi")] })),
      makeFile("b.json", chat({ messages: [msg(1, "2026-01-01T00:00:00", "A", "ChatGPT"), msg(3, "2026-01-01T00:02:00", "A", "photo", { photo: "photos/1.jpg" })] })),
    ]);
    assert.equal(payload.mergeMeta.rawMessageCount, 4);
    assert.equal(payload.mergeMeta.duplicateMessageCount, 1);
    assert.equal(payload.mergeMeta.uniqueMessageCount, 3);
    assert.equal(payload.summary.totalMessages, 3);
    assert.equal(payload.topTerms.find((entry) => entry.term === "ChatGPT")?.count, 1);
  }

  {
    const first = msg(undefined, "2026-01-01T00:00:00", "A", "same text");
    const duplicate = msg(undefined, "2026-01-01T00:00:00", "A", "same   text");
    const payload = await analyze([
      makeFile("a.json", chat({ messages: [first] })),
      makeFile("b.json", chat({ messages: [duplicate] })),
    ]);
    assert.equal(payload.mergeMeta.duplicateMessageCount, 1);
    assert.equal(payload.summary.totalMessages, 1);
  }

  {
    const payload = await analyze([
      makeFile("later.json", chat({ messages: [msg(2, "2026-01-01T00:10:00", "B", "later")] })),
      makeFile("earlier.json", chat({ messages: [msg(1, "2026-01-01T00:00:00", "A", "earlier")] })),
    ]);
    assert.equal(payload.sessionMetricsByThreshold["1800000"].turnSwitchCount, 1);
    assert.equal(payload.sessionMetricsByThreshold["1800000"].directionalReplies[0].key, "A→B");
  }

  {
    const call = { id: 9, type: "phone_call", date: "2026-01-01T00:00:00", actor: "A", duration_seconds: 60 };
    const reacted = msg(10, "2026-01-01T00:01:00", "B", "ChatGPT", {
      reactions: [{ type: "emoji", emoji: "👍", count: 2 }],
    });
    const payload = await analyze([
      makeFile("a.json", chat({ messages: [call, reacted] })),
      makeFile("b.json", chat({ messages: [call, reacted] })),
    ]);
    assert.equal(payload.calls.total, 1);
    assert.equal(payload.summary.totalReactionCount, 2);
    assert.equal(payload.topTerms.find((entry) => entry.term === "ChatGPT")?.count, 1);
  }

  await assert.rejects(
    analyze([makeFile("bad.json", "{ nope")]),
    /找不到 messages|JSON|截斷|不完整/,
  );

  await assert.rejects(
    analyze([makeFile("missing.json", { id: 1, name: "No messages" })]),
    /找不到 messages/,
  );

  console.log("worker multifile tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
