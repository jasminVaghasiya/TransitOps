import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import vehicleRoutes from './routes/vehicleRoutes.js';
import driverRoutes from './routes/driverRoutes.js';
import tripRoutes from './routes/tripRoutes.js';
import maintenanceRoutes from './routes/maintenanceRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import userRoutes from './routes/userRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import errorHandler from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';

const app = express();

// 1. Set security HTTP headers
app.use(helmet());

// 2. Configure CORS to allow secure cookies across origins
const allowedOrigins = ['http://localhost:3000', 'http://localhost:5173']; // Common React/Vite development ports
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true, // Crucial for reading HTTP-only refresh cookies
  })
);

// 3. Body parsers (limit payload size for security)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 4. Cookie parser (required for extracting refresh tokens)
app.use(cookieParser());

// Serve static frontend UI assets
app.use(express.static('public'));

// 5. Apply global API rate limit
app.use('/api', apiLimiter);

// 6. Routes
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Base route for API status
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Authentication Server is running.',
  });
});

// 7. 404 Route handler
app.all('*', (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.statusCode = 404;
  err.status = 'fail';
  err.isOperational = true;
  next(err);
});

// 8. Global Error Handler Middleware
app.use(errorHandler);

export default app;
