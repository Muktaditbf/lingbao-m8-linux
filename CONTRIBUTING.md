# Contributing

Thanks for helping! This project is small on purpose: one HTML page, one protocol file, no build step.

## Ways to help

- **Report a bug.** Use the bug report template, and include your connection (cable or 2.4 GHz), browser and the exact message the app showed.
- **Report a device.** If you have another mouse that shows up as `YXT` or uses USB vendor ID `b6a4`, open a device report with its `lsusb` line. That tells us whether the protocol can be shared.
- **Decode something new.** Button mapping, macros, lighting and Bluetooth are still open; see [docs/PROTOCOL.md](docs/PROTOCOL.md) for what's known.

## Making changes

1. Fork and clone the repo, then run `npm install`.
2. Keep the protocol in `lbm8.js` and the interface in `index.html`.
3. Run the tests:
   ```bash
   npm test          # protocol unit tests
   npm run test:ui   # browser test with a simulated mouse
   ```
   If you have an LB-M8, also run `npm run test:hardware`. It restores your settings when it finishes.
4. Open a pull request that explains what changed and how you tested it.

## Rules for anything that writes to the mouse

- Only send values the official app can send. Validate them in `lbm8.js` before anything leaves the page.
- Read every written value back and show an error if the mouse didn't keep it.
- Keep unknown bits and bytes exactly as the mouse reported them.
- Add a unit test with real bytes from a mouse for every new command.
- Never commit vendor binaries, extracted vendor files or copied vendor code. Describe findings in your own words in `docs/PROTOCOL.md`.

By contributing you agree that your contributions are licensed under the MIT License, and that you'll follow the [Code of Conduct](CODE_OF_CONDUCT.md).
