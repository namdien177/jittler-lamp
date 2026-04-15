declare module "electrobun/bun" {
  export type RPCSchema<T extends {
    requests: Record<string, { params: any; response: any }>;
    messages: Record<string, any>;
  }> = T;

  export interface BrowserWindowOptions {
    title?: string;
    url?: string | null;
    html?: string | null;
    preload?: string | null;
    rpc?: unknown;
    frame?: {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
  }

  export class BrowserWindow<T = unknown> {
    constructor(options?: BrowserWindowOptions);
    webview: {
      rpc: {
        request: Record<string, (params: any) => Promise<any>>;
        send: Record<string, (payload: any) => void>;
      };
      on(eventName: string, listener: (event: unknown) => void): void;
    };
  }

  export const BrowserView: {
    defineRPC<T>(options: {
      maxRequestTime?: number;
      handlers: {
        requests: Record<string, (params: any) => Promise<any> | any>;
        messages: Record<string, (payload: any) => Promise<void> | void>;
      };
    }): unknown;
  };

  export const Utils: {
    openFileDialog(options: {
      startingFolder?: string;
      allowedFileTypes?: string;
      canChooseFiles?: boolean;
      canChooseDirectory?: boolean;
      allowsMultipleSelection?: boolean;
    }): Promise<string[]>;
    openPath(path: string): void;
    showItemInFolder(path: string): void;
  };
}
