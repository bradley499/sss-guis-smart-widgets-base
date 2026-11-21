import { type eventContents, type eventMessage, type eventName, type eventType } from "@sss/sss-guis-smart-widgets-common";
export { type eventContents, type eventName, type eventType } from "@sss/sss-guis-smart-widgets-common";

/**
 * DOM custom event name dispatched on `document` for incoming messages delivered to widgets
 */
export const eventIncoming: string = "eventIncoming";

/**
 * DOM custom event name dispatched on `document` for outgoing messages published by widgets
 */
export const eventOutgoing: string = "eventOutgoing";

/**
 * DOM custom event name dispatched on `document` when a widget begins following a topic
 */
export const eventOutgoingFollow: string = "eventOutgoingFollow";

/**
 * Publishes an event to widgets following it on this page, and forwards it externally (to other tabs and the transport) unless `keepInternal` is `true`
 * @template eventContentsType The type of the event's payload contents
 * @param name Event topic or channel name
 * @param type Event payload type or format identifier
 * @param contents Payload data carried by the event
 * @param keepInternal When `true`, delivers the event only to widgets on the current page without forwarding it externally
 * @param time Optional timestamp indicating when the event occurred
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function publishEvent<eventContentsType = eventContents>(name: eventName, type: eventType, contents: eventContentsType, keepInternal: boolean = false, time?: Date): void {
    const message: eventMessage<eventContentsType> = {
        name: name,
        type: type,
        contents: contents,
    };
    if (time !== undefined) {
        message.time = time;
    }
    document.dispatchEvent(new CustomEvent((keepInternal ? eventIncoming : eventOutgoing), {
        detail: message,
        bubbles: false,
        cancelable: false,
    }));
}
