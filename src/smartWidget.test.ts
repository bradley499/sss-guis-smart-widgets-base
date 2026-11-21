import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { structureLoadEventType } from "@sss/sss-guis";
import { type eventContents, type eventFollow } from "@sss/sss-guis-smart-widgets-common";
import { eventIncoming, eventOutgoingFollow, publishEvent } from "./event";
import { smartWidget } from "./smartWidget";

const eventDisabledByParent: string = "disabledByParent";

interface trackedDocumentListener {
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: (boolean | AddEventListenerOptions);
}

interface recordedEventDelivery {
    contents: eventContents;
    time: Date;
}

/**
 * Concrete implementation of {@link smartWidget} for unit testing
 */
class testWidget extends smartWidget {
    public enabledCalls: number = 0;
    public disabledCalls: number = 0;

    /**
     * Constructs a test widget with the given HTML tag
     * @param tag HTML element tag name
     */
    constructor(tag: string = "div") {
        super(tag);
    }

    /**
     * Configures the test widget
     */
    public configuration(): void {
        return;
    }

    /**
     * Prepares the test widget element
     * @returns Promise resolving when ready
     */
    protected prepare(): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Renders the test widget root element
     * @returns Promise resolving to the widget element
     */
    public render(): Promise<HTMLElement> {
        return Promise.resolve(this.content);
    }

    /**
     * Handler invoked when the widget transitions to enabled
     */
    protected enabled(): void {
        this.enabledCalls++;
    }

    /**
     * Handler invoked when the widget transitions to disabled
     */
    protected disabled(): void {
        this.disabledCalls++;
    }

    /**
     * Exposes protected {@link smartWidget.enable} for tests
     */
    public triggerEnable(): void {
        this.enable();
    }

    /**
     * Exposes protected {@link smartWidget.disable} for tests
     */
    public triggerDisable(): void {
        this.disable();
    }

    /**
     * Exposes protected {@link smartWidget.followEvent} for tests
     * @param name Event topic name to follow
     * @param type Event payload type to follow
     * @param callback Callback invoked when a matching event arrives
     */
    public testFollowEvent(name: string, type: string, callback: (contents: eventContents, time: Date) => void): void {
        this.followEvent(name, type, callback);
    }
}

