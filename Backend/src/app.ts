import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import routes from './routes';
import { errorHandler } from './middleware/error.middleware';
import { env } from './config/env';

const app = express();

// Security Middlewares
app.use(helmet());
app.use(hpp());

// Logging
app.use(pinoHttp({
    level: env.NODE_ENV === 'test' ? 'silent' : 'info'
}));

// CORS Configuration
const corsOptions: cors.CorsOptions = {
    origin: env.NODE_ENV === 'production' ? env.CORS_ORIGIN : true,
    credentials: true,
};
app.use(cors(corsOptions));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.NODE_ENV === 'test' ? 10000 : 100, // allow more request overhead in tests
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Root health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'WorkSphere API is running',
        environment: env.NODE_ENV,
    });
});

// Mounted Routes
app.use('/api', routes);

// Error Handling
app.use(errorHandler);

export { app };
export default app;
