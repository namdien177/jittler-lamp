declare const electrobun: {
  rpc: {
    request: Record<string, (params: any) => Promise<any>>;
    send: Record<string, (payload: any) => void>;
  };
};