describe("smartWidget", (): void => {
    let trackedDocumentListeners: trackedDocumentListener[] = [];
    let trackedMutationObservers: MutationObserver[] = [];

    beforeEach((): void => {
        vi.useFakeTimers();
        document.body.innerHTML = "";
        trackedDocumentListeners = [];
        trackedMutationObservers = [];

        vi.spyOn(document, "addEventListener").mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: (boolean | AddEventListenerOptions)): void => {
            trackedDocumentListeners.push({
                type: type,
                listener: listener,
                options: options,
            });
            EventTarget.prototype.addEventListener.call(document, type, listener, options);
        });
    });

    afterEach((): void => {
        while (trackedDocumentListeners.length > 0) {
            const entry: (trackedDocumentListener | undefined) = trackedDocumentListeners.pop();
            if (entry) {
                document.removeEventListener(entry.type, entry.listener, entry.options);
            }
        }
        while (trackedMutationObservers.length > 0) {
            const observer: (MutationObserver | undefined) = trackedMutationObservers.pop();
            if (observer) {
                observer.disconnect();
            }
        }
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("Self enable and disable state", (): void => {
        it("should initialize enabled without a disabled attribute or hook calls", async (): Promise<void> => {
            const widget: testWidget = new testWidget("div");
            const content: HTMLElement = await widget.render();

            expect(content.hasAttribute("disabled")).toBe(false);
            expect(widget.enabledCalls).toBe(0);
            expect(widget.disabledCalls).toBe(0);
        });

        it("should set disabled attribute on disable and only notify on actual state transitions", async (): Promise<void> => {
            const widget: testWidget = new testWidget("div");
            const content: HTMLElement = await widget.render();

            widget.triggerDisable();
            expect(content.hasAttribute("disabled")).toBe(true);
            expect(widget.disabledCalls).toBe(1);

            widget.triggerDisable();
            expect(widget.disabledCalls).toBe(1);

            widget.triggerEnable();
            expect(content.hasAttribute("disabled")).toBe(false);
            expect(widget.enabledCalls).toBe(1);

            widget.triggerEnable();
            expect(widget.enabledCalls).toBe(1);
        });

        it("should toggle the native disabled property when wrapping a button element", async (): Promise<void> => {
            const widget: testWidget = new testWidget("button");
            const button: HTMLButtonElement = (await widget.render()) as HTMLButtonElement;

            expect(button.disabled).toBe(false);

            widget.triggerDisable();
            expect(button.disabled).toBe(true);

            widget.triggerEnable();
            expect(button.disabled).toBe(false);
        });
    });

    describe("Event following and expiry", (): void => {
        it("should dispatch eventOutgoingFollow, mark events expired, and disable on followEvent", async (): Promise<void> => {
            const widget: testWidget = new testWidget("div");
            const content: HTMLElement = await widget.render();
            const followEvents: CustomEvent<eventFollow>[] = [];

            document.addEventListener(eventOutgoingFollow, (event: Event): void => {
                followEvents.push(event as CustomEvent<eventFollow>);
            });

            widget.testFollowEvent("sensor/temp", "number", vi.fn());

            expect(followEvents).toHaveLength(1);
            expect(followEvents[0].bubbles).toBe(false);
            expect(followEvents[0].cancelable).toBe(false);
            expect(followEvents[0].detail).toEqual({
                name: "sensor/temp",
                type: "number",
            });
            expect(content.getAttribute("events")).toBe("expired");
            expect(widget.disabledCalls).toBe(1);
        });

        it("should activate widget and invoke callback for both incoming and outgoing matching events", async (): Promise<void> => {
            const widget: testWidget = new testWidget("div");
            const content: HTMLElement = await widget.render();
            const receivedDeliveries: recordedEventDelivery[] = [];

            widget.testFollowEvent("chat/message", "text", (contents: eventContents, time: Date): void => {
                receivedDeliveries.push({
                    contents: contents,
                    time: time,
                });
            });

            const incomingTime: Date = new Date("2026-02-01T12:00:00.000Z");
            publishEvent("chat/message", "text", "from-server", true, incomingTime);

            expect(content.getAttribute("events")).toBe("active");
            expect(widget.enabledCalls).toBe(1);

            const outgoingTime: Date = new Date("2026-02-01T12:00:01.000Z");
            publishEvent("chat/message", "text", "from-local-widget", false, outgoingTime);

            expect(receivedDeliveries).toEqual([
                {
                    contents: "from-server",
                    time: incomingTime,
                },
                {
                    contents: "from-local-widget",
                    time: outgoingTime,
                },
            ]);
        });

        it("should ignore events with non-matching name or type", async (): Promise<void> => {
            const widget: testWidget = new testWidget("div");
            const content: HTMLElement = await widget.render();
            const callback: Mock<(contents: eventContents, time: Date) => void> = vi.fn();

            widget.testFollowEvent("metrics/cpu", "json", callback);

            publishEvent("metrics/memory", "json", 50, true);
            publishEvent("metrics/cpu", "string", "50%", true);

            expect(callback).not.toHaveBeenCalled();
            expect(content.getAttribute("events")).toBe("expired");
        });

        it("should convert serialized string timestamps and synthesize a Date when time is omitted", (): void => {
            const widget: testWidget = new testWidget("div");
            const recordedTimes: Date[] = [];

            widget.testFollowEvent("clock/tick", "json", (_contents: eventContents, time: Date): void => {
                recordedTimes.push(time);
            });

            const serializedTimestamp: string = "2026-03-15T08:30:00.000Z";
            document.dispatchEvent(new CustomEvent(eventIncoming, {
                detail: {
                    name: "clock/tick",
                    type: "json",
                    contents: 1,
                    time: serializedTimestamp,
                },
            }));

            vi.setSystemTime(new Date("2026-03-15T09:00:00.000Z"));
            publishEvent("clock/tick", "json", 2, true);

            expect(recordedTimes).toHaveLength(2);
            expect(recordedTimes[0]).toBeInstanceOf(Date);
            expect(recordedTimes[0].toISOString()).toBe(serializedTimestamp);
            expect(recordedTimes[1]).toBeInstanceOf(Date);
            expect(recordedTimes[1].toISOString()).toBe("2026-03-15T09:00:00.000Z");
        });

        it("should support multiple unique callbacks on the same topic and warn on duplicates", (): void => {
            const widget: testWidget = new testWidget("div");
            const warnSpy: Mock<(...data: unknown[]) => void> = vi.fn();
            vi.spyOn(console, "warn").mockImplementation(warnSpy);
            const firstCallback: Mock<(contents: eventContents, time: Date) => void> = vi.fn();
            const secondCallback: Mock<(contents: eventContents, time: Date) => void> = vi.fn();

            widget.testFollowEvent("alert", "text", firstCallback);
            widget.testFollowEvent("alert", "text", firstCallback);
            widget.testFollowEvent("alert", "text", secondCallback);

            expect(warnSpy).toHaveBeenCalledTimes(1);

            publishEvent("alert", "text", "warning", true);

            expect(firstCallback).toHaveBeenCalledTimes(1);
            expect(secondCallback).toHaveBeenCalledTimes(1);
        });

        it("should refresh the 5000 ms timer on subsequent events and expire cleanly after inactivity", async (): Promise<void> => {
            const widget: testWidget = new testWidget("div");
            const content: HTMLElement = await widget.render();

            widget.testFollowEvent("heartbeat", "ping", vi.fn());
            expect(widget.disabledCalls).toBe(1);

            publishEvent("heartbeat", "ping", 1, true);
            expect(content.getAttribute("events")).toBe("active");
            expect(widget.enabledCalls).toBe(1);

            vi.advanceTimersByTime(4000);
            expect(content.getAttribute("events")).toBe("active");

            publishEvent("heartbeat", "ping", 2, true);
            vi.advanceTimersByTime(4999);
            expect(content.getAttribute("events")).toBe("active");

            vi.advanceTimersByTime(1);
            expect(content.getAttribute("events")).toBe("expired");
            expect(widget.disabledCalls).toBe(2);
        });

        it("should keep events active when following an additional topic while already active", async (): Promise<void> => {
            const widget: testWidget = new testWidget("div");
            const content: HTMLElement = await widget.render();

            widget.testFollowEvent("stream/first", "json", vi.fn());
            publishEvent("stream/first", "json", "ok", true);
            expect(content.getAttribute("events")).toBe("active");

            widget.testFollowEvent("stream/second", "json", vi.fn());
            expect(content.getAttribute("events")).toBe("active");
        });
    });

    describe("Tri-state enablement (self, parent, events)", (): void => {
        it("should require self, parent, and events to all be true to stay enabled", async (): Promise<void> => {
            const widget: testWidget = new testWidget("div");
            const content: HTMLElement = await widget.render();

            widget.testFollowEvent("status", "boolean", vi.fn());
            expect(widget.disabledCalls).toBe(1);
            expect(widget.enabledCalls).toBe(0);

            publishEvent("status", "boolean", true, true);
            expect(widget.enabledCalls).toBe(1);

            widget.triggerDisable();
            expect(widget.disabledCalls).toBe(2);

            content.dispatchEvent(new CustomEvent(eventDisabledByParent, {
                detail: true,
            }));
            expect(widget.disabledCalls).toBe(3);

            publishEvent("status", "boolean", true, true);
            expect(widget.disabledCalls).toBe(4);
            expect(widget.enabledCalls).toBe(1);

            widget.triggerEnable();
            expect(widget.enabledCalls).toBe(2);

            content.dispatchEvent(new CustomEvent(eventDisabledByParent, {
                detail: false,
            }));
            expect(widget.disabledCalls).toBe(5);

            vi.advanceTimersByTime(5000);
            content.dispatchEvent(new CustomEvent(eventDisabledByParent, {
                detail: true,
            }));
            expect(widget.enabledCalls).toBe(2);

            publishEvent("status", "boolean", true, true);
            expect(widget.enabledCalls).toBe(3);
        });
    });

    describe("DOM hierarchy observation on structure load", (): void => {
        it("should propagate disabled state on initial load and observe ancestor disabled attribute mutations", async (): Promise<void> => {
            vi.spyOn(console, "info").mockImplementation((): void => {
                return;
            });

            const nativeMutationObserver: typeof MutationObserver = MutationObserver;
            /**
             * Wraps native MutationObserver so tests can disconnect created observers during cleanup
             */
            class trackedMutationObserver extends nativeMutationObserver {
                /**
                 * Constructs a tracked MutationObserver
                 * @param callback Mutation callback
                 */
                constructor(callback: MutationCallback) {
                    super(callback);
                    trackedMutationObservers.push(this);
                }
            }
            vi.stubGlobal("MutationObserver", trackedMutationObserver);

            const preDisabledParent: HTMLFieldSetElement = document.createElement("fieldset");
            preDisabledParent.disabled = true;
            const widgetInsideDisabledParent: testWidget = new testWidget("div");
            preDisabledParent.appendChild(await widgetInsideDisabledParent.render());

            const dynamicParent: HTMLDivElement = document.createElement("div");
            const widgetInsideDynamicParent: testWidget = new testWidget("div");
            dynamicParent.appendChild(await widgetInsideDynamicParent.render());

            document.body.appendChild(preDisabledParent);
            document.body.appendChild(dynamicParent);

            document.dispatchEvent(new Event(structureLoadEventType));

            expect(widgetInsideDisabledParent.disabledCalls).toBe(1);
            expect(widgetInsideDynamicParent.disabledCalls).toBe(0);

            dynamicParent.setAttribute("disabled", "");
            await Promise.resolve();
            expect(widgetInsideDynamicParent.disabledCalls).toBe(1);

            dynamicParent.removeAttribute("disabled");
            await Promise.resolve();
            expect(widgetInsideDynamicParent.enabledCalls).toBe(1);
        });

        it("should register only one structureLoad listener across module reloads and disconnect previous observers on repeat loads", async (): Promise<void> => {
            vi.spyOn(console, "info").mockImplementation((): void => {
                return;
            });

            const disconnectSpy: Mock<() => void> = vi.fn();
            const nativeMutationObserver: typeof MutationObserver = MutationObserver;
            /**
             * Wraps native MutationObserver to track created observer instances and disconnect calls
             */
            class trackedMutationObserver extends nativeMutationObserver {
                /**
                 * Constructs a tracked MutationObserver
                 * @param callback Mutation callback
                 */
                constructor(callback: MutationCallback) {
                    super(callback);
                    trackedMutationObservers.push(this);
                }

                /**
                 * Records disconnect calls before delegating to the native observer
                 */
                public override disconnect(): void {
                    disconnectSpy();
                    super.disconnect();
                }
            }
            vi.stubGlobal("MutationObserver", trackedMutationObserver);

            vi.resetModules();
            await import("./smartWidget");

            const addedStructureLoadListeners: trackedDocumentListener[] = trackedDocumentListeners.filter(
                (entry: trackedDocumentListener): boolean => {
                    return entry.type === structureLoadEventType;
                }
            );
            expect(addedStructureLoadListeners).toHaveLength(0);

            const dynamicParent: HTMLDivElement = document.createElement("div");
            const widgetInsideDynamicParent: testWidget = new testWidget("div");
            dynamicParent.appendChild(await widgetInsideDynamicParent.render());
            document.body.appendChild(dynamicParent);

            document.dispatchEvent(new Event(structureLoadEventType));
            expect(trackedMutationObservers).toHaveLength(1);
            expect(disconnectSpy).not.toHaveBeenCalled();

            document.dispatchEvent(new Event(structureLoadEventType));
            expect(trackedMutationObservers).toHaveLength(2);
            expect(disconnectSpy).toHaveBeenCalledTimes(1);

            dynamicParent.setAttribute("disabled", "");
            await Promise.resolve();
            expect(widgetInsideDynamicParent.disabledCalls).toBe(1);
        });
    });
});
