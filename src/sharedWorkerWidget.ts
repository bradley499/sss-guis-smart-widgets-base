import { structureDeclareWidget, widget } from "@sss/sss-guis";
import {
    type communicationDisconnect,
    type communicationEventMessage,
    type communicationStatus,
    communicationTimeout,
    type eventFollow,
    type eventMessage,
    timeout
} from "@sss/sss-guis-smart-widgets-common";
import { eventOutgoing, eventOutgoingFollow, publishEvent } from "./event";

/**
 * Connection status reported by a shared worker companion widget
 */
enum sharedWorkerCommunicationStatus {
    /**
     * No heartbeat has been received from the shared worker within the timeout window
     */
    noCommunication,
    /**
     * The shared worker is responding, but its underlying transport is disconnected
     */
    notConnected,
    /**
     * The shared worker is responding and its underlying transport is connected
     */
    connected,
}

/**
 * Converts communication status enum to user-friendly label
 * @param communicationStatus The communication status enum value
 * @returns Human readable communication status
 */
function communicationStatusText(communicationStatus: sharedWorkerCommunicationStatus): string {
    switch (communicationStatus) {
        case sharedWorkerCommunicationStatus.noCommunication:
            return "Not working...";
        case sharedWorkerCommunicationStatus.notConnected:
            return "Not connected";
        case sharedWorkerCommunicationStatus.connected:
            return "Connected";
    }
}

/**
 * Registered shared worker entry tracked per configured worker script path
 */
interface activeWorkerRegistration {
    /**
     * Active browser SharedWorker instance
     */
    worker: SharedWorker;
    /**
     * Callback invoked whenever an outgoing event is forwarded to this worker
     */
    onOutgoing: () => void;
}

/**
 * Duration in milliseconds that seen peer-broadcast message IDs are retained for deduplication
 */
const messageDeduplicationLifetimeMs: number = 1000;

/**
 * Generates a unique identifier string for the current page execution context
 * @returns Unique page identifier
 */
function createPageIdentifier(): string {
    const randomBytes: Uint8Array<ArrayBuffer> = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const randomHex: string = Array.from(randomBytes, (byte: number): string => byte.toString(16).padStart(2, "0")).join("");
    return `${Date.now().toString(36)}-${randomHex}`;
}

/**
 * Active shared worker instances keyed by their configured worker script path
 */
const activeWorkers: Map<string, activeWorkerRegistration> = new Map<string, activeWorkerRegistration>();

/**
 * Persistent list of unique topics followed by widgets on this document
 */
const followedEvents: eventFollow[] = [];

/**
 * Expiration timestamps keyed by peer-broadcast message ID to suppress duplicate deliveries across multiple shared workers
 */
const seenMessageIdentifiers: Map<string, number> = new Map<string, number>();

/**
 * Safety timer that clears seen message identifiers once peer traffic goes idle
 */
const seenMessageCleanupTimeout: timeout = new timeout((): void => {
    seenMessageIdentifiers.clear();
}, messageDeduplicationLifetimeMs);

/**
 * Unique prefix identifying this document context in generated outgoing message IDs
 */
const pageIdentifier: string = createPageIdentifier();

/**
 * Monotonically increasing sequence counter for outgoing messages sent from this document
 */
let outgoingMessageSequence: number = 0;

/**
 * Prunes expired message identifiers from the front of the insertion-ordered map
 * @param now Current epoch timestamp in milliseconds
 */
function pruneSeenMessageIdentifiers(now: number): void {
    for (const entry of seenMessageIdentifiers.entries()) {
        if (entry[1] <= now) {
            seenMessageIdentifiers.delete(entry[0]);
        } else {
            break;
        }
    }
}

/**
 * Forwards an outgoing event message to all active shared worker ports with a shared deduplication ID
 * @param event Custom event carrying eventMessage
 */
function handleDocumentOutgoing(event: Event): void {
    if (activeWorkers.size === 0) {
        return;
    }
    const messageDetail: eventMessage = (event as CustomEvent<eventMessage>).detail;
    outgoingMessageSequence++;
    const outgoingMessage: communicationEventMessage = {
        name: messageDetail.name,
        type: messageDetail.type,
        contents: messageDetail.contents,
        id: `${pageIdentifier}:${String(outgoingMessageSequence)}`,
    };
    if (messageDetail.time !== undefined) {
        outgoingMessage.time = messageDetail.time;
    }

    for (const registration of activeWorkers.values()) {
        registration.worker.port.postMessage(outgoingMessage);
        registration.onOutgoing();
    }
}

/**
 * Records a unique topic follow request and forwards it to all active shared worker ports
 * @param event Custom event carrying eventFollow
 */
function handleDocumentFollow(event: Event): void {
    const followDetail: eventFollow = (event as CustomEvent<eventFollow>).detail;
    const alreadyFollowed: boolean = followedEvents.some((topic: eventFollow): boolean => topic.name === followDetail.name && topic.type === followDetail.type);
    if (alreadyFollowed) {
        return;
    }

    followedEvents.push(followDetail);
    for (const registration of activeWorkers.values()) {
        registration.worker.port.postMessage(followDetail);
    }
}

document.addEventListener(eventOutgoing, handleDocumentOutgoing);
document.addEventListener(eventOutgoingFollow, handleDocumentFollow);

// Clean up all active ports in shared workers strictly when the document unloads
window.addEventListener("beforeunload", (): void => {
    for (const registration of activeWorkers.values()) {
        try {
            registration.worker.port.postMessage({
                disconnect: true,
            } satisfies communicationDisconnect);
        } catch {
            // Ignore if port already closed
        }
    }
});

