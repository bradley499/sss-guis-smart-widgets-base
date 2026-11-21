import { afterEach, describe, expect, it } from "vitest";
import { type eventMessage } from "@sss/sss-guis-smart-widgets-common";
import { eventIncoming, eventOutgoing, publishEvent } from "./event";

interface trackedDocumentListener {
    type: string;
    listener: EventListener;
}

describe("event broadcasting (publishEvent)", (): void => {
    const trackedListeners: trackedDocumentListener[] = [];

    /**
     * Registers a document event listener that is removed after each test
     * @param type The DOM event name to listen for
     * @param listener The listener callback
     */
    function addTrackedListener(type: string, listener: EventListener): void {
        trackedListeners.push({
            type: type,
            listener: listener,
        });
        document.addEventListener(type, listener);
    }

    afterEach((): void => {
        while (trackedListeners.length > 0) {
            const entry: (trackedDocumentListener | undefined) = trackedListeners.pop();
            if (entry) {
                document.removeEventListener(entry.type, entry.listener);
            }
        }
    });

    it("should dispatch eventOutgoing by default without firing eventIncoming or setting time", (): void => {
        const outgoingEvents: CustomEvent<eventMessage>[] = [];
        const incomingEvents: CustomEvent<eventMessage>[] = [];

        addTrackedListener(eventOutgoing, (event: Event): void => {
            outgoingEvents.push(event as CustomEvent<eventMessage>);
        });
        addTrackedListener(eventIncoming, (event: Event): void => {
            incomingEvents.push(event as CustomEvent<eventMessage>);
        });

        publishEvent("sensor/temp", "number", 21.5);

        expect(incomingEvents).toHaveLength(0);
        expect(outgoingEvents).toHaveLength(1);
        expect(outgoingEvents[0].bubbles).toBe(false);
        expect(outgoingEvents[0].cancelable).toBe(false);
        expect(outgoingEvents[0].detail).toEqual({
            name: "sensor/temp",
            type: "number",
            contents: 21.5,
        });
        expect("time" in outgoingEvents[0].detail).toBe(false);
    });

    it("should dispatch eventIncoming when keepInternal is true without firing eventOutgoing", (): void => {
        const incomingEvents: CustomEvent<eventMessage>[] = [];
        const outgoingEvents: CustomEvent<eventMessage>[] = [];

        addTrackedListener(eventIncoming, (event: Event): void => {
            incomingEvents.push(event as CustomEvent<eventMessage>);
        });
        addTrackedListener(eventOutgoing, (event: Event): void => {
            outgoingEvents.push(event as CustomEvent<eventMessage>);
        });

        publishEvent("ui/state", "json", {
            ready: true,
        }, true);

        expect(outgoingEvents).toHaveLength(0);
        expect(incomingEvents).toHaveLength(1);
        expect(incomingEvents[0].bubbles).toBe(false);
        expect(incomingEvents[0].cancelable).toBe(false);
        expect(incomingEvents[0].detail).toEqual({
            name: "ui/state",
            type: "json",
            contents: {
                ready: true,
            },
        });
        expect("time" in incomingEvents[0].detail).toBe(false);
    });

    it("should include the optional time timestamp for both outgoing and internal events", (): void => {
        const outgoingTime: Date = new Date("2026-01-01T10:00:00.000Z");
        const incomingTime: Date = new Date("2026-01-01T10:05:00.000Z");
        const outgoingDetails: eventMessage[] = [];
        const incomingDetails: eventMessage[] = [];

        addTrackedListener(eventOutgoing, (event: Event): void => {
            outgoingDetails.push((event as CustomEvent<eventMessage>).detail);
        });
        addTrackedListener(eventIncoming, (event: Event): void => {
            incomingDetails.push((event as CustomEvent<eventMessage>).detail);
        });

        publishEvent("topic/first", "string", "hello", false, outgoingTime);
        publishEvent("topic/second", "string", "world", true, incomingTime);

        expect(outgoingDetails).toEqual([
            {
                name: "topic/first",
                type: "string",
                contents: "hello",
                time: outgoingTime,
            },
        ]);
        expect(incomingDetails).toEqual([
            {
                name: "topic/second",
                type: "string",
                contents: "world",
                time: incomingTime,
            },
        ]);
    });

    it("should preserve null, boolean, number, and object payload contents accurately", (): void => {
        const receivedPayloads: unknown[] = [];

        addTrackedListener(eventOutgoing, (event: Event): void => {
            receivedPayloads.push((event as CustomEvent<eventMessage>).detail.contents);
        });

        publishEvent("topic/null", "raw", null);
        publishEvent("topic/boolean", "boolean", false);
        publishEvent("topic/number", "number", 0);
        publishEvent("topic/object", "json", {
            nested: [1, 2, 3],
        });

        expect(receivedPayloads).toEqual([
            null,
            false,
            0,
            {
                nested: [1, 2, 3],
            },
        ]);
    });
});
