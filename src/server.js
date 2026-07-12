import 'dotenv/config'; // Loads environment variables
import app from './app.js';
import { connectDB } from './config/db.js';
import { seedDatabase } from './config/seeder.js';

// Handle uncaught exceptions globally
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message, err.stack);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Establish database connection
  await connectDB();
  
  // Seed database
  await seedDatabase();

  const server = app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });

  // Handle unhandled promise rejections globally
  process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! Shutting down gracefully...');
    console.error(err.name, err.message);
    server.close(() => {
      process.exit(1);
    });
  });
};

startServer();
