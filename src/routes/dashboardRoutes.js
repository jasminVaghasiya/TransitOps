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

// Import additional models needed for analytics reports
import Maintenance from '../models/Maintenance.js';
import Expense from '../models/Expense.js';

/**
 * @route   GET /api/dashboard/analytics
 * @desc    Fetch fleet analytics report metrics: Fuel Efficiency, Fleet Utilization, Costs, ROI
 */
router.get('/analytics', async (req, res, next) => {
  try {
    const vehicles = await Vehicle.find({ isDeleted: { $ne: true } });
    const trips = await Trip.find({ isDeleted: { $ne: true } });
    const fuelLogs = await FuelLog.find({ isDeleted: { $ne: true } });
    const maintenance = await Maintenance.find({ isDeleted: { $ne: true } });
    const expenses = await Expense.find({ isDeleted: { $ne: true } });

    // Build data structure per vehicle
    const vehicleAnalytics = vehicles.map(v => {
      // Completed trips for this vehicle
      const vTrips = trips.filter(t => String(t.vehicle) === String(v._id) && t.status === 'Completed');
      const totalDistance = vTrips.reduce((sum, t) => sum + t.distanceKm, 0);
      const totalCargoWeight = vTrips.reduce((sum, t) => sum + t.cargoWeightKg, 0);

      // Fuel consumption for this vehicle (from FuelLogs which double as expenses)
      const vFuel = fuelLogs.filter(f => String(f.vehicle) === String(v._id));
      const totalFuelLiters = vFuel.reduce((sum, f) => sum + f.fuelLiters, 0);
      const totalFuelCost = vFuel.reduce((sum, f) => sum + f.cost, 0);

      // Maintenance records
      const vMaint = maintenance.filter(m => String(m.vehicle) === String(v._id));
      const totalMaintCost = vMaint.reduce((sum, m) => sum + m.cost, 0);

      // General expenses (other than fuel which is tracked in FuelLog)
      const vExpense = expenses.filter(e => String(e.vehicle) === String(v._id) && e.status === 'Approved');
      const totalExpenseCost = vExpense.reduce((sum, e) => sum + e.amount, 0);

      // Fuel Efficiency (Distance / Fuel) -> Km/L
      const fuelEfficiency = totalFuelLiters > 0 ? parseFloat((totalDistance / totalFuelLiters).toFixed(2)) : 0;

      // Operational Cost
      const operationalCost = totalFuelCost + totalMaintCost + totalExpenseCost;

      // Vehicle ROI:
      // Estimated Revenue = (distanceKm * 2.5) + (cargoWeightKg * 0.05)
      const estimatedRevenue = (totalDistance * 2.5) + (totalCargoWeight * 0.05);
      const netProfit = estimatedRevenue - operationalCost;
      const purchaseCost = v.purchasePrice || 50000; // Baseline default if not entered
      const roi = parseFloat(((netProfit / purchaseCost) * 100).toFixed(2));

      return {
        _id: v._id,
        registrationNumber: v.registrationNumber,
        make: v.make,
        modelName: v.modelName,
        status: v.status,
        totalDistance,
        totalFuelLiters,
        totalFuelCost,
        totalMaintCost,
        totalExpenseCost,
        fuelEfficiency,
        operationalCost,
        estimatedRevenue,
        netProfit,
        roi
      };
    });

    // Compute fleet averages/totals
    const totalFleetVehicles = vehicles.length;
    const activeFleetVehicles = vehicles.filter(v => v.status === 'On Trip').length;
    const fleetUtilization = totalFleetVehicles > 0 ? parseFloat(((activeFleetVehicles / totalFleetVehicles) * 100).toFixed(2)) : 0;

    const totalFleetDistance = vehicleAnalytics.reduce((sum, v) => sum + v.totalDistance, 0);
    const totalFleetFuelLiters = vehicleAnalytics.reduce((sum, v) => sum + v.totalFuelLiters, 0);
    const avgFleetFuelEfficiency = totalFleetFuelLiters > 0 ? parseFloat((totalFleetDistance / totalFleetFuelLiters).toFixed(2)) : 0;

    const totalFleetOperationalCost = vehicleAnalytics.reduce((sum, v) => sum + v.operationalCost, 0);
    const avgFleetROI = vehicleAnalytics.length > 0
      ? parseFloat((vehicleAnalytics.reduce((sum, v) => sum + v.roi, 0) / vehicleAnalytics.length).toFixed(2))
      : 0;

    res.status(200).json({
      status: 'success',
      data: {
        summary: {
          totalFleetVehicles,
          activeFleetVehicles,
          fleetUtilization,
          totalFleetDistance,
          totalFleetFuelLiters,
          avgFleetFuelEfficiency,
          totalFleetOperationalCost,
          avgFleetROI
        },
        vehicles: vehicleAnalytics
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
