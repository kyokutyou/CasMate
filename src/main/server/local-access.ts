import type { RequestHandler, Response } from 'express';

/** Loopback access rules shared by management HTTP and WebSocket entry points. */
export class LocalAccess {
  private readonly origins: Set<string>;

  constructor(private readonly port: number, private readonly operationToken: string) {
    this.origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  }

  validHost(host: string | undefined): boolean {
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
  }

  validOrigin(origin: string | undefined): boolean {
    return origin === undefined || this.origins.has(origin);
  }

  managementToken(token: string | undefined | null): boolean {
    return token === this.operationToken;
  }

  requireHost: RequestHandler = (request, response, next) => {
    if (!this.validHost(request.headers.host)) {
      deny(response, 'INVALID_HOST', 'ローカルアプリ以外からは接続できません。');
      return;
    }
    next();
  };

  requireManagementRead: RequestHandler = (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!this.managementToken(request.header('X-CasMate-Management'))) {
      deny(response, 'MANAGEMENT_TOKEN_REQUIRED', '管理認証を確認できません。');
      return;
    }
    if (!this.validOrigin(request.headers.origin)) {
      deny(response, 'INVALID_ORIGIN', '要求元を確認できません。');
      return;
    }
    next();
  };

  requireOperation: RequestHandler = (request, response, next) => {
    if (request.method === 'GET') return next();
    const origin = request.headers.origin;
    if (!origin || !this.validOrigin(origin)) {
      deny(response, 'INVALID_ORIGIN', '要求元を確認できません。');
      return;
    }
    if (!this.managementToken(request.header('X-CasMate-Token'))) {
      deny(response, 'OPERATION_TOKEN_REQUIRED', '操作トークンを確認できません。');
      return;
    }
    next();
  };
}

function deny(response: Response, code: string, message: string): void {
  response.status(403).json({ code, message });
}
