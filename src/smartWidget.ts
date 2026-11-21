import { eventIncoming, eventOutgoing, eventOutgoingFollow } from "./event";
import { structureLoadEventType, widget } from "@sss/sss-guis";
import { type eventContents, type eventFollow, type eventMessage, type eventName, type eventType, timeout } from "@sss/sss-guis-smart-widgets-common";

/**
 * Internal enabled states of a {@link smartWidget} interface
 */
interface smartWidgetEnabledState {
    self: boolean;
    parent: boolean;
    events: boolean;
}

/**
 * Callback type for events that have been followed by {@link smartWidget.followEvent}
 */
type smartWidgetCallback = (eventContents: eventContents, time: Date) => void;

/**
 * How long a {@link smartWidget} can be active for after an event has been received
 */
const smartWidgetEventTimeout: number = 5000;

/**
 * Event name for when a widget is disabled by a parent element
 */
const eventDisabledByParent: string = "disabledByParent";

/**
 * Enable (or disable) a HTML element in the quickest way possible
 * @param element The element to enable
 * @param enable Whether to enable th element
 * @param hasDisabledProperty Whether the element has a disabled property
 */
function enableElement(element: HTMLElement, enable: boolean, hasDisabledProperty: boolean): void {
    if (hasDisabledProperty) {
        (element as HTMLInputElement).disabled = !enable;
    } else if (enable) {
        element.removeAttribute("disabled");
    } else {
        element.setAttribute("disabled", "");
    }
}

/**
 * Check if a HTML element has a native `disabled` property support
 * @param element The element to check
 * @returns Whether the element has a `disabled` property
 */
function hasDisabledProperty(element: HTMLElement): boolean {
    return Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(element), "disabled");
}

/**
 * Smart, state-aware base widget class that follows events and manages enabled/disabled state
 * @template HTMLElementType The underlying HTML element type or tag name for the widget's content
 */
export abstract class smartWidget<HTMLElementType extends (HTMLElement | string) = HTMLElement> extends widget<HTMLElementType> {
    /**
     * Collections of {@link eventName} references that are being followed, along with each {@link eventType} and each {@link smartWidgetCallback}
     */
    private followingEvents!: Map<eventName, Map<eventType, smartWidgetCallback[]>>;
    /**
     * The overall {@link smartWidgetEnabledState} for all kinds of enablers of the widget
     */
    private enabledState!: smartWidgetEnabledState;
    /**
     * The active timer for when an event was last received
     */
    private timeoutTimer!: timeout;
    /**
     * Whether the widget has a `disabled` property accessible to them
     */
    private readonly hasDisabledProperty!: boolean;
    /**
     * Construct a smart widget
     * @param tag The tag of the base type to construct the widget from
     */
    constructor(tag: string) {
        super(tag);
        this.followingEvents = new Map<eventName, Map<eventType, smartWidgetCallback[]>>();
        this.enabledState = {
            self: true,
            parent: true,
            events: true,
        };
        this.timeoutTimer = new timeout(this.eventTimeoutExpired.bind(this), smartWidgetEventTimeout);
        this.hasDisabledProperty = hasDisabledProperty(this.content);
        document.addEventListener(eventIncoming, this.handleEvent.bind(this));
        document.addEventListener(eventOutgoing, this.handleEvent.bind(this)); // Also listen to outgoing events
        this.content.addEventListener(eventDisabledByParent, (event: Event): void => {
            this.enabledState.parent = (event as CustomEvent<boolean>).detail;
            this.stateChange();
        });
    }
    /**
     * Handle state changing events - will subsequently call {@link smartWidget.enabled} or {@link smartWidget.disabled}
     */
    private stateChange(): void {
        if (this.enabledState.self && this.enabledState.parent && this.enabledState.events) {
            this.enabled();
        } else {
            this.disabled();
        }
    }
    /**
     * Enable the widget
     */
    protected enable(): void {
        const current: boolean = this.enabledState.self;
        this.enabledState.self = true;
        enableElement(this.content, true, this.hasDisabledProperty);
        if (current !== this.enabledState.self) {
            this.stateChange();
        }
    }
    /**
     * Disable the widget
     */
    protected disable(): void {
        const current: boolean = this.enabledState.self;
        this.enabledState.self = false;
        enableElement(this.content, false, this.hasDisabledProperty);
        if (current !== this.enabledState.self) {
            this.stateChange();
        }
    }
    /**
     * Follow updates for an event of {@link eventName} and {@link eventType}
     * @param eventName The event to follow
     * @param eventType The type of the event to follow
     * @param callback The callback function to call when a message is received on {@link eventName} when of type {@link eventType}
     */
    protected followEvent(eventName: eventName, eventType: eventType, callback: smartWidgetCallback): void {
        let eventTypes: (Map<eventType, smartWidgetCallback[]> | undefined) = this.followingEvents.get(eventName);
        if (!eventTypes) {
            eventTypes = new Map<eventType, smartWidgetCallback[]>();
            this.followingEvents.set(eventName, eventTypes);
        }

        let callbacks: (smartWidgetCallback[] | undefined) = eventTypes.get(eventType);
        let followingNewEvent: boolean = false;

        if (!callbacks) {
            callbacks = [];
            eventTypes.set(eventType, callbacks);
            followingNewEvent = true;
        }

        if (!callbacks.includes(callback)) {
            callbacks.push(callback);
        } else {
            console.warn(`Multiple event callbacks have been registered to "${eventName}" events of type "${eventType}"`);
        }
        if (followingNewEvent && !this.timeoutTimer.isActive()) {
            this.eventTimeoutExpired(); // Only mark as expired if there was no recently received event
        }
        document.dispatchEvent(new CustomEvent(eventOutgoingFollow, {
            detail: {
                name: eventName,
                type: eventType
            } satisfies eventFollow,
            bubbles: false,
            cancelable: false
        }));
    }
    /**
     * Handles incoming events if the {@link eventName} and {@link eventType} is being following
     * @param eventToHandle Incoming {@link eventMessage}
     */
    private handleEvent(eventToHandle: Event): void {
        const event: eventMessage = (eventToHandle as CustomEvent<eventMessage>).detail;
        const eventTypes: (Map<eventType, smartWidgetCallback[]> | undefined) = this.followingEvents.get(event.name);
        if (!eventTypes) {
            return;
        }
        const callbacks: (smartWidgetCallback[] | undefined) = eventTypes.get(event.type);
        if (!callbacks || callbacks.length === 0) {
            return;
        }
        this.content.setAttribute("events", "active");
        this.timeoutTimer.start();
        this.enabledState.events = true;
        const rawTime: unknown = event.time;
        const eventTime: Date = ((rawTime instanceof Date) ? rawTime : ((rawTime !== undefined && rawTime !== null) ? new Date(rawTime as string | number) : new Date()));
        for (const callback of callbacks) {
            callback(event.contents, eventTime);
        }
        this.stateChange();
    }
    /**
     * Handle expiring {@link smartWidget.timeoutTimer} events
     */
    private eventTimeoutExpired(): void {
        this.enabledState.events = false;
        this.content.setAttribute("events", "expired");
        this.stateChange();
    }
    /**
     * Widget enabled handler - called when the widget has been enabled
     */
    protected abstract enabled(): void;
    /**
     * Widget disabled handler - called when the widget has been disabled
     */
    protected abstract disabled(): void;
}

