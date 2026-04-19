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
    }): {
      send: Record<string, (payload: any) => void>;
    };
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

  export interface ContextMenuItemConfig {
    type?: "normal" | "divider" | "separator";
    label?: string;
    tooltip?: string;
    action?: string;
    role?: string;
    data?: unknown;
    submenu?: ContextMenuItemConfig[];
    enabled?: boolean;
    checked?: boolean;
    hidden?: boolean;
    accelerator?: string;
  }

  export namespace ContextMenu {
    function showContextMenu(menu: ContextMenuItemConfig[]): void;
    function on(name: "context-menu-clicked", handler: (event: unknown) => void): void;
  }
}
