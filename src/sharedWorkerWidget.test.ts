import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type communicationEventMessage, type communicationStatus, type eventFollow } from "@sss/sss-guis-smart-widgets-common";
import { eventIncoming, eventOutgoingFollow, publishEvent } from "./event";

interface sharedWorkerWidgetInstance {
    configuration(configuration: object): void;
    render(): Promise<HTMLTableElement>;
}

type sharedWorkerWidgetConstructor = (new () => sharedWorkerWidgetInstance);

interface mockGuisGlobal {
    guis: {
        structureDeclareWidget: (type: string, widgetConstructor: sharedWorkerWidgetConstructor) => void;
    };
}

interface trackedEventListener {
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: (boolean | AddEventListenerOptions);
}

/**
 * Returns the mocked window guis registry initialized by vitest.setup.ts
 * @returns Mock guis global object
 */
function getMockGuisGlobal(): mockGuisGlobal {
    return window as unknown as mockGuisGlobal;
}

describe("sharedWorkerCompanionWidget", (): void => {
    let originalDeclareWidget: (type: string, widgetConstructor: sharedWorkerWidgetConstructor) => void;
    const declareWidgetSpy: Mock<(type: string, widgetConstructor: sharedWorkerWidgetConstructor) => void> = vi.fn();
    let trackedListeners: trackedEventListener[] = [];
    let createdWorkers: mockSharedWorker[] = [];

    /**
     * Mock browser SharedWorker recording port interactions for testing
     */
    class mockSharedWorker {
        public readonly scriptUrl: (string | URL);
        public readonly options: (string | WorkerOptions | undefined);
        public readonly postMessageSpy: Mock<(message: unknown) => void> = vi.fn();
        public readonly startSpy: Mock<() => void> = vi.fn();
        public readonly addEventListenerSpy: Mock<(type: string, listener: (event: MessageEvent<communicationEventMessage | communicationStatus>) => void) => void>;
        public readonly postedMessages: unknown[] = [];
        public readonly port: {
            addEventListener: Mock<(type: string, listener: (event: MessageEvent<communicationEventMessage | communicationStatus>) => void) => void>;
            start: Mock<() => void>;
            postMessage: Mock<(message: unknown) => void>;
        };

        private messageHandler: ((event: MessageEvent<communicationEventMessage | communicationStatus>) => void) | null = null;

        /**
         * Creates a mocked SharedWorker instance and registers it in {@link createdWorkers}
         * @param scriptUrl Worker script URL
         * @param options Optional worker configuration
         */
        constructor(scriptUrl: (string | URL), options?: (string | WorkerOptions)) {
            this.scriptUrl = scriptUrl;
            this.options = options;
            this.postMessageSpy = vi.fn((message: unknown): void => {
                this.postedMessages.push(message);
            });
            this.addEventListenerSpy = vi.fn(
                (type: string, listener: (event: MessageEvent<communicationEventMessage | communicationStatus>) => void): void => {
                    if (type === "message") {
                        this.messageHandler = listener;
                    }
                }
            );
            this.port = {
                addEventListener: this.addEventListenerSpy,
                start: this.startSpy,
                postMessage: this.postMessageSpy,
            };
            createdWorkers.push(this);
        }

        /**
         * Dispatches a synthetic message event from the worker to the companion widget port listener
         * @param data Incoming worker payload
         */
        public emitFromWorker(data: (communicationEventMessage | communicationStatus)): void {
            if (this.messageHandler) {
                this.messageHandler({
                    data: data,
                } as MessageEvent<communicationEventMessage | communicationStatus>);
            }
        }
    }

    /**
     * Dynamically imports sharedWorkerWidget with fresh module state and returns the registered widget constructor
     * @returns Declared shared_worker constructor
     */
    async function loadSharedWorkerWidgetConstructor(): Promise<sharedWorkerWidgetConstructor> {
        vi.resetModules();
        await import("./sharedWorkerWidget");
        const lastCall: ([string, sharedWorkerWidgetConstructor] | undefined) = declareWidgetSpy.mock.calls.at(-1);
        if (!lastCall) {
            throw new Error("Expected shared_worker widget to be declared");
        }
        return lastCall[1];
    }

    beforeAll((): void => {
        const guisGlobal: mockGuisGlobal = getMockGuisGlobal();
        originalDeclareWidget = guisGlobal.guis.structureDeclareWidget;
        guisGlobal.guis.structureDeclareWidget = declareWidgetSpy;
    });

    afterAll((): void => {
        getMockGuisGlobal().guis.structureDeclareWidget = originalDeclareWidget;
    });

    beforeEach((): void => {
        vi.useFakeTimers();
        document.body.innerHTML = "";
        trackedListeners = [];
        createdWorkers = [];
        declareWidgetSpy.mockReset();

        vi.spyOn(document, "addEventListener").mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: (boolean | AddEventListenerOptions)): void => {
            trackedListeners.push({
                target: document,
                type: type,
                listener: listener,
                options: options,
            });
            EventTarget.prototype.addEventListener.call(document, type, listener, options);
        });

        const realWindowAddListener: typeof window.addEventListener = window.addEventListener.bind(window);
        vi.spyOn(window, "addEventListener").mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: (boolean | AddEventListenerOptions)): void => {
            trackedListeners.push({
                target: window,
                type: type,
                listener: listener,
                options: options,
            });
            realWindowAddListener(type, listener, options);
        });

        vi.stubGlobal("SharedWorker", mockSharedWorker);
    });

    afterEach((): void => {
        while (trackedListeners.length > 0) {
            const entry: (trackedEventListener | undefined) = trackedListeners.pop();
            if (entry) {
                entry.target.removeEventListener(entry.type, entry.listener, entry.options);
            }
        }
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("should declare the shared_worker widget type and catch duplicate declaration errors", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();

        expect(declareWidgetSpy).toHaveBeenCalledTimes(1);
        expect(declareWidgetSpy).toHaveBeenCalledWith("shared_worker", widgetConstructor);

        const consoleErrorSpy: Mock<(...data: unknown[]) => void> = vi.fn();
        vi.spyOn(console, "error").mockImplementation(consoleErrorSpy);
        declareWidgetSpy.mockImplementationOnce((): void => {
            throw new Error("Duplicate widget declaration");
        });

        vi.resetModules();
        await import("./sharedWorkerWidget");
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("should render initial status table and support multiple independent widgets with distinct worker paths", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();

        const firstWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const secondWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const firstStatusTable: HTMLTableElement = await firstWorkerWidget.render();
        const secondStatusTable: HTMLTableElement = await secondWorkerWidget.render();
        const firstTableRows: NodeListOf<HTMLTableRowElement> = firstStatusTable.querySelectorAll("tr");
        const secondTableRows: NodeListOf<HTMLTableRowElement> = secondStatusTable.querySelectorAll("tr");

        expect(firstStatusTable.tagName.toLowerCase()).toBe("table");
        expect(firstTableRows).toHaveLength(3);
        expect(firstTableRows[0].children[0].textContent).toBe("Connection state: ");
        expect(firstTableRows[0].children[1].textContent).toBe("Not working...");
        expect(firstTableRows[1].children[0].textContent).toBe("Incoming messages: ");
        expect(firstTableRows[1].children[1].textContent).toBe("0");
        expect(firstTableRows[2].children[0].textContent).toBe("Outgoing messages: ");
        expect(firstTableRows[2].children[1].textContent).toBe("0");

        firstWorkerWidget.configuration({
            worker: "/assets/worker-first.js",
            name: "FirstWorker",
        });
        secondWorkerWidget.configuration({
            worker: "/assets/worker-second.js",
            name: "SecondWorker",
        });

        expect(createdWorkers).toHaveLength(2);
        expect(createdWorkers[0].scriptUrl).toBe("/assets/worker-first.js");
        expect(createdWorkers[0].options).toEqual({
            name: "FirstWorker",
        });
        expect(createdWorkers[1].scriptUrl).toBe("/assets/worker-second.js");
        expect(createdWorkers[1].options).toEqual({
            name: "SecondWorker",
        });

        createdWorkers[0].emitFromWorker({
            connected: true,
        });
        createdWorkers[1].emitFromWorker({
            connected: false,
        });

        expect(firstTableRows[0].children[1].textContent).toBe("Connected");
        expect(secondTableRows[0].children[1].textContent).toBe("Not connected");
    });

    it("should validate configuration properties and reject duplicate instance or duplicate worker configurations", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();
        const firstInstance: sharedWorkerWidgetInstance = new widgetConstructor();
        const secondInstance: sharedWorkerWidgetInstance = new widgetConstructor();

        expect((): void => {
            firstInstance.configuration({});
        }).toThrow("A `worker` is required!");

        expect((): void => {
            firstInstance.configuration({
                worker: "   ",
            });
        }).toThrow("A `worker` is expected to be a path to a shared worker!");

        expect((): void => {
            firstInstance.configuration({
                worker: 123,
            });
        }).toThrow("A `worker` is expected to be a path to a shared worker!");

        expect((): void => {
            firstInstance.configuration({
                worker: "/assets/worker.js",
                name: 42,
            });
        }).toThrow("A `name` must be a string value!");

        firstInstance.configuration({
            worker: "/assets/worker.js",
        });

        expect(createdWorkers).toHaveLength(1);
        expect(createdWorkers[0].options).toEqual({
            name: "",
        });
        expect(createdWorkers[0].startSpy).toHaveBeenCalledTimes(1);

        expect((): void => {
            firstInstance.configuration({
                worker: "/assets/other.js",
            });
        }).toThrow("This `shared_worker` widget has already been configured!");

        expect((): void => {
            secondInstance.configuration({
                worker: "/assets/worker.js",
            });
        }).toThrow(`A \`shared_worker\` for "/assets/worker.js" has already been configured!`);
    });

    it("should keep followed events persistently, deduplicate them, and replay them to newly configured workers", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();
        const firstWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const secondWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();

        const followBeforeConfiguration: eventFollow = {
            name: "sensor/temperature",
            type: "number",
        };
        const duplicateFollow: eventFollow = {
            name: "sensor/temperature",
            type: "number",
        };

        document.dispatchEvent(new CustomEvent(eventOutgoingFollow, {
            detail: followBeforeConfiguration,
        }));
        document.dispatchEvent(new CustomEvent(eventOutgoingFollow, {
            detail: duplicateFollow,
        }));

        firstWorkerWidget.configuration({
            worker: "/assets/worker-first.js",
        });
        expect(createdWorkers[0].postMessageSpy).toHaveBeenCalledTimes(1);
        expect(createdWorkers[0].postMessageSpy).toHaveBeenCalledWith(followBeforeConfiguration);

        const followAfterFirstConfiguration: eventFollow = {
            name: "system/alert",
            type: "text",
        };
        document.dispatchEvent(new CustomEvent(eventOutgoingFollow, {
            detail: followAfterFirstConfiguration,
        }));
        document.dispatchEvent(new CustomEvent(eventOutgoingFollow, {
            detail: followBeforeConfiguration,
        }));
        expect(createdWorkers[0].postMessageSpy).toHaveBeenCalledTimes(2);
        expect(createdWorkers[0].postMessageSpy).toHaveBeenNthCalledWith(2, followAfterFirstConfiguration);

        secondWorkerWidget.configuration({
            worker: "/assets/worker-second.js",
        });
        expect(createdWorkers[1].postMessageSpy).toHaveBeenCalledTimes(2);
        expect(createdWorkers[1].postMessageSpy).toHaveBeenNthCalledWith(1, followBeforeConfiguration);
        expect(createdWorkers[1].postMessageSpy).toHaveBeenNthCalledWith(2, followAfterFirstConfiguration);
    });

    it("should not queue outgoing events dispatched before any worker is configured", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();
        const workerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const statusTable: HTMLTableElement = await workerWidget.render();
        const tableRows: NodeListOf<HTMLTableRowElement> = statusTable.querySelectorAll("tr");

        publishEvent("command/initialize", "string", "boot");

        workerWidget.configuration({
            worker: "/assets/worker.js",
        });

        expect(createdWorkers[0].postMessageSpy).not.toHaveBeenCalled();
        expect(tableRows[2].children[1].textContent).toBe("0");
    });

    it("should broadcast outgoing events to all active workers with distinct sequential deduplication IDs", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();
        const firstWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const secondWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const firstTableRows: NodeListOf<HTMLTableRowElement> = (await firstWorkerWidget.render()).querySelectorAll("tr");
        const secondTableRows: NodeListOf<HTMLTableRowElement> = (await secondWorkerWidget.render()).querySelectorAll("tr");

        firstWorkerWidget.configuration({
            worker: "/assets/worker-first.js",
        });
        secondWorkerWidget.configuration({
            worker: "/assets/worker-second.js",
        });

        const timestamp: Date = new Date("2026-04-01T00:00:00.000Z");
        publishEvent("button/click", "action", "Save", false, timestamp);
        publishEvent("button/click", "action", "Confirm");
        publishEvent("local/internal", "json", true, true);

        expect(createdWorkers[0].postedMessages).toHaveLength(2);
        expect(createdWorkers[1].postedMessages).toHaveLength(2);

        const firstSentToFirstWorker: communicationEventMessage = createdWorkers[0].postedMessages[0] as communicationEventMessage;
        const firstSentToSecondWorker: communicationEventMessage = createdWorkers[1].postedMessages[0] as communicationEventMessage;
        const secondSentToFirstWorker: communicationEventMessage = createdWorkers[0].postedMessages[1] as communicationEventMessage;

        expect(typeof firstSentToFirstWorker.id).toBe("string");
        expect(firstSentToFirstWorker.id?.length).toBeGreaterThan(0);
        expect(firstSentToFirstWorker).toEqual({
            name: "button/click",
            type: "action",
            contents: "Save",
            time: timestamp,
            id: firstSentToFirstWorker.id,
        });
        expect(firstSentToSecondWorker).toEqual(firstSentToFirstWorker);
        expect(secondSentToFirstWorker.id).toBeDefined();
        expect(secondSentToFirstWorker.id).not.toBe(firstSentToFirstWorker.id);
        expect("time" in secondSentToFirstWorker).toBe(false);

        expect(firstTableRows[2].children[1].textContent).toBe("2");
        expect(secondTableRows[2].children[1].textContent).toBe("2");
    });

    it("should deduplicate peer broadcasts by ID across workers within the 1000 ms lifetime while passing backend messages without IDs", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();
        const firstWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const secondWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const firstTableRows: NodeListOf<HTMLTableRowElement> = (await firstWorkerWidget.render()).querySelectorAll("tr");
        const secondTableRows: NodeListOf<HTMLTableRowElement> = (await secondWorkerWidget.render()).querySelectorAll("tr");

        firstWorkerWidget.configuration({
            worker: "/assets/worker-first.js",
        });
        secondWorkerWidget.configuration({
            worker: "/assets/worker-second.js",
        });

        const incomingEvents: communicationEventMessage[] = [];
        document.addEventListener(eventIncoming, (event: Event): void => {
            incomingEvents.push((event as CustomEvent<communicationEventMessage>).detail);
        });

        const peerTimestamp: Date = new Date("2026-04-01T00:01:00.000Z");
        const sharedPeerPayload: communicationEventMessage = {
            name: "chat/message",
            type: "text",
            contents: "Hello from peer tab",
            time: peerTimestamp,
            id: "remote-page:1",
        };

        createdWorkers[0].emitFromWorker(sharedPeerPayload);
        createdWorkers[1].emitFromWorker(sharedPeerPayload);

        expect(incomingEvents).toHaveLength(1);
        expect(incomingEvents[0]).toEqual({
            name: "chat/message",
            type: "text",
            contents: "Hello from peer tab",
            time: peerTimestamp,
        });
        expect(firstTableRows[1].children[1].textContent).toBe("1");
        expect(secondTableRows[1].children[1].textContent).toBe("0");

        createdWorkers[0].emitFromWorker({
            name: "telemetry/state",
            type: "json",
            contents: 1,
        });
        createdWorkers[1].emitFromWorker({
            name: "telemetry/state",
            type: "json",
            contents: 1,
        });
        expect(incomingEvents).toHaveLength(3);
        expect(firstTableRows[1].children[1].textContent).toBe("2");
        expect(secondTableRows[1].children[1].textContent).toBe("1");

        vi.advanceTimersByTime(600);
        createdWorkers[0].emitFromWorker({
            name: "chat/message",
            type: "text",
            contents: "Keep stream active",
            id: "remote-page:2",
        });
        vi.advanceTimersByTime(450);

        createdWorkers[1].emitFromWorker(sharedPeerPayload);
        expect(incomingEvents).toHaveLength(5);

        vi.advanceTimersByTime(1000);
        createdWorkers[0].emitFromWorker({
            name: "chat/message",
            type: "text",
            contents: "Keep stream active",
            id: "remote-page:2",
        });
        expect(incomingEvents).toHaveLength(6);
    });

    it("should update connection state per worker and fall back to Not working after 500 ms timeout independently", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();
        const firstWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const secondWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const firstStatusCell: Element = (await firstWorkerWidget.render()).querySelectorAll("tr")[0].children[1];
        const secondStatusCell: Element = (await secondWorkerWidget.render()).querySelectorAll("tr")[0].children[1];

        firstWorkerWidget.configuration({
            worker: "/assets/worker-first.js",
        });
        secondWorkerWidget.configuration({
            worker: "/assets/worker-second.js",
        });

        createdWorkers[0].emitFromWorker({
            connected: true,
        });
        createdWorkers[1].emitFromWorker({
            connected: false,
        });
        expect(firstStatusCell.textContent).toBe("Connected");
        expect(secondStatusCell.textContent).toBe("Not connected");

        vi.advanceTimersByTime(400);
        createdWorkers[0].emitFromWorker({
            connected: true,
        });
        vi.advanceTimersByTime(100);

        expect(firstStatusCell.textContent).toBe("Connected");
        expect(secondStatusCell.textContent).toBe("Not working...");

        vi.advanceTimersByTime(400);
        expect(firstStatusCell.textContent).toBe("Not working...");
    });

    it("should send disconnect control message to all active workers on beforeunload and tolerate errors", async (): Promise<void> => {
        const widgetConstructor: sharedWorkerWidgetConstructor = await loadSharedWorkerWidgetConstructor();
        const firstWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();
        const secondWorkerWidget: sharedWorkerWidgetInstance = new widgetConstructor();

        expect((): void => {
            window.dispatchEvent(new Event("beforeunload"));
        }).not.toThrow();

        firstWorkerWidget.configuration({
            worker: "/assets/worker-first.js",
        });
        secondWorkerWidget.configuration({
            worker: "/assets/worker-second.js",
        });

        createdWorkers[0].postMessageSpy.mockImplementationOnce((): void => {
            throw new Error("Worker port closed");
        });

        expect((): void => {
            window.dispatchEvent(new Event("beforeunload"));
        }).not.toThrow();

        expect(createdWorkers[0].postMessageSpy).toHaveBeenCalledWith({
            disconnect: true,
        });
        expect(createdWorkers[1].postMessageSpy).toHaveBeenCalledWith({
            disconnect: true,
        });
    });
});