/**
 * Global symbol key stored on `document` to ensure only one parental state observer listener is registered per document across all bundles
 */
const parentStateObserverRegisteredKey: symbol = Symbol.for("@sss/sss-guis-smart-widgets-base.parentStateObserverRegistered");

/**
 * Document view typed for storing the global parental state observer guard symbol
 */
const parentStateObserverRegistry: Record<symbol, boolean | undefined> = document as unknown as Record<symbol, boolean | undefined>;

if (parentStateObserverRegistry[parentStateObserverRegisteredKey] !== true) {
    parentStateObserverRegistry[parentStateObserverRegisteredKey] = true;

    let activeObserver: (MutationObserver | null) = null;

    /**
     * Starts observing widget state changes once the GUI structure is loaded
     */
    document.addEventListener(structureLoadEventType, (): void => {
        /**
         * Recursively dispatches a "disabledByParent" event to all descendant elements of a given parent.
         * The event's detail indicates the enabled/disabled state to propagate.
         *
         * @param parent The parent element whose descendants will receive the event.
         * @param state The boolean value to be included in the event's detail.
         *                        `true` means enabled by parent, `false` means disabled by parent.
         */
        const dispatchToDescendants = (parent: Element, state: boolean): void => {
            parent.querySelectorAll("*").forEach((child: Element): void => {
                child.dispatchEvent(new CustomEvent(eventDisabledByParent, {
                    detail: state,
                    bubbles: false,
                    cancelable: false,
                }));
            });
        };

        /**
         * Checks if an HTMLElement is currently in a disabled state.
         * This considers both the `disabled` attribute and the `disabled` JavaScript property.
         *
         * @param target The HTMLElement to check.
         * @returns `true` if the element is disabled, `false` otherwise.
         */
        const getDisabledState = (target: HTMLElement): boolean => {
            return (target.hasAttribute("disabled") || (hasDisabledProperty(target) && (target as HTMLInputElement).disabled));
        };

        if (activeObserver !== null) {
            activeObserver.disconnect();
        }

        console.info("Creating observe instance to monitor parental widget state changes...");

        // Perform an initial scan for elements already disabled on load
        Array.from(document.querySelectorAll<HTMLElement>("*"))
            .filter((element: HTMLElement): boolean => {
                return getDisabledState(element);
            })
            .forEach((element: HTMLElement): void => {
                dispatchToDescendants(element, false);
            });

        activeObserver = new MutationObserver((mutations: MutationRecord[]): void => {
            mutations.forEach((mutation: MutationRecord): void => {
                const target: HTMLElement = mutation.target as HTMLElement;
                dispatchToDescendants(target, !getDisabledState(target));
            });
        });

        activeObserver.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ["disabled"],
        });
    });
}
