# Contributing

Issues and pull requests are welcome. Please include the app version, printer model, and steps to reproduce bugs. Remove printer serials, LAN access codes, RFID values, and other private data from logs and screenshots before sharing them.

## Development setup

- Node.js 22.22.2 or newer
- pnpm 12.16.1 (pinned in `package.json`)

```bash
pnpm install
pnpm --filter @ha-addon/server db:generate
pnpm build
```

Run `pnpm audit` after dependency changes. The workspace uses a lockfile, delayed release adoption, and version-pinned install-script approvals. Do not bypass these controls or approve every dependency's scripts. Review the package source and its install script before changing `allowBuilds` or `allowScripts`.

For UI changes, update the matching README screenshot in `docs/` and make sure the screenshot contains only synthetic or sanitized sample data.
