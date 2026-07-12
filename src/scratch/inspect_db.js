import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Trip from '../models/Trip.js';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';

dotenv.config();

async function inspect() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected.');

    const trips = await Trip.find({ isDeleted: { $ne: true } })
      .populate('vehicle')
      .populate('driver');

    console.log(`Found ${trips.length} active trips in database.`);
    trips.forEach(t => {
      console.log('------------------------------------');
      console.log(`Trip ID: ${t._id}`);
      console.log(`Route: ${t.source} -> ${t.destination}`);
      console.log(`Status: ${t.status}`);
      console.log(`Vehicle:`, t.vehicle);
      console.log(`Driver:`, t.driver);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.connection.close();
  }
}

inspect();
