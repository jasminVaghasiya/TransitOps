import BasePolicy from './BasePolicy.js';
import Vehicle from '../models/Vehicle.js';
import Driver from '../models/Driver.js';

export default class TripPolicy extends BasePolicy {
  /**
   * Evaluates if a trip can be created with the specified vehicle and driver
   */
  async canCreate(actor, target, req) {
    const { vehicle: vehicleId, driver: driverId, cargoWeightKg } = req.body;

    // Load referenced Vehicle
    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return this.deny('Vehicle not found', 'VEHICLE_NOT_FOUND');
    }

    if (vehicle.status === 'Retired') {
      return this.deny('Cannot assign a retired vehicle to a new trip', 'VEHICLE_RETIRED');
    }

    // Load referenced Driver
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return this.deny('Driver not found', 'DRIVER_NOT_FOUND');
    }

    if (driver.status === 'Suspended') {
      return this.deny('Cannot assign a suspended driver to a trip', 'DRIVER_SUSPENDED');
    }

    if (driver.isLicenseExpired) {
      return this.deny('Cannot assign a driver with an expired license', 'DRIVER_LICENSE_EXPIRED');
    }

    // Capacity verification
    if (cargoWeightKg > vehicle.capacityKg) {
      return this.deny(`Cargo weight (${cargoWeightKg}kg) exceeds vehicle capacity (${vehicle.capacityKg}kg)`, 'CARGO_EXCEEDS_CAPACITY');
    }

    return this.allow();
  }

  /**
   * Enforces trip state transition flows and status-dependent edit blocks
   */
  async canUpdate(actor, trip, req) {
    const { status, vehicle: newVehicleId, driver: newDriverId, cargoWeightKg } = req.body;

    // Completed and Cancelled trips are immutable
    if (trip.status === 'Completed' || trip.status === 'Cancelled') {
      return this.deny('Completed or Cancelled trips cannot be modified', 'TRIP_LOCKED');
    }

    // If changing details (vehicle, driver, cargo) in Draft
    if (trip.status === 'Draft') {
      const vId = newVehicleId || trip.vehicle;
      const dId = newDriverId || trip.driver;
      const weight = cargoWeightKg || trip.cargoWeightKg;

      const vehicle = await Vehicle.findById(vId);
      if (!vehicle) return this.deny('Vehicle not found', 'VEHICLE_NOT_FOUND');
      if (vehicle.status === 'Retired') return this.deny('Cannot assign a retired vehicle', 'VEHICLE_RETIRED');

      const driver = await Driver.findById(dId);
      if (!driver) return this.deny('Driver not found', 'DRIVER_NOT_FOUND');
      if (driver.status === 'Suspended') return this.deny('Cannot assign a suspended driver', 'DRIVER_SUSPENDED');
      if (driver.isLicenseExpired) return this.deny('Cannot assign a driver with an expired license', 'DRIVER_LICENSE_EXPIRED');

      if (weight > vehicle.capacityKg) {
        return this.deny(`Cargo weight (${weight}kg) exceeds vehicle capacity (${vehicle.capacityKg}kg)`, 'CARGO_EXCEEDS_CAPACITY');
      }
    }

    // Verify status transitions
    if (status && status !== trip.status) {
      const oldStatus = trip.status;

      // Validate transition bounds
      const isValidTransition =
        (oldStatus === 'Draft' && status === 'Dispatched') ||
        (oldStatus === 'Draft' && status === 'Cancelled') ||
        (oldStatus === 'Dispatched' && status === 'Completed') ||
        (oldStatus === 'Dispatched' && status === 'Cancelled');

      if (!isValidTransition) {
        return this.deny(`Illegal trip status transition from '${oldStatus}' to '${status}'`, 'INVALID_STATUS_TRANSITION');
      }

      // If transitioning to Dispatched, run live availability checks
      if (status === 'Dispatched') {
        const vehicle = await Vehicle.findById(trip.vehicle);
        if (!vehicle || vehicle.status !== 'Available') {
          return this.deny('Vehicle is already on another trip or is under maintenance', 'VEHICLE_UNAVAILABLE');
        }

        const driver = await Driver.findById(trip.driver);
        if (!driver || driver.status !== 'Available') {
          return this.deny('Driver is already on another trip, suspended, or off duty', 'DRIVER_UNAVAILABLE');
        }

        if (driver.isLicenseExpired) {
          return this.deny('Driver license has expired. Dispatch blocked.', 'DRIVER_LICENSE_EXPIRED');
        }
      }
    }

    return this.allow();
  }

  /**
   * Trips cannot be deleted after dispatch
   */
  async canDelete(actor, trip, req) {
    if (trip.status !== 'Draft') {
      return this.deny('Only draft trips can be deleted', 'TRIP_LOCKED');
    }
    return this.allow();
  }
}
