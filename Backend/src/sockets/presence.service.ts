export class PresenceService {
    // Maps userId -> Set of active socket IDs (handles multiple devices / tabs)
    private static userSockets = new Map<string, Set<string>>();
    // Maps socketId -> userId for quick lookup on disconnect
    private static socketToUser = new Map<string, string>();

    /**
     * Add an active socket connection for a user.
     * @returns boolean true if this was user's first connection (transition to ONLINE)
     */
    static addConnection(userId: string, socketId: string): boolean {
        let sockets = this.userSockets.get(userId);
        const isFirstConnection = !sockets || sockets.size === 0;

        if (!sockets) {
            sockets = new Set<string>();
            this.userSockets.set(userId, sockets);
        }

        sockets.add(socketId);
        this.socketToUser.set(socketId, userId);

        return isFirstConnection;
    }

    /**
     * Remove an active socket connection.
     * @returns { userId, isLast } where isLast is true if all user connections closed (transition to OFFLINE)
     */
    static removeConnection(socketId: string): { userId?: string; isLast: boolean } {
        const userId = this.socketToUser.get(socketId);
        if (!userId) {
            return { isLast: false };
        }

        this.socketToUser.delete(socketId);
        const sockets = this.userSockets.get(userId);

        if (sockets) {
            sockets.delete(socketId);
            if (sockets.size === 0) {
                this.userSockets.delete(userId);
                return { userId, isLast: true };
            }
        }

        return { userId, isLast: false };
    }

    /**
     * Check whether a user is currently online.
     */
    static isUserOnline(userId: string): boolean {
        const sockets = this.userSockets.get(userId);
        return Boolean(sockets && sockets.size > 0);
    }

    /**
     * Retrieve all currently online user IDs.
     */
    static getOnlineUsers(): string[] {
        return Array.from(this.userSockets.keys());
    }
}
export default PresenceService;
