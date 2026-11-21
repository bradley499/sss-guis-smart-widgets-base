# SSS GUIS: Smart Widgets Base

## Purpose

This package gives you the browser base code for smart widgets that use [`@sss/sss-guis`](https://github.com/bradley499/sss-guis).

This package includes:

- A `widget` base class that monitors event states and enabled states.
- `publishEvent(...)` to send events to widgets on the current page and to connected shared workers.
- A built-in `"shared_worker"` widget that connects page events to a compiled `SharedWorker` built upon [`@sss/sss-guis-smart-widgets-shared-worker-base`](https://github.com/bradley499/sss-guis-smart-widgets-shared-worker-base).

---

## Create a Smart Widget

Create a subclass of `widget`. Use `followEvent(...)` to receive events. Use `publishEvent(...)` to send events. Register the widget with `structureDeclareWidget`.

```ts
import {
    type eventContents,
    publishEvent,
    structureDeclareWidget,
    widget,
} from "@sss/sss-guis-smart-widgets-base";

export class buttonWidget extends widget<"button"> {
    constructor() {
        super("button");
    }

    public configuration(_configuration: object): void {
        this.followEvent("button/label", "text", (contents: eventContents): void => {
          this.content.textContent = String(contents);
        });
        this.content.addEventListener("click", (): void => {
            publishEvent("action/trigger", "text", "clicked");
        });
    }

    protected enabled(): void {
        this.content.disabled = false;
    }

    protected disabled(): void {
        this.content.disabled = true;
    }

    protected prepare(): Promise<void> {
        return Promise.resolve();
    }
}

structureDeclareWidget("button", buttonWidget);
```

---

## Event States

A smart widget monitors incoming and outgoing events on the current page. It shows its event state with the `events` HTML attribute on its root element.

| Condition | `events` attribute | Event state | Result |
| :--- | :--- | :--- | :--- |
| Widget does not follow events | Not set | Active | Widget stays enabled. |
| Widget calls `followEvent(...)` (timer not active) | `expired` | Expired | Widget sends a follow request and calls `disabled()`. |
| Matching event arrives (`name` and `type` match) | `active` | Active | Widget starts a 5-second timer, calls callbacks, and checks enabled state. |
| 5 seconds pass with no matching event | `expired` | Expired | Widget calls `disabled()`. |

If the widget follows another topic while the 5-second timer is active, it keeps `events="active"`.

---

## Enabling and Disabling

### Disabling a Widget

The widget calls `disabled()` if **any one** of these conditions occurs:

| Cause | Action |
| :--- | :--- |
| You call `this.disable()`. | The base class adds `disabled` to the root element and calls `disabled()`. |
| A parent element has `disabled`. | The base class detects the parent state and calls `disabled()`. |
| Followed events expire (`events="expired"`). | The base class calls `disabled()`. |

### Enabling a Widget

The widget calls `enabled()` **only if all** of these conditions are true:

| Condition | Requirement |
| :--- | :--- |
| Own state | The widget starts enabled, or you call `this.enable()` (which removes `disabled` from the root element). |
| Parent state | No parent element has `disabled`. |
| Event state | The widget follows no events, or `events="active"`. |

---

## Bundle for the Browser

Compile your widget entry point into one standalone browser ESM bundle. For example, use `esbuild`:

```bash
esbuild src/index.ts --bundle --format=esm --platform=browser --target=es2022 --outfile=dist/index.js
```
