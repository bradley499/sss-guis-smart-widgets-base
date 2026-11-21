export { loadResource, type multimediaResource, structureDeclareWidget, type structureLoadEvent, structureLoadEventType, structureWidget, structureWidgetExists, type widgetElement, type widgetIdentifier } from "@sss/sss-guis";
export { interval, timeout } from "@sss/sss-guis-smart-widgets-common";
export { type eventContents, type eventName, type eventType, publishEvent } from "./event";
export { smartWidget as widget } from "./smartWidget";

import "./sharedWorkerWidget";
import "./smartWidget";
