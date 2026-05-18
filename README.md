# HA Filament SpoolTracker

A Home Assistant add-on for tracking 3D printer filament spool usage with automatic Bambu Lab integration.

Home Assistant community thread:  
[HA Filament SpoolTracker – Filament & Print Job Tracker for Bambu Lab](https://community.home-assistant.io/t/add-on-ha-filament-spooltracker-filament-print-job-tracker-for-bambu-lab-octoprint-planned/994230)

## Features

- **Spool Management** -- Add, edit, archive, and delete filament spools with color, type, weight tracking, and remaining filament progress bars
- **Automatic Print Logging** -- Detects print jobs from Bambu Lab printers via the HA integration and auto-logs them with project name, thumbnail, and filament used
- **AMS Multi-Spool Tracking** -- Tracks Bambu Lab AMS trays independently, including active tray changes during multi-color prints
- **Live Filament Deduction** -- Deducts filament from the spool currently active in the printer while the print is running, with an optional completion-only mode
- **Usage Corrections & Audit Log** -- Correct per-spool usage, undo supported corrections, and inspect detailed spool weight history
- **Multi-Printer Support** -- Tracks multiple Bambu Lab printers, auto-discovered from Home Assistant
- **Dashboard** -- Overview of filament stock, active prints, current active AMS spool, deduction mode, depletion warnings, low filament warnings, and recent print history
- **Notifications** -- HA persistent notifications for low filament levels, unassigned AMS active trays, unassigned print jobs, expiring spools, and stale in-progress jobs
- **Maintenance Tools** -- Resync HA entities, commit pending usage rows, clear stale jobs, and backfill audit history from existing usage rows

### UI Preview

Dashboard:

![Dashboard](docs/Dashboard.png)

Spools:

![Spools](docs/Spools.png)

Printers:

![Printers](docs/Printers.png)

Print History:

![Print History](docs/Jobs.png)

Settings:

![Settings](docs/Settings.png)

## Prerequisites

- Home Assistant with the [Bambu Lab integration](https://github.com/greghesp/ha-bambulab) installed and configured
- At least one Bambu Lab printer connected to Home Assistant

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the **HA Filament SpoolTracker** add-on
3. Start the add-on -- it will appear in the sidebar as **SpoolTracker**

## Getting Started

### 1. Connect Your Printers

Open the **Settings** tab. The add-on automatically discovers Bambu Lab printers from your Home Assistant instance. Confirm the discovered printers or adjust entity IDs if needed.

### 2. Add Your Spools

Go to the **Spools** tab and click **Add Spool**. Enter the filament type, pick a color, and set the initial weight. The spool name is optional -- it auto-generates from the type and color if left blank.

### 3. Start Printing

When a print starts on a connected printer, the add-on automatically creates a print job record. For Bambu Lab AMS printers, the active tray is tracked as the printer changes colors, and filament is deducted from the matching spool for each tray.

If a tray cannot be matched to a spool, the dashboard shows a warning and Home Assistant can send a notification. Assign the tray from the **Dashboard** or **Printers** tab, then the next observed usage will be linked to that spool.

## How It Works

### Automatic Print Detection

The add-on subscribes to state changes from the Bambu Lab HA integration. When a print starts:

1. A print job record is created with the project name, thumbnail, and estimated filament usage
2. Printer and AMS tray entities are discovered or refreshed from Home Assistant
3. The active AMS tray is matched to the spool assigned to that tray
4. As progress and active-tray events arrive, per-slot usage is accumulated and saved
5. In live deduction mode, saved usage is immediately subtracted from each spool's `remainingWeight`
6. If no spool can be matched, dashboard and notification warnings prompt you to assign the active tray

### AMS and Multi-Color Prints

Each AMS tray is represented as a printer slot. Slots store tray metadata from Home Assistant, including tray label, filament type, color, tag UID, tray UUID, weight, and active/empty state.

For multi-color prints, the print job stores one usage row per tray/spool. The **Print History** view shows the per-spool usage split, and the **Dashboard** shows the currently active spool in the printer row. When the printer switches from one color to another, the dashboard switches to the new active tray's spool too.

### Filament Deduction Modes

The deduction mode is configured in **Settings -> Printers & Filament**:

| Mode | Behavior |
|------|----------|
| **Deduct during print** | Default. Each observed usage delta is immediately saved to the spool's remaining weight. This keeps the Spools view, Dashboard, and Home Assistant sensors current during long multi-color prints. |
| **Deduct on completion** | Usage is tracked during the print but only subtracted when the job finishes or pending rows are committed manually. |

The dashboard displays the active mode. In live mode, the stored `remainingWeight` is the source of truth; temporary live-only remaining values are only used when there are pending, not-yet-committed rows.

### Usage Corrections and Audit Log

Spool weight changes are written to an audit log. Open a spool detail page to view:

- The action that changed weight
- Before/after weight
- Delta in grams
- Related print job or usage row
- Metadata for synthetic or correction entries

From **Print History**, use **Correct** on a per-spool usage pill to adjust grams used or move usage to another spool. If that usage was already deducted, the app restores the old deduction and applies the corrected one. Supported correction audit entries can be undone from the spool detail page.

### Notifications

The add-on sends Home Assistant persistent notifications for:

- **Low filament** -- when a spool drops below the configured threshold (default: 100g)
- **Unassigned active AMS tray** -- when the printer is using an AMS tray that has no spool assigned in SpoolTracker
- **Unassigned print jobs** -- completed prints that couldn't be auto-matched to a spool
- **Expiring spools** -- filament approaching its expiration date
- **Stale in-progress jobs** -- jobs that appear stuck after printer state changes or restarts

Notification thresholds and individual notification types can be adjusted in the **Settings** tab.

### Dashboard and Printer Views

The dashboard printer row shows the spool from the active AMS tray first, falling back to the legacy loaded spool only when no active tray spool is known. During a print, this means the spool shown in the printer view follows the printer's current color/tray.

Active print cards also show estimated filament left to print. If the currently loaded spool has less remaining filament than the estimated remaining job usage, the card is highlighted.

The **Printers** page includes AMS slots, active/empty state, spool assignment, match suggestions, and a recent printer timeline.

### Maintenance

The **Settings -> Maintenance** tools provide operational fixes without shell access:

- **Resync entities** -- refresh printer entity IDs and AMS slots from Home Assistant
- **Commit pending rows** -- subtract tracked but not-yet-deducted usage from spools
- **Clear stale jobs** -- mark old in-progress jobs as failed
- **Backfill audit** -- create synthetic audit entries for existing deducted usage rows that predate the audit log

### Home Assistant sensors and automations

The add-on publishes state back into Home Assistant (needs a valid `SUPERVISOR_TOKEN` / long-lived token as today):

- **`sensor.spooltracker_active_spool_remaining_g`** — grams remaining on the active spool (existing).
- **`sensor.spooltracker_available_spools`** — count of non-archived spools; attributes `spools` and `printers` list IDs and names for use in templates (e.g. `state_attr`).

**API base URL for automations:** After each start, open **Settings → Add-ons → HA Filament SpoolTracker → Log**. In the **SpoolTracker endpoints** block, copy the line that ends with `/api` (host and port are set by Supervisor). Standalone Docker: use the same lines from the container logs and your published host/port if Home Assistant reaches the app over the LAN.

**Load a spool from an automation:** `POST` JSON to `{apiBase}/ha/set-active-spool` with `Content-Type: application/json` and body:

```json
{ "spoolId": "<spool-uuid>", "printerId": "<printer-uuid>" }
```

If you only have **one** printer registered in SpoolTracker, you may omit `printerId`. With multiple printers, `printerId` is required.

Configure this using Home Assistant’s **[RESTful Command](https://www.home-assistant.io/integrations/rest_command/)** integration (`rest_command` in `configuration.yaml`), then call `rest_command.your_command_name` from an automation. See [Using a REST command as an action in an automation](https://www.home-assistant.io/integrations/rest_command/#using-a-rest-command-as-an-action-in-an-automation).

### Spool Lifecycle

| State | Meaning |
|-------|---------|
| **Active** | Currently loaded in a printer |
| **Inactive** | In stock but not loaded |
| **Archived** | Empty or retired, hidden from the main view |

You can manually archive, reactivate, or deduct filament from any spool via the spool card menu.

## Running outside Hass.io (standalone Docker)

You can run the add-on in Docker on another machine and still connect it to your Home Assistant instance.

### 1. Create a Long-Lived Access Token in Home Assistant

In HA: **Profile → Security → Long-Lived Access Tokens** → Create token. Copy the token.

### 2. Build the image

```bash
pnpm addon:build
```

### 3. Run the container

Copy `.env.example` to `.env`, set `HOME_ASSISTANT_URL` and `SUPERVISOR_TOKEN`, then run:

```bash
docker compose up -d --build spooltracker
```

To stop:

```bash
docker compose down
```

Then open **http://localhost:3000** for the SpoolTracker UI. The add-on will use your token to talk to the WebSocket and REST APIs on the given HA URL.

Optional env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOME_ASSISTANT_URL` | (none) | HA base URL, e.g. `http://192.168.1.100:8123`. Required for HA integration. |
| `SUPERVISOR_TOKEN` | (none) | Long-Lived Access Token from HA. Required for HA integration. |
| `PORT` | `3000` | Port the app listens on. |
| `DATABASE_URL` | `file:/data/app.db` | SQLite path or PostgreSQL URL. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warning`, or `error`. |
| `SUPERVISOR_TOKEN_FILE` | (none) | Path to a file containing the token (e.g. mounted secret). Used when `SUPERVISOR_TOKEN` is not set. |

If the add-on and HA use different networks (e.g. Docker bridge vs host), ensure the host/port in `HOME_ASSISTANT_URL` is reachable from the container (e.g. use the host’s LAN IP, not `localhost`).

## Development

<details>
<summary>Developer setup instructions</summary>

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
pnpm install
cp server/config.example.env server/.env
pnpm prisma:generate
pnpm --filter @ha-addon/server db:push
pnpm dev
```

The client runs on `http://localhost:5173` and proxies API calls to the server on port `3001`.

### Build

```bash
pnpm addon:build
```

### Verification

```bash
pnpm --filter @ha-addon/server db:generate
pnpm --filter @ha-addon/types build
pnpm --filter @ha-addon/server type-check
pnpm --filter @ha-addon/client build
pnpm --filter @ha-addon/server test:deduction
```

</details>

## License

MIT
