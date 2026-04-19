# Klog – Raycast Extension

Track your time with [klog](https://klog.jotaen.net/) directly from Raycast. Start, stop, and manage time tracking entries without leaving your keyboard.

## Commands

| Command | Description | Example |
|---|---|---|
| **Start Tracking** | Start a new time tracking entry | `Task name #tag` + `personal` |
| **Stop Tracking** | Stop the current open time range | `personal` |
| **Edit Bookmark** | Open a bookmark file in your editor | `personal` |

### Start Tracking

Quickly start tracking time by typing a task summary and a bookmark name. Supports klog's tag syntax (`#tag`).

```
klog start -s "Task name #tag" @bookmark
```

### Stop Tracking

Close the currently open time range for a bookmark.

```
klog stop @bookmark
```

### Edit Bookmark

Open the klog file associated with a bookmark in your configured `$EDITOR`.

```
klog edit @bookmark
```

## Setup

### Prerequisites

- [klog](https://klog.jotaen.net/) installed on your system
- At least one klog bookmark configured (`klog bookmarks set <name> <path/to/file.klg>`)

### Configuration

| Preference | Description | Default |
|---|---|---|
| **klog Path** | Absolute path to the klog binary | `klog` |

> **Note:** Raycast runs with a limited `$PATH`. If klog isn't found, set the full path in the extension preferences (e.g., `/opt/homebrew/bin/klog`).

## Development

```bash
# Install dependencies
npm install

# Start development (hot-reload in Raycast)
npm run dev

# Build
npm run build

# Lint
npm run lint
```

## Roadmap

- [ ] Reporting (`klog total`, `klog report`)
- [ ] List current open ranges
- [ ] List tags and bookmarks
- [ ] Autocomplete for tags and bookmarks
