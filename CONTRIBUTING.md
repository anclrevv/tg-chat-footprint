# Contributing

Thank you for helping improve TG Chat Footprint.

## Workflow

1. Fork the repository.
2. Create a feature branch.
3. Run `npm install`.
4. Start local development with `npm run dev`.
5. Run `npm run test`.
6. Run `npm run check`.
7. Open a pull request with a clear summary.

## Privacy Rules

- Do not commit private Telegram exports.
- Do not attach real `result.json` files to issues or pull requests.
- Fixtures must be synthetic and anonymous.
- Do not add chat telemetry, analytics, tracking, or remote error reporting.
- Do not add APIs that upload, store, or process chat content outside the browser.

## Analysis Changes

Changes to analysis algorithms should include tests and a short explanation of the metric definition, edge cases, and expected behavior.

## Commit Style

Use concise commit messages such as:

- `feat: add responsive dashboard section`
- `fix: handle empty reaction payload`
- `docs: clarify Cloudflare deployment`
