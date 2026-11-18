# Trafficity Game Keybindings & Input System

Extracted from `dist/Router.520f1c86.js` inside `resources/app.asar`.

## Configurable Actions (`KEY_BINDING_ACTIONS` & `DEFAULT_KEY_BINDINGS`)

| Action | Default `key` token | Notes |
| --- | --- | --- |
| `panUp` | `"w"` | Held state tracked in `t.keysPressed` |
| `panDown` | `"s"` | Held state tracked in `t.keysPressed` |
| `panLeft` | `"a"` | Held state tracked in `t.keysPressed` |
| `panRight` | `"d"` | Held state tracked in `t.keysPressed` |
| `zoomIn` | `"x"` | |
| `zoomOut` | `"z"` | |
| `toggleCurveMode` | `"e"` | |
| `elevationUp` | `"r"` | |
| `elevationDown` | `"f"` | |
| `togglePause` | `" "` | Spacebar |
| `speedNormal` | `"1"` | Also matches `e.code === "Digit1"` |
| `speedFast` | `"2"` | Also matches `e.code === "Digit2"` |
| `disableSnapping` | `"shift"` | Held state tracked in `t.keysPressed` |

## Hardcoded Keys (`handleKeyDown` / `Router.js`)

| Key / Combo | Behavior |
| --- | --- |
| `Escape` | Cancel / close / deselect (`"Escape" === e.key`) |
| `Ctrl+Z` / `Cmd+Z` (`eK(e)`) | Undo (`undoLastPlayerAction`) |
| `i` | Debug: log nearest `VoronoiCorner` |
| `.` | Debug: lane creation / delete highlight / resident car dump |
| `l` | Debug: log route node neighbours |
| `n` | Debug: log reachable lane span tree |
| `j` | Debug: set `pathFindingStartPoint` |
| `b` | Debug: road placement debug (in road placement mode) |
| `Ctrl+Shift+J` x5 (within 1500 ms) | Open Chromium DevTools (`electron/main.js`) |

## How Trafficity Matches Keys

- `s(e) = e.key.toLowerCase()`
- `eventMatchesBindingKey(e, token)`:
  ```js
  e.key.toLowerCase() === token || (/^[0-9]$/.test(token) && e.code === `Digit${token}`)
  ```
- `hasBlockingModifier(e)`:
  ```js
  const t = e.key.toLowerCase();
  return (e.ctrlKey && t !== "control") || (e.metaKey && t !== "meta") || (e.altKey && t !== "alt");
  ```
- Held keys (`panUp`, `panDown`, `panLeft`, `panRight`, `disableSnapping`) are stored in `t.keysPressed` (`Set<string>`):
  - `keydown`: `t.keysPressed.add(e.key.toLowerCase())`
  - `keyup`: `t.keysPressed.delete(e.key.toLowerCase())`
  - `blur`: clears `t.keysPressed`
- **Important:** Trafficity does **not** use `event.code` for any action except `0–9` digits; everything else matches `event.key.toLowerCase()`.