/**
 * Shared worker companion widget bridging DOM events to a shared worker instance
 */
class sharedWorkerCompanionWidget extends widget<HTMLTableElement> {
    private communicationTimeout!: timeout;
    private configuredWorkerPath: string | null = null;

    private incomingCount: number = 0;
    private outgoingCount: number = 0;
    private communicationStatus: sharedWorkerCommunicationStatus = sharedWorkerCommunicationStatus.noCommunication;

    private statusCell!: HTMLTableCellElement;
    private incomingCell!: HTMLTableCellElement;
    private outgoingCell!: HTMLTableCellElement;

    /**
     * Constructs a shared worker companion widget and initializes its live status table
     */
    constructor() {
        super("table");
        this.communicationTimeout = new timeout(this.communicationTimeoutHandler.bind(this), communicationTimeout);

        /**
         * Creates a labeled table row and returns the value cell
         * @param label The label text
         * @param initialValue The initial string value
         * @returns Value cell element
         */
        const createRow = (label: string, initialValue: string): HTMLTableCellElement => {
            const tableRow: HTMLTableRowElement = this.content.insertRow();
            tableRow.insertCell().textContent = label;
            const valueCell: HTMLTableCellElement = tableRow.insertCell();
            valueCell.textContent = initialValue;
            return valueCell;
        };

        this.statusCell = createRow("Connection state: ", communicationStatusText(this.communicationStatus));
        this.incomingCell = createRow("Incoming messages: ", "0");
        this.outgoingCell = createRow("Outgoing messages: ", "0");
    }

    /**
     * Updates the status cell with the latest communication state
     */
    private updateStatus(): void {
        this.statusCell.textContent = communicationStatusText(this.communicationStatus);
    }

    /**
     * Updates the incoming message count cell
     */
    private updateIncomingCount(): void {
        this.incomingCell.textContent = String(this.incomingCount);
    }

    /**
     * Updates the outgoing message count cell
     */
    private updateOutgoingCount(): void {
        this.outgoingCell.textContent = String(this.outgoingCount);
    }

    /**
     * Configures the shared worker widget with required options
     * @param configuration Configuration object specifying the worker script and optional name
     */
    configuration(configuration: object): void {
        if (this.configuredWorkerPath !== null) {
            throw this.configurationError("This `shared_worker` widget has already been configured!");
        }
        if (!this.configurationHas(configuration, "worker")) {
            throw this.configurationError("A `worker` is required!");
        }
        const workerConfiguration: unknown = this.configurationGet(configuration, "worker");
        if (typeof workerConfiguration !== "string" || workerConfiguration.trim() === "") {
            throw this.configurationError("A `worker` is expected to be a path to a shared worker!");
        }
        let name: string = "";
        if (this.configurationHas(configuration, "name")) {
            const rawName: unknown = this.configurationGet(configuration, "name");
            if (typeof rawName !== "string") {
                throw this.configurationError("A `name` must be a string value!");
            }
            name = rawName;
        }
        if (activeWorkers.has(workerConfiguration)) {
            throw this.configurationError(`A \`shared_worker\` for "${workerConfiguration}" has already been configured!`);
        }

        const sharedWorkerInstance: SharedWorker = new SharedWorker(workerConfiguration, {
            name: name,
        });
        this.configuredWorkerPath = workerConfiguration;

        activeWorkers.set(workerConfiguration, {
            worker: sharedWorkerInstance,
            /**
             * Updates outgoing telemetry count when an outgoing event is posted to this worker
             */
            onOutgoing: (): void => {
                this.outgoingCount++;
                this.updateOutgoingCount();
            },
        });

        sharedWorkerInstance.port.addEventListener("message", this.distributeIncoming.bind(this));
        sharedWorkerInstance.port.start();

        // Replay all previously followed topics to this newly configured worker
        for (const followedEvent of followedEvents) {
            sharedWorkerInstance.port.postMessage(followedEvent);
        }
    }

    /**
     * Handles incoming messages from the shared worker port
     * @param event The message event from the shared worker
     */
    private distributeIncoming(event: MessageEvent<communicationEventMessage | communicationStatus>): void {
        const data: communicationEventMessage | communicationStatus = event.data;
        if ("connected" in data) {
            this.communicationStatus = (data.connected ? sharedWorkerCommunicationStatus.connected : sharedWorkerCommunicationStatus.notConnected);
            this.updateStatus();
            this.communicationTimeout.start();
        } else {
            if (data.id !== undefined) {
                const now: number = Date.now();
                const existingExpiry: number | undefined = seenMessageIdentifiers.get(data.id);
                if (existingExpiry !== undefined && existingExpiry > now) {
                    pruneSeenMessageIdentifiers(now);
                    return;
                }
                pruneSeenMessageIdentifiers(now);
                seenMessageIdentifiers.set(data.id, now + messageDeduplicationLifetimeMs);
                seenMessageCleanupTimeout.start();
            }
            this.incomingCount++;
            this.updateIncomingCount();
            publishEvent(data.name, data.type, data.contents, true, data.time);
        }
    }

    /**
     * Handles communication timeout when no status message was received from worker
     */
    private communicationTimeoutHandler(): void {
        this.communicationStatus = sharedWorkerCommunicationStatus.noCommunication;
        this.updateStatus();
    }

    /**
     * Prepares the widget for rendering
     * @returns Promise resolving when ready
     */
    protected prepare(): Promise<void> {
        return Promise.resolve();
    }
}

try {
    structureDeclareWidget("shared_worker", sharedWorkerCompanionWidget);
} catch (error) {
    // It is expected that there could be many modules that inherit from this package, so it is assumed that this could fail due to duplicate declarations
    console.error(error);
}
