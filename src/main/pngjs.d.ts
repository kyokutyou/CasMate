declare module 'pngjs' {
  export const PNG: {
    sync: {
      read(content: Buffer, options?: { checkCRC?: boolean }): { width: number; height: number; data: Buffer };
    };
  };
}
