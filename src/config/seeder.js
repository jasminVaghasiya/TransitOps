import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import Trip from '../models/Trip.js';
import FuelLog from '../models/FuelLog.js';
import Expense from '../models/Expense.js';

/**
 * Seed initial users if they do not exist
 */
export const seedDatabase = async () => {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
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
    } else {
      console.log('Database already has users. Skipping user seeder.');
    }

    // Seed default entities if empty
    const vehicleCount = await Vehicle.countDocuments();
    if (vehicleCount === 0) {
      console.log('Seeding default TransitOps demo vehicles, drivers, and trips...');
      
      const defaultVehicle = await Vehicle.create({
        registrationNumber: 'TX-890-GP',
        make: 'Volvo',
        modelName: 'FH16',
        capacityKg: 20000,
        status: 'Available',
        vehicleType: 'Truck',
        region: 'North',
      });

      const defaultDriver = await Driver.create({
        name: 'John Doe',
        licenseNumber: 'DL-908752-TX',
        licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        phone: '+15550199',
        status: 'Available',
        safetyScore: 95,
      });

      // Seed Fuel log
      await FuelLog.create({
        vehicle: defaultVehicle._id,
        date: new Date(),
        fuelLiters: 100,
        cost: 350,
        odometer: 50000,
      });

      // Seed Expense
      await Expense.create({
        expenseType: 'Maintenance',
        amount: 1200,
        date: new Date(),
        vehicle: defaultVehicle._id,
        description: 'Engine oil flush & diagnostics',
        status: 'Approved',
      });

      await Trip.create({
        vehicle: defaultVehicle._id,
        driver: defaultDriver._id,
        source: 'Houston Terminal',
        destination: 'Dallas Depot',
        cargoDescription: 'Electronics Freight',
        cargoWeightKg: 15000,
        distanceKm: 380,
        status: 'Draft',
      });

      await Trip.create({
        vehicle: defaultVehicle._id,
        driver: defaultDriver._id,
        source: 'Austin Hub',
        destination: 'El Paso Station',
        cargoDescription: 'Industrial Spares',
        cargoWeightKg: 12000,
        distanceKm: 920,
        status: 'Dispatched',
      });

      console.log('Seeding of default TransitOps demo dataset complete.');
    }
  } catch (error) {
    console.error(`[SEEDER ERROR] Failed to seed database: ${error.message}`);
  }
};
