import BasePolicy from './BasePolicy.js';
import Trip from '../models/Trip.js';
import Maintenance from '../models/Maintenance.js';
import FuelLog from '../models/FuelLog.js';
import Expense from '../models/Expense.js';

export default class VehiclePolicy extends BasePolicy {
  /**
   * Fleet manager and admin can create vehicles
   */
  async canCreate(actor, target, req) {
    return this.allow();
  }

  /**
   * Enforce update constraints and state transitions
   */
  async canUpdate(actor, vehicle, req) {
    const { status, registrationNumber } = req.body;

    // 1. If registration number is changing, check if trips exist
    if (registrationNumber && registrationNumber !== vehicle.registrationNumber) {
      const tripsExist = await Trip.exists({ vehicle: vehicle._id });
      if (tripsExist) {
        return this.deny('Cannot change registration number after trips have been logged for this vehicle', 'IMMUTABLE_REGISTRATION');
      }
    }

    // 2. State transition validation
    if (status && status !== vehicle.status) {
      const oldStatus = vehicle.status;

      // Sold is final unless administrator restores.
      if (oldStatus === 'Sold' && !this.isAdmin(actor)) {
        return this.deny('Only administrators can restore a sold vehicle', 'RESTORE_DENIED');
      }
      if (oldStatus === 'Retired' && status !== 'Sold' && status !== 'Available') {
        return this.deny('Retired vehicles can only be sold or reactivated to Available', 'RESTORE_DENIED');
      }

      // Validate allowed state transitions
      const isAllowed = 
        (oldStatus === 'Available' && status === 'On Trip') ||
        (oldStatus === 'On Trip' && status === 'Available') ||
        (oldStatus === 'Available' && status === 'In Shop') ||
        (oldStatus === 'In Shop' && status === 'Available') ||
        (oldStatus === 'Available' && status === 'Retired') ||
        (oldStatus === 'Retired' && status === 'Available') || // Reactivate
        (oldStatus === 'Retired' && status === 'Sold') || // Can only sell after retired
        (this.isAdmin(actor) && oldStatus === 'Sold' && status === 'Available'); // Admin restore override

      if (!isAllowed) {
        return this.deny(`Illegal status transition from '${oldStatus}' to '${status}'`, 'INVALID_STATUS_TRANSITION');
      }
    }

    // 3. Prevent general edits on retired or sold vehicles
    if ((vehicle.status === 'Retired' || vehicle.status === 'Sold') && !status && !this.isAdmin(actor)) {
      return this.deny('Retired or sold vehicles cannot be modified', 'RETIRED_LOCK');
    }

    return this.allow();
  }

  /**
   * Protect against deleting active fleet elements
   */
  async canDelete(actor, vehicle, req) {
    // Check if dependent logs exist
    const tripsExist = await Trip.exists({ vehicle: vehicle._id });
    if (tripsExist) {
      return this.deny('Vehicle cannot be deleted because trips exist in its history', 'DEPENDENCY_CONSTRAINT');
    }

    const maintenanceExist = await Maintenance.exists({ vehicle: vehicle._id });
    if (maintenanceExist) {
      return this.deny('Vehicle cannot be deleted because maintenance logs exist', 'DEPENDENCY_CONSTRAINT');
    }

    const fuelLogsExist = await FuelLog.exists({ vehicle: vehicle._id });
    if (fuelLogsExist) {
      return this.deny('Vehicle cannot be deleted because fuel logs exist', 'DEPENDENCY_CONSTRAINT');
    }

    const expensesExist = await Expense.exists({ vehicle: vehicle._id });
    if (expensesExist) {
      return this.deny('Vehicle cannot be deleted because expenses exist', 'DEPENDENCY_CONSTRAINT');
    }

    return this.allow();
  }
}
