import http from 'http';
import { app } from './app';
import { connectDatabase } from './config/database';
import { env } from './config/env';
import { initSocketServer } from './sockets/socket-server';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        // Establish database connection in background
       await connectDatabase();

        // Create HTTP server wrapping Express
        const httpServer = http.createServer(app);

        // Attach Socket.IO real-time server
        initSocketServer(httpServer);

        // Start listening
        httpServer.listen(PORT, () => {
            console.log(`Server is running on port ${PORT} in ${env.NODE_ENV} environment with Socket.IO.`);
        });
    } catch (error) {
        console.error('Failed to start the server:', error);
        process.exit(1);
    }
};

startServer();
