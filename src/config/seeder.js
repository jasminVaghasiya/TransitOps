import User from '../models/User.js';

/**
 * Seed initial users if they do not exist
 */
export const seedDatabase = async () => {
  try {
    const userCount = await User.countDocuments();
    if (userCount > 0) {
      console.log('Database already has users. Skipping seeder.');
      return;
    }

    console.log('Database empty. Seeding default TransitOps roles...');

    const defaultUsers = [
      {
        name: 'System Administrator',
        email: 'admin@transitops.com',
        password: 'password123Secure!',
        role: 'admin',
      },
      {
        name: 'Fleet Manager User',
        email: 'manager@transitops.com',
        password: 'password123Secure!',
        role: 'fleet_manager',
      },
      {
        name: 'Dispatcher User',
        email: 'dispatcher@transitops.com',
        password: 'password123Secure!',
        role: 'dispatcher',
      },
      {
        name: 'Safety Officer User',
        email: 'safety@transitops.com',
        password: 'password123Secure!',
        role: 'safety_officer',
      },
      {
        name: 'Financial Analyst User',
        email: 'finance@transitops.com',
        password: 'password123Secure!',
        role: 'financial_analyst',
      },
      {
        name: 'Read Only Auditor',
        email: 'auditor@transitops.com',
        password: 'password123Secure!',
        role: 'read_only',
      },
    ];

    // Mongoose hooks automatically hash the passwords during .create()
    await User.create(defaultUsers);
    console.log('Successfully seeded default TransitOps accounts!');
  } catch (error) {
    console.error(`[SEEDER ERROR] Failed to seed database: ${error.message}`);
  }
};
