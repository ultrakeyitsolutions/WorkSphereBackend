import { app } from './app';
import { connectDatabase } from './config/database';
import { env } from './config/env';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        // Establish database connection in background
        connectDatabase();

        // Start listening
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT} in ${env.NODE_ENV} environment.`);
        });
    } catch (error) {
        console.error('Failed to start the server:', error);
        process.exit(1);
    }
};

startServer();
