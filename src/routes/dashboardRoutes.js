import express from 'express';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';
import Trip from '../models/Trip.js';
import FuelLog from '../models/FuelLog.js';
import { protect } from '../middleware/auth.js';
import { attachAbility } from '../middleware/rbac.js';

const router = express.Router();

// Mount auth protections
router.use(protect);
router.use(attachAbility);

/**
 * @route   GET /api/dashboard/stats
 * @desc    Fetch fleet dashboard KPIs with filtering support
 */
router.get('/stats', async (req, res, next) => {
  try {
    const { vehicleType, status, region } = req.query;

    // 1. Build dynamic Vehicle filter
    const vehicleFilter = { isDeleted: { $ne: true } };
    if (vehicleType) vehicleFilter.vehicleType = vehicleType;
    if (status) vehicleFilter.status = status;
    if (region) vehicleFilter.region = region;

    const vehicles = await Vehicle.find(vehicleFilter);
    const vehicleIds = vehicles.map(v => v._id);

    // 2. Compute Vehicle KPIs
    const totalVehicles = vehicles.length;
    const activeVehicles = vehicles.filter(v => v.status === 'On Trip').length;
    const availableVehicles = vehicles.filter(v => v.status === 'Available').length;
    const maintenanceVehicles = vehicles.filter(v => v.status === 'In Shop').length;

    // Fleet utilization calculation
    const fleetUtilization = totalVehicles > 0 
      ? Math.round((activeVehicles / totalVehicles) * 100) 
      : 0;

    // 3. Retrieve Trips for the filtered vehicles
    const tripFilter = { isDeleted: { $ne: true }, vehicle: { $in: vehicleIds } };
    const trips = await Trip.find(tripFilter);

    const activeTrips = trips.filter(t => t.status === 'Dispatched').length;
    const pendingTrips = trips.filter(t => t.status === 'Draft').length;

    // 4. Compute Drivers On Duty
    let driversOnDuty = 0;
    if (region || vehicleType || status) {
      // For filtered views, count unique drivers assigned to active trips of those vehicles
      const dispatchedTrips = trips.filter(t => t.status === 'Dispatched');
      const uniqueDrivers = new Set(dispatchedTrips.map(t => String(t.driver)));
      driversOnDuty = uniqueDrivers.size;
    } else {
      // Default view, count all Available and On Trip drivers
      driversOnDuty = await Driver.countDocuments({ 
        isDeleted: { $ne: true }, 
        status: { $in: ['Available', 'On Trip'] } 
      });
    }

    // 5. Gather Fuel Costs for these vehicles
    const fuelLogs = await FuelLog.find({ vehicle: { $in: vehicleIds } });
    const totalFuelCost = fuelLogs.reduce((sum, log) => sum + log.cost, 0);

    res.status(200).json({
      status: 'success',
      data: {
        kpis: {
          totalVehicles,
          activeVehicles,
          availableVehicles,
          maintenanceVehicles,
          activeTrips,
          pendingTrips,
          driversOnDuty,
          fleetUtilization,
          totalFuelCost,
        },
        filters: {
          vehicleType: vehicleType || null,
          status: status || null,
          region: region || null,
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
