import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import { apiRateLimiter } from './middleware/rate-limit.middleware';
import pinoHttp from 'pino-http';
import routes from './routes';
import { errorHandler } from './middleware/error.middleware';
import { env } from './config/env';

const app = express();

// Trust reverse proxy (Nginx / Hostinger / Vercel) for correct client IP detection in rate limiting
const trustProxySetting = env.TRUST_PROXY !== undefined
    ? (!isNaN(Number(env.TRUST_PROXY)) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY)
    : 1;
app.set('trust proxy', trustProxySetting);

// Security Middlewares
app.use(helmet());
app.use(hpp());

// Logging
app.use(pinoHttp({
    level: env.NODE_ENV === 'test' ? 'silent' : 'info'
}));

// CORS Configuration
const allowedOrigins = (env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (env.NODE_ENV !== 'production') return callback(null, true);
        if (
            allowedOrigins.includes(origin) ||
            allowedOrigins.includes('*') ||
            origin.endsWith('.vercel.app') ||
            origin.includes('localhost')
        ) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parsers
app.use(
    express.json({
        verify: (req: any, _res, buf) => {
            req.rawBody = buf;
        },
    })
);
app.use(express.urlencoded({ extended: true }));

// Rate Limiting (Enabled in Production)
if (env.NODE_ENV === 'production') {
    app.use(apiRateLimiter);
}

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
