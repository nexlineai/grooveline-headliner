export function makeTicket(env: Record<string, unknown>, sub: string, now?: number): Promise<{ ticket: string; expiresAt: number }>;
