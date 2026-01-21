// TypeScript declarations for the 'fernet' module

declare module 'fernet' {
  export class Secret {
    constructor(key: string);
  }

  export interface TokenOptions {
    secret: Secret;
    ttl?: number;
  }

  export class Token {
    constructor(options: TokenOptions);
    encode(data: string): string;
    decode(token: string): string;
  }
}
