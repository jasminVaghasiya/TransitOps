import User from '../models/User.js';
import Driver from '../models/Driver.js';

/**
 * Seed initial users and drivers if they do not exist
 */
export const seedDatabase = async () => {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('Database empty. Seeding default TransitOps roles...');
      const defaultUsers = [
        {
          name: 'Fleet Manager User',
          email: 'manager@transitops.com',
          password: 'password123Secure!',
          role: 'fleet_manager',
          isApproved: true,
        },
        {
          name: 'Driver User',
          email: 'driver@transitops.com',
          password: 'password123Secure!',
          role: 'driver',
          isApproved: true,
        },
        {
          name: 'Safety Officer User',
          email: 'safety@transitops.com',
          password: 'password123Secure!',
          role: 'safety_officer',
          isApproved: true,
        },
        {
          name: 'Financial Analyst User',
          email: 'finance@transitops.com',
          password: 'password123Secure!',
          role: 'financial_analyst',
          isApproved: true,
        },
      ];
      // Mongoose hooks automatically hash the passwords during .create()
      await User.create(defaultUsers);
      console.log('Successfully seeded default TransitOps accounts!');
    } else {
      console.log('Database already has users. Skipping user seeder.');
    }

    // Seed Drivers if they do not exist
    const driverCount = await Driver.countDocuments();
    if (driverCount === 0) {
      console.log('No drivers found. Seeding default drivers matching the mockup...');
      const defaultDrivers = [
        {
          name: 'Alex',
          licenseNumber: 'DL-88213',
          licenseExpiry: new Date('2028-12-31'),
          licenseCategory: 'LMV',
          phone: '+1987650000',
          safetyScore: 96,
          tripCompletionRate: 96,
          status: 'Available',
        },
        {
          name: 'John',
          licenseNumber: 'DL-44120',
          licenseExpiry: new Date('2025-03-31'),
          licenseCategory: 'HMV',
          phone: '+1982200000',
          safetyScore: 81,
          tripCompletionRate: 81,
          status: 'Suspended',
        },
        {
          name: 'Priya',
          licenseNumber: 'DL-77031',
          licenseExpiry: new Date('2028-08-31'),
          licenseCategory: 'LMV',
          phone: '+1991100000',
          safetyScore: 99,
          tripCompletionRate: 99,
          status: 'On Trip',
        },
        {
          name: 'Suresh',
          licenseNumber: 'DL-90045',
          licenseExpiry: new Date('2027-01-31'),
          licenseCategory: 'HMV',
          phone: '+1974400000',
          safetyScore: 88,
          tripCompletionRate: 88,
          status: 'Off Duty',
        },
      ];
      await Driver.create(defaultDrivers);
      console.log('Successfully seeded default mockup drivers!');
    } else {
      console.log('Database already has drivers. Skipping driver seeder.');
    }
  } catch (error) {
    console.error(`[SEEDER ERROR] Failed to seed database: ${error.message}`);
  }
};
