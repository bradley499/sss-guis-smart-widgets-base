class MockWidget {
    protected readonly content: HTMLElement;
    constructor(tag: string) {
        this.content = document.createElement(tag);
    }
    public async render(): Promise<HTMLElement> {
        await this.prepare();
        return this.content;
    }
    protected prepare(): Promise<void> {
        return Promise.resolve();
    }
    protected configurationHas(configuration: object, property: string): boolean {
        return property in configuration;
    }
    protected configurationGet<Type = unknown>(configuration: object, property: string): Type {
        if (!(property in configuration)) {
            throw new Error(`Property ${property} does not exist`);
        }
        return (configuration as any)[property];
    }
    protected configurationError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }
}

// @sss/sss-guis loads its exports dynamically from window.guis
(globalThis as any).window = globalThis;
(globalThis as any).guis = {
    widget: MockWidget,
    structureLoadEventType: "structureLoad",
    structureDeclareWidget: (): void => {},
    structureGenerate: (): void => {},
    structureWidget: (): void => {},
    structureWidgetExists: (): boolean => false,
};

